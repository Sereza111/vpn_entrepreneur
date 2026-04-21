import { config } from "./config.js";

function authHeaders() {
  if (!config.timeweb.apiToken) throw new Error("timeweb_not_configured");
  return {
    Authorization: `Bearer ${config.timeweb.apiToken}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

async function twFetch(path, { method = "GET", body } = {}) {
  const url = `${config.timeweb.apiBaseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, {
    method,
    headers: authHeaders(),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text().catch(() => "");
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    throw new Error(`timeweb_${method.toLowerCase()}_${path}:${res.status}:${text || "failed"}`);
  }
  return json;
}

function extractIps(payload) {
  const arr =
    (Array.isArray(payload?.ips) && payload.ips) ||
    (Array.isArray(payload?.server_ips) && payload.server_ips) ||
    (Array.isArray(payload?.data) && payload.data) ||
    [];
  return arr;
}

function toIpInfo(raw) {
  if (!raw || typeof raw !== "object") return null;
  const ip =
    String(raw.ip || raw.ip_address || raw.address || "").trim() ||
    "";
  const id =
    String(raw.id || raw.ip_id || raw.ipAddressId || "").trim() ||
    "";
  if (!ip && !id) return null;
  return {
    ip: ip || null,
    id: id || null,
    isMain: Boolean(raw.is_main || raw.isMain),
    version: Number(raw.version || 4),
    raw,
  };
}

export async function listServerIPs(serverId) {
  const sid = String(serverId || "").trim();
  if (!sid) throw new Error("timeweb_server_id_required");
  const payload = await twFetch(`/api/v1/servers/${encodeURIComponent(sid)}/ips`);
  return extractIps(payload).map(toIpInfo).filter(Boolean);
}

export async function addServerIPv4(serverId) {
  const sid = String(serverId || "").trim();
  if (!sid) throw new Error("timeweb_server_id_required");
  // According to SDK/terraform, enum is `ipv4`/`ipv6`, but API may be strict / inconsistent.
  // We try a small set of known variants to be robust.
  const candidates = ["ipv4", "IPv4", "IPV4"];
  let lastErr = null;
  let payload = null;
  for (const t of candidates) {
    try {
      payload = await twFetch(`/api/v1/servers/${encodeURIComponent(sid)}/ips`, {
        method: "POST",
        body: { type: t },
      });
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!payload) {
    // Final attempt: sometimes backend accepts empty body (example in SDK docs),
    // even though schema shows required `type`.
    try {
      payload = await twFetch(`/api/v1/servers/${encodeURIComponent(sid)}/ips`, {
        method: "POST",
        body: {},
      });
      lastErr = null;
    } catch (e2) {
      lastErr = e2;
    }
  }
  if (!payload && lastErr) throw lastErr;
  const ips = extractIps(payload).map(toIpInfo).filter(Boolean);
  if (ips.length) return ips[ips.length - 1];
  // fallback: read list and take non-main IPv4
  const list = await listServerIPs(sid);
  const nonMain = list.filter((x) => !x.isMain && Number(x.version || 4) === 4);
  return nonMain[nonMain.length - 1] || list[list.length - 1] || null;
}

export async function deleteServerIP(serverId, ipId) {
  const sid = String(serverId || "").trim();
  const iid = String(ipId || "").trim();
  if (!sid) throw new Error("timeweb_server_id_required");
  if (!iid) throw new Error("timeweb_ip_id_required");
  await twFetch(`/api/v1/servers/${encodeURIComponent(sid)}/ips/${encodeURIComponent(iid)}`, {
    method: "DELETE",
  });
  return { ok: true };
}

