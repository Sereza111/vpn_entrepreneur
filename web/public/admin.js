const tg = window.Telegram?.WebApp;
const outEl = document.getElementById("out");
const statusEl = document.getElementById("status");
const cfgEl = document.getElementById("configJson");
const actionStatusEl = document.getElementById("actionStatus");
const actionLogEl = document.getElementById("actionLog");
let token = "";
const actionLog = [];

function show(data) {
  outEl.textContent = typeof data === "string" ? data : JSON.stringify(data, null, 2);
}

function setActionStatus(text, kind = "") {
  actionStatusEl.textContent = String(text || "").trim() || "—";
  actionStatusEl.className = `status${kind ? ` ${kind}` : ""}`;
}

function pushActionLog(text) {
  const line = `${new Date().toLocaleTimeString()} ${text}`;
  actionLog.unshift(line);
  if (actionLog.length > 20) actionLog.length = 20;
  if (actionLogEl) actionLogEl.textContent = actionLog.join("\n");
}

async function confirmAction(message) {
  const msg = String(message || "").trim();
  if (!msg) return true;
  if (typeof tg?.showConfirm === "function") {
    return await new Promise((resolve) => tg.showConfirm(msg, (ok) => resolve(Boolean(ok))));
  }
  return window.confirm(msg);
}

function num(v) {
  return Number(String(v || "").trim());
}

function txt(id) {
  return String(document.getElementById(id)?.value || "").trim();
}

async function api(path, init = {}) {
  const headers = { "Content-Type": "application/json", ...(init.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { ...init, headers });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(payload?.error || `HTTP ${res.status}`);
    error.meta = {
      endpoint: path,
      httpStatus: res.status,
      requestId: res.headers.get("x-request-id") || "",
      payload,
    };
    throw error;
  }
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
    pushActionLog(`OK ${title}`);
    show(result);
    return result;
  } catch (e) {
    const msg = String(e?.message || e || "Ошибка");
    const meta = e?.meta || {};
    const diag = {
      title,
      error: msg,
      endpoint: meta.endpoint || null,
      httpStatus: meta.httpStatus || null,
      requestId: meta.requestId || null,
      details: meta.payload || null,
    };
    setActionStatus(`${title}: ${msg}`, "err");
    pushActionLog(`ERR ${title}: ${msg}`);
    show(diag);
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

function buildServerFromForm() {
  const id = txt("srvId");
  const host = txt("srvHost");
  const sshHost = txt("srvSshHost") || host;
  if (!id) throw new Error("Введите server id");
  if (!host) throw new Error("Введите host");
  if (!sshHost) throw new Error("Введите ssh.host");
  return {
    id,
    country: txt("srvCountry"),
    label: txt("srvLabel"),
    host,
    timewebServerId: txt("srvTimewebId"),
    socksPort: num(txt("srvSocksPort")) || 1080,
    httpPort: num(txt("srvHttpPort")) || 3128,
    mtprotoPort: num(txt("srvMtprotoPort")) || 0,
    mtprotoSecret: txt("srvMtprotoSecret"),
    ssh: {
      host: sshHost,
      port: num(txt("srvSshPort")) || 22,
      user: txt("srvSshUser"),
      privateKeyB64: txt("srvSshKey"),
      password: txt("srvSshPassword"),
    },
    containerName: txt("srvContainer") || "3proxy",
    configPath: txt("srvConfigPath") || "/opt/3proxy/3proxy.cfg",
  };
}

function fillServerForm(server = {}) {
  const set = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.value = value == null ? "" : String(value);
  };
  set("srvId", server.id || "");
  set("srvCountry", server.country || "");
  set("srvLabel", server.label || "");
  set("srvHost", server.host || "");
  set("srvTimewebId", server.timewebServerId || "");
  set("srvSocksPort", server.socksPort ?? 1080);
  set("srvHttpPort", server.httpPort ?? 3128);
  set("srvMtprotoPort", server.mtprotoPort ?? 0);
  set("srvMtprotoSecret", server.mtprotoSecret || "");
  set("srvSshHost", server?.ssh?.host || "");
  set("srvSshPort", server?.ssh?.port ?? 22);
  set("srvSshUser", server?.ssh?.user || "");
  set("srvSshKey", server?.ssh?.privateKeyB64 || "");
  set("srvSshPassword", server?.ssh?.password || "");
  set("srvContainer", server.containerName || "3proxy");
  set("srvConfigPath", server.configPath || "/opt/3proxy/3proxy.cfg");
}

function bind() {
  const loadUserBtn = document.getElementById("loadUser");
  const debugXuiMergeBtn = document.getElementById("debugXuiMergeBtn");
  const loadConfigBtn = document.getElementById("loadConfigBtn");
  const saveConfigBtn = document.getElementById("saveConfigBtn");
  const migrateBtn = document.getElementById("migrateBtn");
  const saveServerBtn = document.getElementById("saveServerBtn");
  const deleteServerBtn = document.getElementById("deleteServerBtn");
  const grantDaysBtn = document.getElementById("grantDaysBtn");
  const creditBtn = document.getElementById("creditBtn");
  const freeOnBtn = document.getElementById("freeOnBtn");
  const freeOffBtn = document.getElementById("freeOffBtn");
  const reconcileBtn = document.getElementById("reconcileBtn");
  const reconcileRemoteXuiBtn = document.getElementById("reconcileRemoteXuiBtn");

  loadUserBtn.onclick = () => runAction(loadUserBtn, "Загрузка пользователя", () => loadUser()).catch(() => null);
  if (debugXuiMergeBtn) {
    debugXuiMergeBtn.onclick = () => {
      const telegramId = num(document.getElementById("telegramId").value);
      if (!telegramId) {
        setActionStatus("Введите telegramId для проверки merge", "err");
        return;
      }
      runAction(debugXuiMergeBtn, "XUI merge", () =>
        api(`/api/admin/debug/xui-merge?telegramId=${telegramId}`))
        .catch(() => null);
    };
  }
  loadConfigBtn.onclick = () => runAction(loadConfigBtn, "Загрузка конфига", () => loadConfig()).catch(() => null);
  saveConfigBtn.onclick = () => runAction(saveConfigBtn, "Сохранение конфига", () => saveConfig()).catch(() => null);
  migrateBtn.onclick = () =>
    runAction(migrateBtn, "Миграция из env", async () => {
      if (!await confirmAction("Мигрировать конфиг из env в админ-хранилище?")) return { cancelled: true };
      return await api("/api/admin/config/migrate-from-env", { method: "POST", body: "{}" });
    })
      .catch(() => null);
  saveServerBtn.onclick = () =>
    runAction(saveServerBtn, "Сохранение сервера", async () => {
      const server = buildServerFromForm();
      const result = await api("/api/admin/config/servers/upsert", {
        method: "POST",
        body: JSON.stringify({ server }),
      });
      const parsed = JSON.parse(cfgEl.value || "{}");
      const list = Array.isArray(parsed.proxyServers) ? parsed.proxyServers : [];
      const next = list.filter((s) => String(s?.id || "") !== String(server.id));
      next.push(server);
      parsed.proxyServers = next;
      if (!Array.isArray(parsed.admins)) parsed.admins = [];
      cfgEl.value = JSON.stringify(parsed, null, 2);
      return result;
    }).catch(() => null);
  deleteServerBtn.onclick = () =>
    runAction(deleteServerBtn, "Удаление сервера", async () => {
      const serverId = txt("srvId");
      if (!serverId) throw new Error("Введите id для удаления");
      if (!await confirmAction(`Удалить сервер ${serverId}?`)) return { cancelled: true, serverId };
      const result = await api("/api/admin/config/servers/delete", {
        method: "POST",
        body: JSON.stringify({ serverId }),
      });
      const parsed = JSON.parse(cfgEl.value || "{}");
      const list = Array.isArray(parsed.proxyServers) ? parsed.proxyServers : [];
      parsed.proxyServers = list.filter((s) => String(s?.id || "") !== serverId);
      if (!Array.isArray(parsed.admins)) parsed.admins = [];
      cfgEl.value = JSON.stringify(parsed, null, 2);
      return result;
    }).catch(() => null);

  grantDaysBtn.onclick = () => {
    const telegramId = num(document.getElementById("telegramId").value);
    const days = num(document.getElementById("grantDays").value);
    if (!Number.isFinite(telegramId) || telegramId < 1) {
      setActionStatus("Введите корректный telegramId", "err");
      return;
    }
    if (!Number.isFinite(days) || days < 1 || days > 3650) {
      setActionStatus("Дни: целое число 1..3650", "err");
      return;
    }
    runAction(grantDaysBtn, "Выдача дней", () =>
      api("/api/admin/grant-days", { method: "POST", body: JSON.stringify({ telegramId, days }) }))
      .catch(() => null);
  };
  creditBtn.onclick = () => {
    const telegramId = num(document.getElementById("telegramId").value);
    const amountMinor = num(document.getElementById("creditMinor").value);
    if (!Number.isFinite(telegramId) || telegramId < 1) {
      setActionStatus("Введите корректный telegramId", "err");
      return;
    }
    if (!Number.isFinite(amountMinor) || amountMinor < 1) {
      setActionStatus("Сумма в копейках должна быть > 0", "err");
      return;
    }
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
    if (!paymentId) {
      setActionStatus("Введите paymentId", "err");
      return;
    }
    runAction(reconcileBtn, "YooKassa reconcile", () =>
      api("/api/admin/yookassa/reconcile", { method: "POST", body: JSON.stringify({ paymentId }) }))
      .catch(() => null);
  };
  if (reconcileRemoteXuiBtn) {
    reconcileRemoteXuiBtn.onclick = () => {
      const limit = num(document.getElementById("reconcileRemoteLimit").value) || 200;
      if (!Number.isFinite(limit) || limit < 1 || limit > 1000) {
        setActionStatus("Лимит: 1..1000", "err");
        return;
      }
      runAction(reconcileRemoteXuiBtn, "Reconcile remote XUI", async () => {
        if (!await confirmAction(`Запустить массовую синхронизацию XUI для ${limit} пользователей?`)) {
          return { cancelled: true, limit };
        }
        return await api("/api/admin/reconcile-remote-xui", {
          method: "POST",
          body: JSON.stringify({ onlyActive: true, limit }),
        });
      })
        .catch(() => null);
    };
  }
}

async function boot() {
  try {
    tg?.ready?.();
    tg?.expand?.();
    await auth();
    bind();
    const cfg = await loadConfig();
    const first = cfg?.effective?.proxyServers?.[0] || null;
    if (first) fillServerForm(first);
    setActionStatus("Готово");
  } catch (e) {
    statusEl.textContent = `Ошибка: ${String(e.message || e)}`;
    setActionStatus(`Ошибка инициализации: ${String(e.message || e)}`, "err");
    show(String(e.message || e));
  }
}

void boot();
