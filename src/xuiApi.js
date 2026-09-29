import { Agent } from "undici";
import crypto from "crypto";
import { config } from "./config.js";
import {
  fetchAuthenticatedXuiCsrfSession,
  loginXuiPanel,
} from "./integrations/xuiPanelLogin.js";
import { readXuiApiOrThrow } from "./integrations/xuiResponse.js";
import {
  parsePanelObject,
  resolveProvisioningInboundIds,
  selectProvisioningInbounds,
  clientFlowForInbounds,
} from "./integrations/xuiClients.js";
import { createMtprotoReader } from "./integrations/mtprotoPanel.js";

let cachedCookie = null;
let cachedCsrf = "";
let cookieExpiresAt = 0;
let insecureDispatcher;

function getDispatcher() {
  return config.xui.insecureTls
    ? (insecureDispatcher ||= new Agent({ connect: { rejectUnauthorized: false } }))
    : undefined;
}

function urlJoin(base, p) {
  const b = String(base || "").replace(/\/$/, "");
  const path = String(p || "");
  return `${b}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Корень панели: совпадает с webBasePath в 3X-UI (с регистром). */
export function getPanelRoot() {
  const base = String(config.xui.panelBaseUrl || "").trim();
  const wp = String(config.xui.webBasePath || "").trim();
  if (!base) return "";
  if (!wp) return base.replace(/\/+$/, "");
  let path = wp.startsWith("/") ? wp : `/${wp}`;
  path = path.replace(/\/+$/, "");
  try {
    const u = new URL(base.includes("://") ? base : `https://${base}`);
    return `${u.origin}${path}`;
  } catch {
    return `${base.replace(/\/+$/, "")}${path}`;
  }
}

async function parseResponseJson(res, errorPrefix) {
  return await readXuiApiOrThrow(res, errorPrefix);
}

async function xuiLogin() {
  const root = getPanelRoot();
  if (!root || !config.xui.username || !config.xui.password) {
    throw new Error("xui_not_configured");
  }
  const dispatcher = getDispatcher();
  const session = await loginXuiPanel({
    root,
    username: config.xui.username,
    password: config.xui.password,
    dispatcher,
    errorPrefix: "xui_login",
  });
  // loginXuiPanel returns cookie string (legacy) or { cookie, csrfToken }
  if (session && typeof session === "object" && session.cookie) {
    cachedCookie = session.cookie;
    cachedCsrf = String(session.csrfToken || "").trim();
  } else {
    cachedCookie = session;
    cachedCsrf = "";
  }
  cookieExpiresAt = Date.now() + 25 * 60 * 1000;
  return cachedCookie;
}

async function xuiCookie() {
  if (cachedCookie && Date.now() < cookieExpiresAt) return cachedCookie;
  return await xuiLogin();
}

function applySessionHeaders(headers) {
  if (cachedCookie) headers.Cookie = cachedCookie;
  if (cachedCsrf) {
    // Header names are case-insensitive. Sending both case variants makes
    // undici combine them as "token, token", which always fails 3X-UI's
    // constant-time equality check and results in an empty HTTP 403.
    headers["X-CSRF-Token"] = cachedCsrf;
  }
}

async function refreshXuiCsrfToken() {
  const root = getPanelRoot();
  if (!root || !cachedCookie) return false;
  try {
    const fresh = await fetchAuthenticatedXuiCsrfSession(root, {
      cookie: cachedCookie,
      dispatcher: getDispatcher(),
    });
    if (fresh.cookies) cachedCookie = fresh.cookies;
    if (!fresh.ok || !fresh.token) {
      console.warn("[xui] csrf refresh rejected:", { status: fresh.status, hasToken: false });
      return false;
    }
    cachedCsrf = fresh.token;
    return true;
  } catch (e) {
    console.warn("[xui] csrf refresh failed:", String(e?.message || e));
    return false;
  }
}

async function discardFetchResponse(res) {
  await res?.arrayBuffer?.().catch(() => {});
}

async function xuiFetch(path, { method = "GET", json } = {}) {
  const root = getPanelRoot();
  const dispatcher = getDispatcher();
  await xuiCookie();
  const headers = {
    Accept: "application/json",
    "X-Requested-With": "XMLHttpRequest",
  };
  applySessionHeaders(headers);
  if (json !== undefined) headers["Content-Type"] = "application/json";

  let res;
  try {
    res = await fetch(urlJoin(root, path), {
      method,
      headers,
      body: json !== undefined ? JSON.stringify(json) : undefined,
      signal: AbortSignal.timeout(15000),
      ...(dispatcher ? { dispatcher } : {}),
    });
  } catch (e) {
    const cause = e?.cause?.code || e?.cause?.message || e?.message || e;
    throw new Error(`xui_fetch_failed: ${String(cause)} (url=${urlJoin(root, path)})`);
  }

  // Match the official 3X-UI v3 SPA: refresh CSRF and retry once on 403.
  if (res.status === 403) {
    await discardFetchResponse(res);
    const refreshed = await refreshXuiCsrfToken();
    if (refreshed) {
      applySessionHeaders(headers);
      try {
        res = await fetch(urlJoin(root, path), {
          method,
          headers,
          body: json !== undefined ? JSON.stringify(json) : undefined,
          signal: AbortSignal.timeout(15000),
          ...(dispatcher ? { dispatcher } : {}),
        });
      } catch (e) {
        const cause = e?.cause?.code || e?.cause?.message || e?.message || e;
        throw new Error(`xui_fetch_failed_after_csrf_refresh: ${String(cause)} (url=${urlJoin(root, path)})`);
      }
      if (res.status !== 401 && res.status !== 403) return res;
    }
  }

  if (res.status === 401 || res.status === 403) {
    await discardFetchResponse(res);
    cachedCookie = null;
    cachedCsrf = "";
    cookieExpiresAt = 0;
    await xuiCookie();
    applySessionHeaders(headers);
    try {
      res = await fetch(urlJoin(root, path), {
        method,
        headers,
        body: json !== undefined ? JSON.stringify(json) : undefined,
        signal: AbortSignal.timeout(15000),
        ...(dispatcher ? { dispatcher } : {}),
      });
    } catch (e) {
      const cause = e?.cause?.code || e?.cause?.message || e?.message || e;
      throw new Error(`xui_fetch_failed_after_relogin: ${String(cause)} (url=${urlJoin(root, path)})`);
    }
  }
  return res;
}

function endpointUnavailable(res) {
  return res?.status === 404 || res?.status === 405;
}

async function discardResponse(res) {
  await res?.arrayBuffer?.().catch(() => {});
}

export async function listInbounds() {
  const res = await xuiFetch("/panel/api/inbounds/list");
  return await parseResponseJson(res, "xui_list_inbounds");
}

export const getSharedMtproto = createMtprotoReader({ settings: config.mtproto, readPrimaryInbounds: listInbounds });

/** Статистика трафика клиента по email (как в панели). */
export async function getClientTrafficsByEmail(email) {
  const enc = encodeURIComponent(String(email || "").trim());
  if (!enc) throw new Error("xui_email_required");
  // 3X-UI v3.5 moved client operations out of /inbounds into /clients.
  let res = await xuiFetch(`/panel/api/clients/traffic/${enc}`);
  if (endpointUnavailable(res)) {
    await discardResponse(res);
    res = await xuiFetch(`/panel/api/inbounds/getClientTraffics/${enc}`);
  }
  return await parseResponseJson(res, "xui_get_traffic");
}

function safeJsonParse(s) {
  return parsePanelObject(s);
}

function normalizeClientsFromInbound(inbound) {
  const st = safeJsonParse(inbound?.settings);
  const clients = st?.clients;
  if (Array.isArray(clients)) return clients;
  return [];
}

function normalizeV3ClientRecord(record) {
  if (!record || typeof record !== "object") return null;
  const uuid = String(record.uuid || record.id || "").trim();
  return {
    ...record,
    // /clients/get uses numeric `id` for the database row and `uuid` for the
    // Xray credential. Legacy inbound clients expose that credential as `id`.
    ...(uuid ? { id: uuid } : {}),
  };
}

function normalizeStringArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  if (value == null) return [];

  const text = String(value).trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (parsed !== value) return normalizeStringArray(parsed);
  } catch {
    // Older 3X-UI versions may return a plain comma-separated string.
  }
  return text.split(/[\r\n,]+/).map((item) => item.trim()).filter(Boolean);
}

function normalizeClientForWrite(client) {
  const normalized = { ...client };
  if (Object.prototype.hasOwnProperty.call(normalized, "allowedIPs")) {
    normalized.allowedIPs = normalizeStringArray(normalized.allowedIPs);
  }
  return normalized;
}

async function findClientViaV3Api({ inboundId, telegramId, allowUnattached = false }) {
  const res = await xuiFetch(`/panel/api/clients/get/tgId/${encodeURIComponent(telegramId)}`);
  if (endpointUnavailable(res)) {
    await discardResponse(res);
    return null;
  }
  const data = await parseResponseJson(res, "xui_get_client");
  const rows = data?.obj ?? data?.response ?? data;
  if (!Array.isArray(rows)) throw new Error("xui_get_client: invalid response");
  const attached = rows.filter((row) => row.inboundIds?.map(Number).includes(Number(inboundId)));
  const candidates = attached.length ? attached : allowUnattached ? rows : [];
  const obj = candidates.find((row) => row.client?.email === stableXuiEmailFromTelegramId(telegramId)) ||
    (candidates.length === 1 ? candidates[0] : null);
  if (!obj && candidates.length > 1) throw new Error("xui_ambiguous_client");
  const client = normalizeV3ClientRecord(obj?.client);
  if (!client) return null;
  const inboundIds = Array.isArray(obj?.inboundIds)
    ? obj.inboundIds.map((id) => Number(id)).filter(Number.isFinite)
    : [];
  return { inbound: null, client, inboundIds, api: "clients-v3" };
}

/**
 * Вернуть список клиентов из inbound.settings.clients (сырой объект XUI).
 * Нужен для массового импорта tgId/subId/expiryTime в нашу БД.
 */
export async function listInboundClients(inboundId) {
  const list = await listInbounds();
  const inb = list?.obj?.find?.((x) => Number(x?.id) === Number(inboundId)) || null;
  if (!inb) return [];
  return normalizeClientsFromInbound(inb);
}

function xuiEmailHashHex(telegramId, len = 16) {
  const tid = String(telegramId || "").trim();
  return crypto
    .createHash("sha256")
    .update(`xui-email:${tid}`)
    .digest("hex")
    .slice(0, len);
}

function invisiblePayloadFromHash(hashHex) {
  // Часть клиентов показывает `email` рядом с remark. Чтобы не светить хвосты (tg_/u_/цифры),
  // кодируем стабильный id в zero-width символы: визуально строка пустая, но остаётся уникальной.
  const zw0 = "\u200B";
  const zw1 = "\u200C";
  let payload = "";
  for (const ch of hashHex) {
    const n = Number.parseInt(ch, 16);
    payload += n.toString(2).padStart(4, "0").replaceAll("0", zw0).replaceAll("1", zw1);
  }
  return payload;
}

function legacyEmailCandidatesFromTelegramId(telegramId) {
  const tid = String(telegramId || "").trim();
  const h12 = xuiEmailHashHex(tid, 12);
  const h15 = xuiEmailHashHex(tid, 15);
  const asNum = Number.parseInt(h15, 16);
  const digits = String(Number.isFinite(asNum) ? asNum % 10_000_000_000 : 0).padStart(10, "0");
  const mark = "\u2063";
  const payload = invisiblePayloadFromHash(xuiEmailHashHex(tid, 16));
  return [
    `tg_${tid}`,
    `u_${h12}`,
    digits,
    `${mark}${payload}`, // old zero-width format without visible suffix
  ];
}

export function stableXuiEmailFromTelegramId(telegramId) {
  const mark = "\u2063";
  const payload = invisiblePayloadFromHash(xuiEmailHashHex(telegramId, 16));
  const suffix = String(config.xui.clientDisplaySuffix || "🌐").trim() || "🌐";
  return `${suffix}${mark}${payload}`;
}

/** Первый клиент в инбаунде с этим Telegram (по tgId / стабильному email). */
export async function findClientInInbound({ inboundId, telegramId, allowUnattached = false }) {
  // 3X-UI v3.5 stores clients as first-class rows. The new row is visible via
  // /clients/get even when /inbounds/list no longer embeds it in settings.
  const v3 = await findClientViaV3Api({ inboundId, telegramId, allowUnattached });
  if (v3?.client) return v3;

  const list = await listInbounds();
  const inb = list?.obj?.find?.((x) => Number(x?.id) === Number(inboundId)) || null;
  if (!inb) throw new Error(`xui_inbound_not_found: ${inboundId}`);
  const clients = normalizeClientsFromInbound(inb);
  const tid = String(telegramId);
  const emailStable = stableXuiEmailFromTelegramId(telegramId);
  const legacyEmails = new Set(legacyEmailCandidatesFromTelegramId(telegramId));
  const pick =
    clients.find((c) => String(c?.tgId || "") === tid) ||
    clients.find((c) => String(c?.email || "") === emailStable) ||
    clients.find((c) => legacyEmails.has(String(c?.email || ""))) ||
    clients.find((c) => String(c?.remark || c?.Remark || "").includes(tid)) ||
    clients.find((c) => String(c?.email || "").startsWith(`${emailStable}_`)) ||
    null;
  if (!pick) return null;
  return { inbound: inb, client: pick, inboundIds: [Number(inboundId)] };
}

export async function getProvisioningInbounds(inboundIds = config.xui.inboundIds) {
  const list = await listInbounds();
  const rows = list.obj || [];
  const resolvedIds = resolveProvisioningInboundIds(rows, inboundIds, {
    autoDiscover: config.xui.autoDiscoverInbounds,
    excludedIds: config.xui.inboundExcludeIds,
  });
  return selectProvisioningInbounds(rows, resolvedIds);
}

export async function ensureClientInbounds({ found, inbounds }) {
  const ids = inbounds.map((row) => Number(row.id));
  const missing = ids.filter((id) => !found.inboundIds?.includes(id));
  if (!missing.length) return;
  const res = await xuiFetch(`/panel/api/clients/${encodeURIComponent(found.client.email)}/attach`, {
    method: "POST", json: { inboundIds: missing },
  });
  if (!endpointUnavailable(res)) {
    await parseResponseJson(res, "xui_attach_client");
    return;
  }
  await discardResponse(res);
  // Legacy panels keep credentials inside each inbound. Preserve those credentials.
  const list = await listInbounds();
  for (const id of missing) {
    const inbound = list.obj?.find((row) => Number(row.id) === id);
    const existing = normalizeClientsFromInbound(inbound).find((c) => c.email === found.client.email);
    if (existing) continue;
    const client = normalizeClientForWrite(found.client);
    if (String(inbound?.protocol || "").toLowerCase() === "hysteria" && !client.auth) {
      client.auth = crypto.randomBytes(16).toString("hex");
    }
    const added = await xuiFetch("/panel/api/inbounds/addClient", {
      method: "POST", json: { id, settings: JSON.stringify({ clients: [client] }) },
    });
    await parseResponseJson(added, "xui_attach_client");
  }
}

export async function getClientSubIdFromInbound({ inboundId, telegramId, email }) {
  const found = await findClientInInbound({ inboundId, telegramId }).catch(() => null);
  if (found?.client?.subId) return String(found.client.subId);
  if (email) {
    const list = await listInbounds();
    const inb = list?.obj?.find?.((x) => Number(x?.id) === Number(inboundId)) || null;
    if (!inb) return null;
    const clients = normalizeClientsFromInbound(inb);
    const pick = clients.find((c) => String(c?.email || "") === String(email)) || null;
    const subId = pick?.subId ? String(pick.subId) : "";
    return subId || null;
  }
  return null;
}

export function generateClientCreds({ telegramId }) {
  const tid = String(telegramId);
  const id = crypto.randomUUID();
  // 3X-UI subscription ids are commonly short tokens (often 16+ chars).
  // Using UUID here can lead to 400 errors on /sub/<id> on some builds.
  const subId = crypto.randomBytes(8).toString("hex"); // 16 chars
  const email = stableXuiEmailFromTelegramId(telegramId);
  const auth = crypto.randomBytes(16).toString("hex");
  return { id, subId, email, auth };
}

export async function addClientToInbound({
  inboundId,
  inboundIds = [Number(inboundId)],
  telegramId,
  totalGB = 0,
  expiryTime = 0,
  limitIp = 0,
  remark = "",
}) {
  if (!inboundId) throw new Error("xui_inbound_id_required");
  const inbounds = await getProvisioningInbounds(inboundIds);
  const provisioningInboundIds = inbounds.map((row) => Number(row.id));
  const creds = generateClientCreds({ telegramId });

  // 3X-UI expects settings as a JSON string containing { clients: [...] }
  const clientRow = {
    id: creds.id,
    email: creds.email,
    enable: true,
    limitIp,
    totalGB,
    expiryTime,
    // 3X-UI v3.x models tgId as int64. Sending a JSON number is accepted by
    // both the new /clients/add endpoint and legacy inbound settings.
    tgId: Number(telegramId),
    subId: creds.subId,
    auth: creds.auth,
    security: "auto",
    flow: clientFlowForInbounds(inbounds),
    reset: 0,
    comment: "",
  };
  const r = String(remark || "").trim();
  if (r) {
    clientRow.remark = r;
    clientRow.comment = r;
  }

  const settings = {
    clients: [clientRow],
  };

  // 3X-UI v3.5 client-first API. It creates the client and attaches it to
  // the requested inbound in one transaction. Older panels return 404/405,
  // in which case we retry through the legacy inbound endpoint.
  let res = await xuiFetch("/panel/api/clients/add", {
    method: "POST",
    json: {
      client: clientRow,
      inboundIds: provisioningInboundIds,
    },
  });
  if (endpointUnavailable(res)) {
    await discardResponse(res);
    res = await xuiFetch("/panel/api/inbounds/addClient", {
      method: "POST",
      json: {
        id: Number(inboundId),
        settings: JSON.stringify(settings),
      },
    });
  }
  // Never swallow API errors: previously .catch(() => ({})) let grant succeed with a
  // locally generated subId that never existed in 3X-UI → /sub/<id> 404 → upstream_failed.
  const data = await parseResponseJson(res, "xui_add_client");
  if (data && typeof data === "object" && data.success === false) {
    const msg = String(data.msg || data.message || "addClient_rejected").trim();
    throw new Error(`xui_add_client: ${msg}`);
  }

  const found = await findClientInInbound({ inboundId, telegramId });
  if (found) await ensureClientInbounds({ found, inbounds });

  const effective = await getClientSubIdFromInbound({
    inboundId,
    telegramId,
    email: creds.email,
  }).catch(() => null);
  const subIdEffective = String(effective || "").trim();
  if (!subIdEffective) {
    throw new Error(
      "xui_add_client: client not found in inbound after addClient " +
        `(inboundId=${inboundId}). ` +
        "Check XUI_INBOUND_ID, panel credentials, and that addClient actually persists the client.",
    );
  }
  return {
    ok: true,
    creds: { ...creds, subId: subIdEffective, subIdEffective },
    response: data,
  };
}

export async function updateClientInInbound({ inboundId, clientId, client }) {
  if (!inboundId) throw new Error("xui_inbound_id_required");
  const cid = String(clientId || "").trim();
  if (!cid) throw new Error("xui_client_id_required");
  if (!client || typeof client !== "object") throw new Error("xui_client_required");

  const normalizedClient = normalizeClientForWrite(client);
  const email = String(normalizedClient.email || "").trim();
  let res = email
    ? await xuiFetch(`/panel/api/clients/update/${encodeURIComponent(email)}`, {
        method: "POST",
        json: normalizedClient,
      })
    : null;
  if (!res || endpointUnavailable(res)) {
    if (res) await discardResponse(res);
    const settings = { clients: [normalizedClient] };
    res = await xuiFetch(`/panel/api/inbounds/updateClient/${encodeURIComponent(cid)}`, {
      method: "POST",
      json: {
        id: Number(inboundId),
        settings: JSON.stringify(settings),
      },
    });
  }
  return await parseResponseJson(res, "xui_update_client");
}

export async function incrementClientLimitIp({ inboundId, telegramId, addSlots = 1, minFloor = 1 }) {
  const found = await findClientInInbound({ inboundId, telegramId });
  if (!found?.client) throw new Error("xui_client_not_found");

  const cur = Number(found.client.limitIp ?? 0);
  const inc = Number(addSlots || 1);
  if (!Number.isFinite(inc) || inc < 1) throw new Error("bad_slots");

  // В 3X-UI limitIp: 0 = без лимита. Для «+1 устройство» переводим в лимитный режим.
  const floor = Number.isFinite(Number(minFloor)) && Number(minFloor) > 0
    ? Math.floor(Number(minFloor))
    : 1;
  const base = Number.isFinite(cur) && cur > 0 ? cur : floor;
  const next = base + inc;

  const clientId = String(found.client.id || found.client.ID || "").trim();
  if (!clientId) throw new Error("xui_client_id_missing");

  const patch = { ...found.client, limitIp: next };
  await updateClientInInbound({ inboundId, clientId, client: patch });
  return { previous: cur, next, email: found.client.email || null };
}

