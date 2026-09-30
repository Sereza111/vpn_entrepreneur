import test from "node:test";
import assert from "node:assert/strict";
import { createMtprotoReader } from "../src/integrations/mtprotoPanel.js";

const settings = {
  inboundId: 3, email: "shared", host: "nl.example.test",
  panelBaseUrl: "https://nl.example.test:10665/panel-prefix/", apiToken: "nl-only-token",
};
const secret = "ee" + "ab".repeat(16) + Buffer.from("example.test").toString("hex");
const inbound = { id: 3, protocol: "mtproto", port: 1443, enable: true,
  settings: { clients: [{ email: "shared", enable: true, secret }] } };
const response = () => Response.json({ success: true, obj: [inbound] });

test("separate panel uses its own URL, token, inbound and public host", async () => {
  let requests = 0;
  const read = createMtprotoReader({ settings,
    readPrimaryInbounds: () => { throw Error("must not read the RU panel with NL inbound ID"); },
    fetchImpl: async (url, options) => {
      requests++;
      assert.equal(url, "https://nl.example.test:10665/panel-prefix/panel/api/inbounds/list");
      assert.equal(options.headers.Authorization, "Bearer nl-only-token");
      assert.equal(options.headers.Cookie, undefined);
      assert.equal(options.redirect, "error");
      return response();
    },
  });
  const results = await Promise.all([read(), read()]);
  assert.deepEqual(results[0], { host: settings.host, port: 1443, secret });
  assert.deepEqual(results[0], results[1]);
  assert.equal(requests, 1);
});

test("primary-panel configuration remains supported without a separate token", async () => {
  const read = createMtprotoReader({ settings: { ...settings, panelBaseUrl: "", apiToken: "" },
    readPrimaryInbounds: async () => ({ obj: [inbound] }),
    fetchImpl: () => { throw Error("must use primary session"); },
  });
  assert.equal((await read()).port, 1443);
});

test("remote auth failure never falls back to an unrelated primary-panel secret", async () => {
  let time = 1000, requests = 0;
  const read = createMtprotoReader({ settings, now: () => time,
    readPrimaryInbounds: () => { throw Error("wrong panel fallback"); },
    fetchImpl: async () => { requests++; return requests === 1 ? new Response("", { status: 401 }) : response(); },
  });
  await assert.rejects(read(), /mtproto_panel_http_401/);
  await assert.rejects(read(), /mtproto_panel_http_401/);
  assert.equal(requests, 1);
  time += 5001;
  assert.equal((await read()).host, settings.host);
  assert.equal(requests, 2);
});

test("remote panel must have a token and return an authenticated list", async () => {
  const missing = createMtprotoReader({ settings: { ...settings, apiToken: "" }, fetchImpl: () => assert.fail("must not send anonymous request") });
  await assert.rejects(missing(), /mtproto_panel_token_required/);
  const invalid = createMtprotoReader({ settings, fetchImpl: async () => Response.json({ success: false }) });
  await assert.rejects(invalid(), /mtproto_panel_invalid_response/);
});
