import { sharedMtprotoFromInbounds } from "./mtproto.js";

// MTProto can live on another panel. Do not reuse the primary VPN panel's
// credentials, session, or inbound IDs for an explicitly configured host.
export function createMtprotoReader({ settings, readPrimaryInbounds, fetchImpl = fetch, now = Date.now }) {
  let cached;
  async function read() {
    let rows;
    if (settings.panelBaseUrl) {
      if (!settings.apiToken) throw new Error("mtproto_panel_token_required");
      const root = new URL(settings.panelBaseUrl);
      if (!["https:", "http:"].includes(root.protocol) || root.username || root.password || root.search || root.hash) {
        throw new Error("mtproto_panel_url_invalid");
      }
      const url = `${root.href.replace(/\/+$/, "")}/panel/api/inbounds/list`;
      const response = await fetchImpl(url, {
        headers: { Accept: "application/json", Authorization: `Bearer ${settings.apiToken}` },
        signal: AbortSignal.timeout(8000),
        redirect: "error",
      });
      if (!response.ok) {
        await response.arrayBuffer().catch(() => {});
        throw new Error(`mtproto_panel_http_${response.status}`);
      }
      const data = await response.json();
      if (data?.success !== true || !Array.isArray(data.obj)) throw new Error("mtproto_panel_invalid_response");
      rows = data.obj;
    } else {
      const data = await readPrimaryInbounds();
      rows = data.obj || [];
    }
    return sharedMtprotoFromInbounds(rows, settings, now());
  }
  return async () => {
    if (!settings.inboundId || !settings.email || !settings.host) return null;
    if (cached?.until > now()) return cached.promise;
    const entry = { until: now() + 30_000, promise: read() };
    cached = entry;
    try { return await entry.promise; }
    catch (error) {
      // Briefly cache failures too: /api/me is polled by every mini-app user.
      if (cached === entry) entry.until = now() + 5000;
      throw error;
    }
  };
}
