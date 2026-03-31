import { config } from "./config.js";

let cachedToken = config.remnawave.accessToken || null;
let tokenExpiresAt = 0;

async function login() {
  const { baseUrl, username, password } = config.remnawave;
  const headers = { "Content-Type": "application/json" };
  if (config.remnawave.bypassCookie) {
    headers["Cookie"] = config.remnawave.bypassCookie;
  }
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers,
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Remnawave login failed: ${res.status} ${t}`);
  }
  const data = await res.json();
  const token = data?.response?.accessToken;
  if (!token) throw new Error("Remnawave login: no accessToken in response");
  cachedToken = token;
  tokenExpiresAt = Date.now() + 55 * 60 * 1000;
  return token;
}

async function getBearer() {
  if (config.remnawave.accessToken) return config.remnawave.accessToken;
  if (!cachedToken || Date.now() > tokenExpiresAt) {
    await login();
  }
  return cachedToken;
}

export async function rwFetch(path, options = {}) {
  const url = `${config.remnawave.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = {
    Accept: "application/json",
    ...(options.headers || {}),
  };

  // nginx на твоей панели может "прикрывать" доступ к `/api/*`,
  // разрешая только при наличии cookie XkhRCZEJ=nEnUoUYP.
  // Если нужно - пришлём cookie автоматически.
  const hasCookieHeader =
    "Cookie" in headers ||
    "cookie" in headers;
  if (config.remnawave.bypassCookie && !hasCookieHeader) {
    headers["Cookie"] = config.remnawave.bypassCookie;
  }

  if (options.json !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  let token = await getBearer();
  headers.Authorization = `Bearer ${token}`;

  let res = await fetch(url, {
    ...options,
    headers,
    body: options.json !== undefined ? JSON.stringify(options.json) : options.body,
  });

  if (res.status === 401 && !config.remnawave.accessToken) {
    cachedToken = null;
    token = await getBearer();
    headers.Authorization = `Bearer ${token}`;
    res = await fetch(url, {
      ...options,
      headers,
      body: options.json !== undefined ? JSON.stringify(options.json) : options.body,
    });
  }

  return res;
}

export async function getUsersByTelegramId(telegramId) {
  const res = await rwFetch(`/api/users/by-telegram-id/${telegramId}`);
  if (res.status === 404) return [];
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`getUsersByTelegramId: ${res.status} ${t}`);
  }
  const data = await res.json();
  return data.response || [];
}

export async function getUserByShortUuid(shortUuid) {
  const res = await rwFetch(`/api/users/by-short-uuid/${encodeURIComponent(shortUuid)}`);
  if (res.status === 404) return null;
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`getUserByShortUuid: ${res.status} ${t}`);
  }
  const data = await res.json();
  return data.response || null;
}

/** Remnawave ожидает [{ uuid: "..." }], а из env приходит строка UUID — нормализуем. */
export function normalizeInternalSquadsInput(squads) {
  if (!squads?.length) return undefined;
  return squads.map((s) =>
    typeof s === "string"
      ? { uuid: s.trim() }
      : s && typeof s.uuid === "string"
        ? { uuid: s.uuid }
        : s,
  );
}

export async function createUser({
  username,
  expireAtIso,
  telegramId,
  trafficLimitBytes,
  activeInternalSquads,
  hwidDeviceLimit,
}) {
  const body = {
    username,
    expireAt: expireAtIso,
    telegramId,
    trafficLimitBytes: trafficLimitBytes ?? config.remnawave.defaultTrafficLimitBytes,
    trafficLimitStrategy: "NO_RESET",
    status: "ACTIVE",
  };
  if (activeInternalSquads?.length) {
    body.activeInternalSquads = normalizeInternalSquadsInput(activeInternalSquads);
  }
  if (Number.isFinite(Number(hwidDeviceLimit)) && Number(hwidDeviceLimit) > 0) {
    body.hwidDeviceLimit = Number(hwidDeviceLimit);
  }
  const res = await rwFetch("/api/users", { method: "POST", json: body });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`createUser: ${res.status} ${t}`);
  }
  const data = await res.json();
  return data.response;
}

export async function updateUser({ uuid, patch }) {
  const body = { uuid, ...patch };
  if (body.activeInternalSquads?.length) {
    body.activeInternalSquads = normalizeInternalSquadsInput(body.activeInternalSquads);
  }
  const res = await rwFetch("/api/users", { method: "PATCH", json: body });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`updateUser: ${res.status} ${t}`);
  }
  const data = await res.json();
  return data.response;
}

export async function bulkExtendExpiration(uuids, extendDays) {
  const res = await rwFetch("/api/users/bulk/extend-expiration-date", {
    method: "POST",
    json: { uuids, extendDays },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`bulkExtendExpiration: ${res.status} ${t}`);
  }
  return res.json();
}

export function defaultUsernameFromTelegramId(telegramId) {
  const u = `tg_${telegramId}`;
  if (u.length >= 3 && u.length <= 36) return u;
  return `u${String(telegramId)}`.slice(0, 36);
}

export function addDaysIso(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + Number(days));
  return d.toISOString();
}