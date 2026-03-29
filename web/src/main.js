import "./style.css";

const root = document.getElementById("root");

function el(html) {
  const d = document.createElement("div");
  d.innerHTML = html.trim();
  return d.firstChild;
}

function showError(msg) {
  root.innerHTML = "";
  root.appendChild(el(`<div class="card"><p class="err">${msg}</p></div>`));
}

async function api(path, opts = {}) {
  const r = await fetch(path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  const text = await r.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!r.ok) throw new Error(data.error || data.raw || r.status);
  return data;
}

async function boot() {
  const tg = window.Telegram?.WebApp;
  if (!tg) {
    showError("Откройте мини-приложение из Telegram.");
    return;
  }
  tg.ready();
  tg.expand();

  const initData = tg.initData;
  if (!initData) {
    showError("Нет initData. Откройте через кнопку бота /start.");
    return;
  }

  root.innerHTML = `<div class="card muted">Загрузка профиля...</div>`;

  let token;
  try {
    const auth = await api("/api/auth/telegram", {
      method: "POST",
      body: JSON.stringify({ initData }),
    });
    token = auth.token;
  } catch (e) {
    showError("Авторизация: " + e.message);
    return;
  }

  let me;
  try {
    me = await api("/api/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (e) {
    showError("Профиль: " + e.message);
    return;
  }

  const u = me.remnawaveUser;
  root.innerHTML = "";

  const head = el(
    `<div class="card"><h1 class="hero-title">VPN подписка</h1><p class="muted">Remnawave + Telegram</p></div>`,
  );
  root.appendChild(head);

  if (!u) {
    root.appendChild(
      el(
        `<div class="card"><p><b>Аккаунт в панели еще не привязан к вашему Telegram ID.</b></p><p class="muted">После оплаты бот создаст пользователя автоматически, либо обратитесь в поддержку.</p></div>`,
      ),
    );
    return;
  }

  const exp = u.expireAt ? new Date(u.expireAt).toLocaleString("ru-RU") : "—";
  const status = u.status || "—";
  const sub = u.subscriptionUrl || "—";
  const isActive = String(status).toUpperCase() === "ACTIVE";

  const card = el(`<div class="card">
    <div class="chip ${isActive ? "active" : ""}">
      ${isActive ? "Активна" : "Неактивна"}
    </div>
    <div class="grid" style="margin-top:10px">
      <div class="stat">
        <div class="label">Пользователь</div>
        <div class="value">${u.username || "—"}</div>
      </div>
      <div class="stat">
        <div class="label">Статус панели</div>
        <div class="value">${status}</div>
      </div>
      <div class="stat">
        <div class="label">Действует до</div>
        <div class="value">${exp}</div>
      </div>
      <div class="stat">
        <div class="label">Трафик лимит</div>
        <div class="value">${u.trafficLimitBytes ?? "—"}</div>
      </div>
    </div>
    <div class="link-block">
      <div class="label">Ссылка подписки</div>
      <div class="link" id="subUrl">${sub}</div>
    </div>
    <button class="btn" type="button" id="copyBtn">Скопировать ссылку</button>
    <button class="btn secondary" type="button" id="openBtn">Открыть ссылку</button>
  </div>`);
  root.appendChild(card);

  document.getElementById("copyBtn").onclick = async () => {
    try {
      await navigator.clipboard.writeText(sub);
      tg.showAlert("Скопировано");
    } catch {
      tg.showAlert("Не удалось скопировать");
    }
  };
  document.getElementById("openBtn").onclick = () => {
    if (sub && sub !== "—") tg.openLink(sub);
  };
}

boot();