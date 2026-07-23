function urlJoin(base, p) {
  const b = String(base || "").replace(/\/$/, "");
  const path = String(p || "");
  return `${b}${path.startsWith("/") ? path : `/${path}`}`;
}

export function encodeForm(obj) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(obj || {})) {
    sp.set(k, String(v ?? ""));
  }
  return sp.toString();
}

export function pickCookie(setCookieHeaders) {
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

function mergeCookieHeader(...parts) {
  const map = new Map();
  for (const raw of parts) {
    for (const chunk of String(raw || "").split(";")) {
      const p = chunk.trim();
      if (!p) continue;
      const eq = p.indexOf("=");
      if (eq > 0) map.set(p.slice(0, eq).trim(), p);
    }
  }
  return [...map.values()].join("; ");
}

function readSetCookie(res) {
  return res.headers.getSetCookie?.() || res.headers.get("set-cookie");
}

function parseCsrfTokenFromJson(text) {
  try {
    const j = JSON.parse(String(text || ""));
    const token = j?.token ?? j?.csrfToken ?? j?.obj ?? j?.data?.token;
    if (token != null && String(token).trim()) return String(token).trim();
  } catch {
    // not JSON
  }
  const plain = String(text || "").trim();
  if (plain && plain.length < 256 && !plain.includes("<")) return plain;
  return "";
}

function parseCsrfTokenFromHtml(html) {
  const src = String(html || "");
  const m1 = src.match(/name=["']csrf-token["']\s+content=["']([^"']+)["']/i);
  if (m1?.[1]) return m1[1].trim();
  const m2 = src.match(/content=["']([^"']+)["']\s+name=["']csrf-token["']/i);
  if (m2?.[1]) return m2[1].trim();
  return "";
}

/**
 * 3X-UI >=3.0 (и часть 2.2.x) требует x-csrf-token на POST /login.
 */
export async function fetchXuiCsrfSession(root, { dispatcher } = {}) {
  const fetchOpts = (extra = {}) => ({
    method: "GET",
    redirect: "follow",
    headers: { Accept: "application/json, text/html;q=0.9,*/*;q=0.8" },
    ...(dispatcher ? { dispatcher } : {}),
    ...extra,
  });

  let cookies = "";
  try {
    const res = await fetch(urlJoin(root, "/csrf-token"), fetchOpts());
    cookies = mergeCookieHeader(cookies, pickCookie(readSetCookie(res)));
    if (res.ok) {
      const text = await res.text().catch(() => "");
      const token = parseCsrfTokenFromJson(text);
      if (token) return { token, cookies };
    }
  } catch {
    // fallback to HTML
  }

  const pageRes = await fetch(urlJoin(root, "/"), fetchOpts({
    headers: {
      Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
      ...(cookies ? { Cookie: cookies } : {}),
    },
  }));
  cookies = mergeCookieHeader(cookies, pickCookie(readSetCookie(pageRes)));
  const html = await pageRes.text().catch(() => "");
  return { token: parseCsrfTokenFromHtml(html), cookies };
}

/**
 * @returns {Promise<string|{cookie:string,csrfToken:string}>}
 *   string — legacy cookie-only; object — cookie + CSRF for subsequent API POSTs (3X-UI 3.x).
 */
export async function loginXuiPanel({
  root,
  username,
  password,
  dispatcher,
  errorPrefix = "xui_login",
}) {
  const { token: csrfToken, cookies: csrfCookies } = await fetchXuiCsrfSession(root, { dispatcher });

  const headers = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };
  if (csrfToken) headers["x-csrf-token"] = csrfToken;
  if (csrfCookies) headers.Cookie = csrfCookies;

  let res;
  try {
    res = await fetch(urlJoin(root, "/login"), {
      method: "POST",
      headers,
      body: encodeForm({ username, password }),
      redirect: "manual",
      ...(dispatcher ? { dispatcher } : {}),
    });
  } catch (e) {
    const cause = e?.cause?.code || e?.cause?.message || e?.message || e;
    throw new Error(`${errorPrefix}_fetch_failed: ${String(cause)} (root=${root})`);
  }

  if (!res.ok && res.status !== 302) {
    const t = await res.text().catch(() => "");
    const csrfHint =
      res.status === 403
        ? " Новая 3X-UI требует CSRF — обновите бота или проверьте Web Base Path."
        : res.status === 404
          ? " Проверь XUI_WEB_BASE_PATH (регистр букв!)."
          : "";
    throw new Error(`${errorPrefix}_failed: ${res.status} ${t}${csrfHint}`.trim());
  }

  const loginCookie = pickCookie(readSetCookie(res));
  const cookie = mergeCookieHeader(csrfCookies, loginCookie);
  if (!cookie) throw new Error(`${errorPrefix}_no_cookie`);
  // Prefer object so callers can attach CSRF to /panel/api/* POSTs (addClient etc.).
  // String return kept for any external callers that only need the cookie.
  return { cookie, csrfToken: csrfToken || "" };
}
