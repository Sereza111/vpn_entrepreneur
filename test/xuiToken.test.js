import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";

test("dedicated panel token supports reads and mutations without a login session", async (t) => {
  const requests = [];
  let denied = 0;
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({ path: req.url, method: req.method, headers: req.headers, body });
    res.writeHead(denied || 200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: !denied, obj: [] }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  Object.assign(process.env, {
    BOT_TOKEN: "test", WEB_APP_URL: "http://localhost/app/", SESSION_JWT_SECRET: "test",
    XUI_PANEL_BASE_URL: `http://127.0.0.1:${server.address().port}`,
    XUI_WEB_BASE_PATH: "/panel-root/", XUI_API_TOKEN: "test-service-token",
    XUI_USERNAME: "", XUI_PASSWORD: "",
  });
  const api = await import("../src/xuiApi.js");
  assert.equal(api.isXuiConfigured(), true);
  await api.listInbounds();
  await api.updateClientInInbound({ inboundId: 1, clientId: "test-uuid", client: { id: "test-uuid", email: "test-client", enable: false } });
  assert.deepEqual(requests.map(({ method, path }) => [method, path]), [
    ["GET", "/panel-root/panel/api/inbounds/list"],
    ["POST", "/panel-root/panel/api/clients/update/test-client"],
  ]);
  for (const { headers } of requests) {
    assert.equal(headers.authorization, "Bearer test-service-token");
    assert.equal(headers.cookie, undefined);
    assert.equal(headers["x-csrf-token"], undefined);
  }
  for (const status of [401, 403]) {
    denied = status;
    const before = requests.length;
    await assert.rejects(api.listInbounds(), new RegExp(String(status)));
    assert.equal(requests.length, before + 1, "invalid token must not fall back to login or retry mutations");
  }
});
