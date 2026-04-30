const tg = window.Telegram?.WebApp;
const outEl = document.getElementById("out");
const statusEl = document.getElementById("status");
const cfgEl = document.getElementById("configJson");
let token = "";

function show(data) {
  outEl.textContent = typeof data === "string" ? data : JSON.stringify(data, null, 2);
}

function num(v) {
  return Number(String(v || "").trim());
}

async function api(path, init = {}) {
  const headers = { "Content-Type": "application/json", ...(init.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { ...init, headers });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload?.error || `HTTP ${res.status}`);
  return payload;
}

async function auth() {
  if (!tg?.initData) throw new Error("Откройте страницу из Telegram MiniApp");
  const authRes = await fetch("/api/auth/telegram", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ initData: tg.initData }),
  });
  const authData = await authRes.json().catch(() => ({}));
  if (!authRes.ok || !authData?.token) throw new Error(authData?.error || "auth_failed");
  token = authData.token;
  const me = await api("/api/admin/me");
  statusEl.textContent = `admin ${me.telegramId} авторизован`;
}

async function loadUser() {
  const telegramId = num(document.getElementById("telegramId").value);
  if (!telegramId) throw new Error("Введите telegramId");
  const data = await api(`/api/admin/users?telegramId=${telegramId}`);
  show(data);
}

async function loadConfig() {
  const data = await api("/api/admin/config");
  cfgEl.value = JSON.stringify({
    admins: data?.effective?.admins || [],
    proxyServers: data?.effective?.proxyServers || [],
  }, null, 2);
  show(data);
}

async function saveConfig() {
  const parsed = JSON.parse(cfgEl.value || "{}");
  await api("/api/admin/config/admins", {
    method: "POST",
    body: JSON.stringify({ admins: Array.isArray(parsed.admins) ? parsed.admins : [] }),
  });
  const data = await api("/api/admin/config/servers", {
    method: "POST",
    body: JSON.stringify({ servers: Array.isArray(parsed.proxyServers) ? parsed.proxyServers : [] }),
  });
  show(data);
}

function bind() {
  document.getElementById("loadUser").onclick = () => loadUser().catch((e) => show(String(e.message || e)));
  document.getElementById("loadConfigBtn").onclick = () => loadConfig().catch((e) => show(String(e.message || e)));
  document.getElementById("saveConfigBtn").onclick = () => saveConfig().catch((e) => show(String(e.message || e)));
  document.getElementById("migrateBtn").onclick = () =>
    api("/api/admin/config/migrate-from-env", { method: "POST", body: "{}" })
      .then(show).catch((e) => show(String(e.message || e)));

  document.getElementById("grantDaysBtn").onclick = () => {
    const telegramId = num(document.getElementById("telegramId").value);
    const days = num(document.getElementById("grantDays").value);
    api("/api/admin/grant-days", { method: "POST", body: JSON.stringify({ telegramId, days }) })
      .then(show).catch((e) => show(String(e.message || e)));
  };
  document.getElementById("creditBtn").onclick = () => {
    const telegramId = num(document.getElementById("telegramId").value);
    const amountMinor = num(document.getElementById("creditMinor").value);
    api("/api/admin/balance/credit", { method: "POST", body: JSON.stringify({ telegramId, amountMinor }) })
      .then(show).catch((e) => show(String(e.message || e)));
  };
  document.getElementById("freeOnBtn").onclick = () => {
    const telegramId = num(document.getElementById("telegramId").value);
    api("/api/admin/free-mode", { method: "POST", body: JSON.stringify({ telegramId, freeMode: true }) })
      .then(show).catch((e) => show(String(e.message || e)));
  };
  document.getElementById("freeOffBtn").onclick = () => {
    const telegramId = num(document.getElementById("telegramId").value);
    api("/api/admin/free-mode", { method: "POST", body: JSON.stringify({ telegramId, freeMode: false }) })
      .then(show).catch((e) => show(String(e.message || e)));
  };
  document.getElementById("reconcileBtn").onclick = () => {
    const paymentId = String(document.getElementById("paymentId").value || "").trim();
    api("/api/admin/yookassa/reconcile", { method: "POST", body: JSON.stringify({ paymentId }) })
      .then(show).catch((e) => show(String(e.message || e)));
  };
}

async function boot() {
  try {
    tg?.ready?.();
    tg?.expand?.();
    await auth();
    bind();
    await loadConfig();
  } catch (e) {
    statusEl.textContent = `Ошибка: ${String(e.message || e)}`;
    show(String(e.message || e));
  }
}

void boot();
