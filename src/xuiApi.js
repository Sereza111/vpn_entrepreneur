import { Agent } from "undici";
import crypto from "crypto";
import { config } from "./config.js";

let cachedCookie = null;
let cookieExpiresAt = 0;

function getDispatcher() {
  return config.xui.insecureTls
    ? new Agent({ connect: { rejectUnauthorized: false } })
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

function encodeForm(obj) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(obj || {})) {
    sp.set(k, String(v ?? ""));
  }
  return sp.toString();
}

function pickCookie(setCookieHeaders) {
  // 3X-UI typically uses session cookies like "3x-ui=...; Path=/; HttpOnly"
  // We just need "name=value" pairs.
  const arr = Array.isArray(setCookieHeaders)
    ? setCookieHeaders
    : setCookieHeaders
      ? [setCookieHeaders]
      : [];
  const pairs = [];
  for (const h of arr) {
    const first = String(h || "").split(";")[0].trim();
    if (first.includes("=")) pairs.push(first);
  }
  return pairs.join("; ");
}

async function xuiLogin() {
  const root = getPanelRoot();
  if (!root || !config.xui.username || !config.xui.password) {
    throw new Error("xui_not_configured");
  }
  const dispatcher = getDispatcher();
  const res = await fetch(urlJoin(root, "/login"), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: encodeForm({ username: config.xui.username, password: config.xui.password }),
    redirect: "manual",
    ...(dispatcher ? { dispatcher } : {}),
  });
  if (!res.ok && res.status !== 302) {
    const t = await res.text().catch(() => "");
    const hint =
      res.status === 404
        ? " Проверь XUI_WEB_BASE_PATH: скопируй точный «Web Base Path» из 3X-UI (регистр букв!)."
        : "";
    throw new Error(`xui_login_failed: ${res.status} ${t}${hint}`.trim());
  }
  const sc = res.headers.getSetCookie?.() || res.headers.get("set-cookie");
  const cookie = pickCookie(sc);
  if (!cookie) throw new Error("xui_login_no_cookie");
  cachedCookie = cookie;
  cookieExpiresAt = Date.now() + 25 * 60 * 1000;
  return cookie;
}

async function xuiCookie() {
  if (cachedCookie && Date.now() < cookieExpiresAt) return cachedCookie;
  return await xuiLogin();
}

async function xuiFetch(path, { method = "GET", json } = {}) {
  const root = getPanelRoot();
  const dispatcher = getDispatcher();
  const cookie = await xuiCookie();
  const headers = {
    Accept: "application/json",
    Cookie: cookie,
  };
  if (json !== undefined) headers["Content-Type"] = "application/json";

  let res = await fetch(urlJoin(root, path), {
    method,
    headers,
    body: json !== undefined ? JSON.stringify(json) : undefined,
    ...(dispatcher ? { dispatcher } : {}),
  });

  if (res.status === 401) {
    cachedCookie = null;
    const cookie2 = await xuiCookie();
    headers.Cookie = cookie2;
    res = await fetch(urlJoin(root, path), {
      method,
      headers,
      body: json !== undefined ? JSON.stringify(json) : undefined,
      ...(dispatcher ? { dispatcher } : {}),
    });
  }
  return res;
}

export async function listInbounds() {
  const res = await xuiFetch("/panel/api/inbounds/list");
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`xui_list_inbounds: ${res.status} ${t}`.trim());
  }
  return await res.json();
}

/** Статистика трафика клиента по email (как в панели). */
export async function getClientTrafficsByEmail(email) {
  const enc = encodeURIComponent(String(email || "").trim());
  if (!enc) throw new Error("xui_email_required");
  const res = await xuiFetch(`/panel/api/inbounds/getClientTraffics/${enc}`);
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`xui_get_traffic: ${res.status} ${t}`.trim());
  }
  return await res.json();
}

function safeJsonParse(s) {
  try {
    return JSON.parse(String(s || ""));
  } catch {
    return null;
  }
}

function normalizeClientsFromInbound(inbound) {
  const st = safeJsonParse(inbound?.settings);
  const clients = st?.clients;
  if (Array.isArray(clients)) return clients;
  return [];
}

export function stableXuiEmailFromTelegramId(telegramId) {
  const tid = String(telegramId || "").trim();
  const hashHex = crypto
    .createHash("sha256")
    .update(`xui-email:${tid}`)
    .digest("hex")
    .slice(0, 15);
  // Делаем только цифры (без букв), чтобы VPN-клиенты не показывали "u_abcd...".
  // Поле email в 3X-UI техническое, но часть клиентов рисует его в UI.
  const asNum = Number.parseInt(hashHex, 16);
  const digits = String(Number.isFinite(asNum) ? asNum % 10_000_000_000 : 0).padStart(10, "0");
  return digits;
}

/** Первый клиент в инбаунде с этим Telegram (по tgId / стабильному email). */
export async function findClientInInbound({ inboundId, telegramId }) {
  const list = await listInbounds();
  const inb = list?.obj?.find?.((x) => Number(x?.id) === Number(inboundId)) || null;
  if (!inb) return null;
  const clients = normalizeClientsFromInbound(inb);
  const tid = String(telegramId);
  const emailStable = stableXuiEmailFromTelegramId(telegramId);
  const pick =
    clients.find((c) => String(c?.tgId || "") === tid) ||
    clients.find((c) => String(c?.email || "") === emailStable) ||
    clients.find((c) => String(c?.email || "").startsWith(`${emailStable}_`)) ||
    null;
  if (!pick) return null;
  return { inbound: inb, client: pick };
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
  return { id, subId, email };
}

export async function addClientToInbound({
  inboundId,
  telegramId,
  totalGB = 0,
  expiryTime = 0,
  limitIp = 0,
  remark = "",
}) {
  if (!inboundId) throw new Error("xui_inbound_id_required");
  const creds = generateClientCreds({ telegramId });

  // 3X-UI expects settings as a JSON string containing { clients: [...] }
  const clientRow = {
    id: creds.id,
    email: creds.email,
    enable: true,
    limitIp,
    totalGB,
    expiryTime,
    tgId: String(telegramId),
    subId: creds.subId,
  };
  const r = String(remark || "").trim();
  if (r) clientRow.remark = r;

  const settings = {
    clients: [clientRow],
  };

  const res = await xuiFetch("/panel/api/inbounds/addClient", {
    method: "POST",
    json: {
      id: Number(inboundId),
      settings: JSON.stringify(settings),
    },
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`xui_add_client: ${res.status} ${t}`.trim());
  }
  const data = await res.json().catch(() => ({}));
  const effective = await getClientSubIdFromInbound({
    inboundId,
    telegramId,
    email: creds.email,
  }).catch(() => null);
  return { ok: true, creds: { ...creds, subIdEffective: effective }, response: data };
}

export async function updateClientInInbound({ inboundId, clientId, client }) {
  if (!inboundId) throw new Error("xui_inbound_id_required");
  const cid = String(clientId || "").trim();
  if (!cid) throw new Error("xui_client_id_required");
  if (!client || typeof client !== "object") throw new Error("xui_client_required");

  const settings = { clients: [client] };
  const res = await xuiFetch(`/panel/api/inbounds/updateClient/${encodeURIComponent(cid)}`, {
    method: "POST",
    json: {
      id: Number(inboundId),
      settings: JSON.stringify(settings),
    },
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`xui_update_client: ${res.status} ${t}`.trim());
  }
  return await res.json().catch(() => ({}));
}

export async function incrementClientLimitIp({ inboundId, telegramId, addSlots = 1 }) {
  const found = await findClientInInbound({ inboundId, telegramId });
  if (!found?.client) throw new Error("xui_client_not_found");

  const cur = Number(found.client.limitIp ?? 0);
  const inc = Number(addSlots || 1);
  if (!Number.isFinite(inc) || inc < 1) throw new Error("bad_slots");

  // В 3X-UI limitIp: 0 = без лимита. Для «+1 устройство» переводим в лимитный режим.
  const base = Number.isFinite(cur) && cur > 0 ? cur : 1;
  const next = base + inc;

  const clientId = String(found.client.id || found.client.ID || "").trim();
  if (!clientId) throw new Error("xui_client_id_missing");

  const patch = { ...found.client, limitIp: next };
  await updateClientInInbound({ inboundId, clientId, client: patch });
  return { previous: cur, next, email: found.client.email || null };
}

