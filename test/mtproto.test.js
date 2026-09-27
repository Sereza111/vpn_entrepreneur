import test from "node:test";
import assert from "node:assert/strict";
import { sharedMtprotoFromInbounds } from "../src/integrations/mtproto.js";

test("only the explicitly shared, enabled MTProto secret reaches the mini app", () => {
  const settings = { inboundId: 5, email: "shared", host: "telegram.example.test" };
  const secret = "ee" + "ab".repeat(16) + Buffer.from("example.test").toString("hex");
  const inbound = { id: 5, protocol: "mtproto", port: 443, enable: true,
    settings: { clients: [{ email: "private", secret: "do-not-expose" }, { email: "shared", secret, enable: true }] } };
  assert.deepEqual(sharedMtprotoFromInbounds([inbound], settings), { host: settings.host, port: 443, secret });
  assert.equal(sharedMtprotoFromInbounds([inbound], { ...settings, email: "absent" }), null);
  assert.equal(sharedMtprotoFromInbounds([{ ...inbound, enable: false }], settings), null);
  inbound.settings.clients[1].expiryTime = 1;
  assert.equal(sharedMtprotoFromInbounds([inbound], settings), null);
  inbound.settings.clients[1].expiryTime = 0;
  inbound.settings = JSON.stringify(inbound.settings);
  assert.equal(sharedMtprotoFromInbounds([inbound], settings).secret, secret);
});
