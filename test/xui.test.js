import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { parseInboundIds, xuiSubscriptionStatus, clientFlowForInbounds } from "../src/integrations/xuiClients.js";
import { createKeyedLock } from "../src/services/keyedLock.js";

test("panel upgrade: provision, recover attachments and preserve identity", async (t) => {
  let state;
  const reset = () => {
    state = { modern: true, rows: [], adds: 0, failLookup: false, csrf: "session-csrf", rejectOnce: false };
  };
  reset();
  const inbounds = () => [3, 4].map((id) => ({
    id, protocol: "vless", enable: true,
    settings: { clients: state.rows.filter((r) => r.inboundIds.includes(id)).map((r) => r.client) },
    streamSettings: { network: "tcp", security: "reality" },
  }));
  const server = http.createServer(async (req, res) => {
    let body = ""; for await (const chunk of req) body += chunk;
    const path = decodeURIComponent(req.url);
    const send = (obj, status = 200) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
    if (path === "/csrf-token") return send({ token: "anonymous-csrf" });
    if (path === "/login") { res.setHeader("Set-Cookie", "session=authenticated"); return send({ success: true }); }
    if (path === "/panel/csrf-token") return send({ token: state.csrf });
    if (state.rejectOnce || req.headers["x-csrf-token"] !== state.csrf) {
      state.rejectOnce = false; return send({}, 403);
    }
    if (path === "/panel/api/inbounds/list") return send({ success: true, obj: inbounds() });
    if (path.startsWith("/panel/api/clients/") && !state.modern) return send({}, 404);
    if (path.startsWith("/panel/api/clients/get/tgId/")) {
      if (state.failLookup) return send({ success: false, msg: "database unavailable" }, 503);
      const tid = Number(path.split("/").at(-1));
      return send({ success: true, obj: state.rows.filter((r) => Number(r.client.tgId) === tid) });
    }
    if (path === "/panel/api/clients/add") {
      const payload = JSON.parse(body); state.adds++;
      assert.equal(typeof payload.client.tgId, "number");
      assert.deepEqual(payload.inboundIds, [3, 4]);
      const client = { ...payload.client, uuid: payload.client.id, id: 123, allowedIPs: "[]" };
      state.rows.push({ client, inboundIds: payload.inboundIds });
      return send({ success: true });
    }
    if (path.endsWith("/attach")) {
      const email = path.split("/").at(-2);
      const row = state.rows.find((r) => r.client.email === email);
      row.inboundIds = [...new Set([...row.inboundIds, ...JSON.parse(body).inboundIds])];
      return send({ success: true });
    }
    if (path.startsWith("/panel/api/clients/update/")) {
      const row = state.rows.find((r) => r.client.email === path.split("/").at(-1));
      const client = JSON.parse(body);
      assert.equal(client.id, row.client.uuid);
      assert.ok(Array.isArray(client.allowedIPs));
      row.client = { ...client, uuid: client.id, id: 123 };
      return send({ success: true });
    }
    send({ msg: "unexpected endpoint" }, 500);
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  Object.assign(process.env, {
    BOT_TOKEN: "test", WEB_APP_URL: "http://localhost/app/", SESSION_JWT_SECRET: "test",
    XUI_PANEL_BASE_URL: `http://127.0.0.1:${server.address().port}`,
    XUI_USERNAME: "test", XUI_PASSWORD: "test", XUI_INBOUND_IDS: "3,4",
  });
  const api = await import("../src/xuiApi.js");
  await t.test("creates one identity on both routes and normalizes v3 update payload", async () => {
    const created = await api.addClientToInbound({ inboundId: 3, inboundIds: [3,4], telegramId: 90001, totalGB: 1024 });
    const found = await api.findClientInInbound({ inboundId: 3, telegramId: 90001 });
    assert.equal(found.client.id, created.creds.id);
    assert.equal(found.client.subId, created.creds.subId);
    assert.equal(state.adds, 1);
    await api.updateClientInInbound({ inboundId: 3, clientId: found.client.id, client: { ...found.client, enable: false } });
    assert.equal(state.rows[0].client.enable, false);
    assert.equal(state.rows[0].client.totalGB, 1024);
  });
  await t.test("recovers a client after its old inbound was deleted without resetting quota or secret", async () => {
    const row = state.rows[0]; row.inboundIds = [77];
    const before = structuredClone(row.client);
    const found = await api.findClientInInbound({ inboundId: 3, telegramId: 90001, allowUnattached: true });
    await api.ensureClientInbounds({ found, inbounds: await api.getProvisioningInbounds() });
    await api.ensureClientInbounds({ found: await api.findClientInInbound({ inboundId: 3, telegramId: 90001 }), inbounds: await api.getProvisioningInbounds() });
    assert.deepEqual(row.inboundIds, [77, 3, 4]);
    assert.deepEqual(row.client, before);
    assert.equal(state.adds, 1);
  });
  await t.test("rejects deleted inbound before attempting a create", async () => {
    await assert.rejects(api.addClientToInbound({ inboundId: 1, telegramId: 90002 }), /xui_inbound_not_found: 1/);
    assert.equal(state.adds, 1);
  });
  await t.test("lookup outages never mean customer not found", async () => {
    state.failLookup = true;
    await assert.rejects(api.findClientInInbound({ inboundId: 3, telegramId: 90001 }), /503/);
    state.failLookup = false;
  });
  await t.test("object-form inbound settings still work on legacy client API", async () => {
    state.modern = false;
    assert.equal((await api.listInboundClients(3)).length, 1);
    assert.ok((await api.findClientInInbound({ inboundId: 3, telegramId: 90001 })).client);
    state.modern = true;
  });
  await t.test("refreshes CSRF after a 403 without duplicating the header", async () => {
    state.csrf = "rotated-csrf";
    assert.equal((await api.listInbounds()).obj.length, 2);
  });
});

test("traffic bytes, expiry and exhausted quota match the panel", () => {
  const client = { totalGB: 1024, expiryTime: 2000, enable: true, limitIp: 2 };
  assert.equal(xuiSubscriptionStatus(client, { up: 10, down: 20 }, 1000).trafficLimitBytes, 1024);
  assert.equal(xuiSubscriptionStatus(client, {}, 2000).panelStatus, "EXPIRED");
  assert.equal(xuiSubscriptionStatus(client, { down: 1024 }, 1000).panelStatus, "LIMITED");
  assert.equal(xuiSubscriptionStatus({ ...client, expiryTime: -86400000 }, {}, 1000).panelStatus, "ACTIVE");
});

test("explicit inbound IDs and gRPC flow selection", () => {
  assert.deepEqual(parseInboundIds("3,4,3"), [3,4]);
  assert.throws(() => parseInboundIds("3,garbage"));
  assert.equal(clientFlowForInbounds([{ protocol: "vless", streamSettings: '{"network":"grpc","security":"tls"}' }]), "");
});

test("concurrent provision attempts are serialized and failures release the lock", async () => {
  const lock = createKeyedLock(); let created = false; let adds = 0;
  const provision = () => lock("customer", async () => {
    if (created) return;
    await new Promise((resolve) => setImmediate(resolve)); adds++; created = true;
  });
  await Promise.all([provision(), provision(), provision()]);
  assert.equal(adds, 1);
  await assert.rejects(lock("customer", async () => { throw Error("network"); }));
  assert.equal(await lock("customer", async () => "ok"), "ok");
});
