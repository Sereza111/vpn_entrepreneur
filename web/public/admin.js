const tg = window.Telegram?.WebApp;
const outEl = document.getElementById("out");
const statusEl = document.getElementById("status");
const cfgEl = document.getElementById("configJson");
const actionStatusEl = document.getElementById("actionStatus");
let token = "";

function show(data) {
  outEl.textContent = typeof data === "string" ? data : JSON.stringify(data, null, 2);
}

function setActionStatus(text, kind = "") {
  actionStatusEl.textContent = String(text || "").trim() || "—";
  actionStatusEl.className = `status${kind ? ` ${kind}` : ""}`;
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

async function runAction(buttonEl, title, action) {
  const prev = buttonEl?.textContent || "";
  if (buttonEl) {
    buttonEl.disabled = true;
    buttonEl.textContent = "Выполняем...";
  }
  setActionStatus(`${title}: выполняется...`);
  try {
    const result = await action();
    setActionStatus(`${title}: успешно`, "ok");
    show(result);
    return result;
  } catch (e) {
    const msg = String(e?.message || e || "Ошибка");
    setActionStatus(`${title}: ${msg}`, "err");
    show(msg);
    throw e;
  } finally {
    if (buttonEl) {
      buttonEl.disabled = false;
      buttonEl.textContent = prev;
    }
  }
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

function addUsaTemplateToConfig() {
  const parsed = JSON.parse(cfgEl.value || "{}");
  const list = Array.isArray(parsed.proxyServers) ? parsed.proxyServers : [];
  const exists = list.some((s) => String(s?.id || "").trim().toLowerCase() === "us1");
  if (exists) return { changed: false, reason: "us1 уже есть в proxyServers" };
  list.push({
    id: "us1",
    country: "US",
    label: "США · US1",
    host: "1.2.3.4",
    timewebServerId: "",
    socksPort: 1080,
    httpPort: 3128,
    mtprotoPort: 8443,
    mtprotoSecret: "",
    ssh: {
      host: "1.2.3.4",
      port: 22,
      user: "root",
      privateKeyB64: "",
    },
    containerName: "3proxy",
    configPath: "/opt/3proxy/3proxy.cfg",
  });
  parsed.proxyServers = list;
  if (!Array.isArray(parsed.admins)) parsed.admins = [];
  cfgEl.value = JSON.stringify(parsed, null, 2);
  return { changed: true, serverId: "us1" };
}

function bind() {
  const loadUserBtn = document.getElementById("loadUser");
  const loadConfigBtn = document.getElementById("loadConfigBtn");
  const saveConfigBtn = document.getElementById("saveConfigBtn");
  const migrateBtn = document.getElementById("migrateBtn");
  const addUsaTemplateBtn = document.getElementById("addUsaTemplateBtn");
  const grantDaysBtn = document.getElementById("grantDaysBtn");
  const creditBtn = document.getElementById("creditBtn");
  const freeOnBtn = document.getElementById("freeOnBtn");
  const freeOffBtn = document.getElementById("freeOffBtn");
  const reconcileBtn = document.getElementById("reconcileBtn");

  loadUserBtn.onclick = () => runAction(loadUserBtn, "Загрузка пользователя", () => loadUser()).catch(() => null);
  loadConfigBtn.onclick = () => runAction(loadConfigBtn, "Загрузка конфига", () => loadConfig()).catch(() => null);
  saveConfigBtn.onclick = () => runAction(saveConfigBtn, "Сохранение конфига", () => saveConfig()).catch(() => null);
  migrateBtn.onclick = () =>
    runAction(migrateBtn, "Миграция из env", () =>
      api("/api/admin/config/migrate-from-env", { method: "POST", body: "{}" }))
      .catch(() => null);
  addUsaTemplateBtn.onclick = () => {
    try {
      const r = addUsaTemplateToConfig();
      if (r.changed) {
        setActionStatus("USA шаблон добавлен в JSON. Нажми «Сохранить admins + proxyServers».", "ok");
      } else {
        setActionStatus(String(r.reason || "Без изменений"));
      }
    } catch (e) {
      setActionStatus(`Ошибка шаблона USA: ${String(e?.message || e)}`, "err");
    }
  };

  grantDaysBtn.onclick = () => {
    const telegramId = num(document.getElementById("telegramId").value);
    const days = num(document.getElementById("grantDays").value);
    runAction(grantDaysBtn, "Выдача дней", () =>
      api("/api/admin/grant-days", { method: "POST", body: JSON.stringify({ telegramId, days }) }))
      .catch(() => null);
  };
  creditBtn.onclick = () => {
    const telegramId = num(document.getElementById("telegramId").value);
    const amountMinor = num(document.getElementById("creditMinor").value);
    runAction(creditBtn, "Пополнение баланса", () =>
      api("/api/admin/balance/credit", { method: "POST", body: JSON.stringify({ telegramId, amountMinor }) }))
      .catch(() => null);
  };
  freeOnBtn.onclick = () => {
    const telegramId = num(document.getElementById("telegramId").value);
    runAction(freeOnBtn, "FreeMode ON", () =>
      api("/api/admin/free-mode", { method: "POST", body: JSON.stringify({ telegramId, freeMode: true }) }))
      .catch(() => null);
  };
  freeOffBtn.onclick = () => {
    const telegramId = num(document.getElementById("telegramId").value);
    runAction(freeOffBtn, "FreeMode OFF", () =>
      api("/api/admin/free-mode", { method: "POST", body: JSON.stringify({ telegramId, freeMode: false }) }))
      .catch(() => null);
  };
  reconcileBtn.onclick = () => {
    const paymentId = String(document.getElementById("paymentId").value || "").trim();
    runAction(reconcileBtn, "YooKassa reconcile", () =>
      api("/api/admin/yookassa/reconcile", { method: "POST", body: JSON.stringify({ paymentId }) }))
      .catch(() => null);
  };
}

async function boot() {
  try {
    tg?.ready?.();
    tg?.expand?.();
    await auth();
    bind();
    await loadConfig();
    setActionStatus("Готово");
  } catch (e) {
    statusEl.textContent = `Ошибка: ${String(e.message || e)}`;
    setActionStatus(`Ошибка инициализации: ${String(e.message || e)}`, "err");
    show(String(e.message || e));
  }
}

void boot();
