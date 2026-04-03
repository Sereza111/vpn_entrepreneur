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
  if (!config.xui.panelBaseUrl || !config.xui.username || !config.xui.password) {
    throw new Error("xui_not_configured");
  }
  const dispatcher = getDispatcher();
  const res = await fetch(urlJoin(config.xui.panelBaseUrl, "/login"), {
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
    throw new Error(`xui_login_failed: ${res.status} ${t}`.trim());
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
  const dispatcher = getDispatcher();
  const cookie = await xuiCookie();
  const headers = {
    Accept: "application/json",
    Cookie: cookie,
  };
  if (json !== undefined) headers["Content-Type"] = "application/json";

  let res = await fetch(urlJoin(config.xui.panelBaseUrl, path), {
    method,
    headers,
    body: json !== undefined ? JSON.stringify(json) : undefined,
    ...(dispatcher ? { dispatcher } : {}),
  });

  if (res.status === 401) {
    cachedCookie = null;
    const cookie2 = await xuiCookie();
    headers.Cookie = cookie2;
    res = await fetch(urlJoin(config.xui.panelBaseUrl, path), {
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

export function generateClientCreds({ telegramId }) {
  const tid = String(telegramId);
  const id = crypto.randomUUID();
  const subId = crypto.randomUUID();
  const email = `tg_${tid}`;
  return { id, subId, email };
}

export async function addClientToInbound({
  inboundId,
  telegramId,
  totalGB = 0,
  expiryTime = 0,
  limitIp = 0,
}) {
  if (!inboundId) throw new Error("xui_inbound_id_required");
  const creds = generateClientCreds({ telegramId });

  // 3X-UI expects settings as a JSON string containing { clients: [...] }
  const settings = {
    clients: [
      {
        id: creds.id,
        email: creds.email,
        enable: true,
        limitIp,
        totalGB,
        expiryTime,
        tgId: String(telegramId),
        subId: creds.subId,
      },
    ],
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
  return { ok: true, creds, response: data };
}

