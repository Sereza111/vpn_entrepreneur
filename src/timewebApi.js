import { config } from "./config.js";

export class TimewebApiError extends Error {
  constructor(message, { status, errorCode, responseId, details, raw } = {}) {
    super(message);
    this.name = "TimewebApiError";
    this.status = status;
    this.errorCode = errorCode;
    this.responseId = responseId;
    this.details = details;
    this.raw = raw;
  }
}

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
    const status = res.status;
    const errorCode = json?.error_code || json?.errorCode || null;
    const responseId = json?.response_id || json?.responseId || null;
    const details = json?.details || null;
    const msg = `timeweb_${method.toLowerCase()}_${path}:${status}:${text || "failed"}`;
    throw new TimewebApiError(msg, { status, errorCode, responseId, details, raw: json || text });
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
  // Dedicated IP here is IPv4. If Timeweb refuses due to balance, surface it explicitly.
  let payload;
  try {
    payload = await twFetch(`/api/v1/servers/${encodeURIComponent(sid)}/ips`, {
      method: "POST",
      body: { type: "ipv4" },
    });
  } catch (e) {
    if (e instanceof TimewebApiError && e.errorCode === "no_balance_for_month") {
      const required = Number(e.details?.required_balance || 0) || null;
      throw new TimewebApiError("timeweb_no_balance_for_month", {
        status: e.status,
        errorCode: e.errorCode,
        responseId: e.responseId,
        details: { required_balance: required },
        raw: e.raw,
      });
    }
    throw e;
  }
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

