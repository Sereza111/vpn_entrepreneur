import { config } from "./config.js";

let cachedToken = null;
let tokenExpiresAt = 0;

export function nocobaseEnabled() {
  return Boolean(String(config.nocobase.baseUrl || "").trim());
}

function collection(key) {
  return config.nocobase.collections[key] || key;
}

function extractList(json) {
  if (Array.isArray(json?.data)) return json.data;
  if (Array.isArray(json?.data?.data)) return json.data.data;
  if (Array.isArray(json?.records)) return json.records;
  return [];
}

async function ensureToken() {
  if (!nocobaseEnabled()) return null;
  const { apiToken: fixed, account, password } = config.nocobase;
  if (String(fixed || "").trim()) return String(fixed).trim();
  if (!String(account || "").trim() || !String(password || "").trim()) return null;
  if (cachedToken && Date.now() < tokenExpiresAt - 120_000) return cachedToken;

  const base = String(config.nocobase.baseUrl).replace(/\/$/, "");
  const url = `${base}/api/auth:signIn`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ account, password }),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`nocobase_signin_${res.status}: ${String(JSON.stringify(json)).slice(0, 400)}`);
  }
  const token = json?.data?.token ?? json?.token;
  if (!token) throw new Error("nocobase_signin: no token in response");
  cachedToken = token;
  tokenExpiresAt = Date.now() + 23 * 3600 * 1000;
  return token;
}

async function nbFetch(path, { method = "POST", body = null } = {}) {
  const token = await ensureToken();
  if (!token) throw new Error("nocobase_no_auth_configure_token_or_account");
  const base = String(config.nocobase.baseUrl).replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  const url = `${base}${p}`;
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    ...(body != null ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`nocobase_http_${res.status}: ${String(JSON.stringify(json)).slice(0, 500)}`);
  }
  return json;
}

export async function nbCreate(collectionKey, values) {
  const name = collection(collectionKey);
  return nbFetch(`/api/${name}:create`, { body: { values } });
}

export async function nbList(collectionKey, listBody = {}) {
  const name = collection(collectionKey);
  return nbFetch(`/api/${name}:list`, {
    body: {
      page: 1,
      pageSize: 200,
      ...listBody,
    },
  });
}

export async function nbUpdateByTk(collectionKey, id, values) {
  const name = collection(collectionKey);
  return nbFetch(`/api/${name}:update`, {
    body: { filterByTk: id, values },
  });
}

/**
 * Upsert customer by telegramId (list + update or create).
 */
export async function syncCustomerSnapshot({ telegramId, username }) {
  if (!nocobaseEnabled()) return;
  const tid = Number(telegramId);
  if (!Number.isFinite(tid)) return;
  try {
    const json = await nbList("customers", {
      filter: { telegramId: tid },
      pageSize: 5,
    });
    const rows = extractList(json);
    const existing = rows.find((r) => Number(r.telegramId) === tid || String(r.telegramId) === String(tid));
    const now = new Date().toISOString();
    if (existing?.id != null) {
      await nbUpdateByTk("customers", existing.id, {
        username: username != null ? String(username) : existing.username,
        lastSeenAt: now,
      });
    } else {
      await nbCreate("customers", {
        telegramId: tid,
        username: username != null ? String(username) : "",
        segment: "unknown",
        lastSeenAt: now,
      });
    }
  } catch (e) {
    console.error("[nocobase] syncCustomerSnapshot:", e?.message || e);
  }
}

/**
 * Paid order row (Phase A). Does not block provisioning if NocoBase fails.
 */
export async function syncPaymentOrder(payload) {
  if (!nocobaseEnabled()) return;
  const tid = Number(payload.telegramId);
  if (!Number.isFinite(tid)) return;
  try {
    await syncCustomerSnapshot({
      telegramId: tid,
      username: payload.username,
    });
    await nbCreate("orders", {
      telegramId: tid,
      status: "paid",
      extendDays: Number(payload.extendDays || 0),
      addDeviceSlots: Number(payload.addDeviceSlots || 0),
      amount: payload.amount != null ? Number(payload.amount) : null,
      currency: payload.currency != null ? String(payload.currency) : null,
      externalPaymentId:
        payload.externalPaymentId != null ? String(payload.externalPaymentId) : null,
      productCode: payload.productCode != null ? String(payload.productCode) : null,
      paidAt: new Date().toISOString(),
      source: String(payload.source || "payment_webhook"),
    });
  } catch (e) {
    console.error("[nocobase] syncPaymentOrder:", e?.message || e);
  }
}

/**
 * Proxy issued — never sends password (see docs/NOCOBASE.md).
 */
export async function syncProxyInstanceIssued({
  telegramId,
  serverId,
  country,
  username,
}) {
  if (!nocobaseEnabled()) return;
  const tid = Number(telegramId);
  if (!Number.isFinite(tid)) return;
  try {
    await syncCustomerSnapshot({ telegramId: tid, username: undefined });
    await nbCreate("proxyInstances", {
      telegramId: tid,
      serverId: String(serverId || ""),
      country: String(country || ""),
      username: String(username || ""),
      passwordInNocobase: false,
      issuedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error("[nocobase] syncProxyInstanceIssued:", e?.message || e);
  }
}

function normalizeProductRow(row) {
  const grantDays = Number(row.grantDays ?? row.vpnDays ?? row.days ?? 0);
  return {
    code: String(row.code || row.id || "").trim() || `id_${row.id}`,
    title: String(row.title || row.name || row.code || "План").trim(),
    grantDays: Number.isFinite(grantDays) ? grantDays : 0,
    productType: String(row.productType || "vpn_extend").trim(),
    sortOrder: Number(row.sortOrder ?? 0),
    active: row.active !== false && row.isActive !== false,
  };
}

/**
 * Active products for mini-app catalog (Phase B).
 */
export async function fetchCatalogProducts() {
  if (!nocobaseEnabled()) return [];
  try {
    const json = await nbList("products", {
      pageSize: 200,
    });
    const rows = extractList(json);
    return rows
      .map(normalizeProductRow)
      .filter((p) => p.active && p.grantDays > 0 && p.productType === "vpn_extend");
  } catch (e) {
    console.error("[nocobase] fetchCatalogProducts:", e?.message || e);
    return [];
  }
}
