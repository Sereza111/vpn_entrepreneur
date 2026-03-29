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

function showToast(message) {
  let toast = document.getElementById("toast");
  if (!toast) {
    toast = el(`<div id="toast" class="toast"></div>`);
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 1400);
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

  root.innerHTML = `
    <div class="card">
      <div class="skeleton s1"></div>
      <div class="skeleton s2"></div>
    </div>
    <div class="card">
      <div class="skeleton s3"></div>
      <div class="skeleton s4"></div>
      <div class="skeleton s4"></div>
    </div>
  `;

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
    const nav = el(`
      <div class="card">
        <div class="segmented">
          <button class="seg-btn active" data-target="status">Статус</button>
          <button class="seg-btn" data-target="connect">Подключение</button>
          <button class="seg-btn" data-target="extend">Продление</button>
        </div>
      </div>
    `);
    root.appendChild(nav);

    root.appendChild(
      el(
        `<div class="card section is-visible" id="section-status"><p><b>Аккаунт в панели еще не привязан к вашему Telegram ID.</b></p><p class="muted">После оплаты бот создаст пользователя автоматически, либо обратитесь в поддержку.</p></div>`,
      ),
    );

    root.appendChild(
      el(`
        <div class="card section" id="section-connect">
          <h3 class="value" style="margin:0 0 6px">Подключение</h3>
          <p class="muted">Вставьте short UUID или ссылку подписки из панели Remnawave, чтобы привязать аккаунт.</p>
          <input class="text-input" id="linkInput" placeholder="Например: f7a2c3... или https://.../sub/f7a2c3..." />
          <button class="btn" type="button" id="linkBtn">Привязать подписку</button>
          <button class="btn secondary" type="button" id="refreshBtn">Обновить статус</button>
        </div>
      `),
    );

    root.appendChild(
      el(`
        <div class="card section" id="section-extend">
          <h3 class="value" style="margin:0 0 6px">Продление подписки</h3>
          <p class="muted">Нажмите, чтобы перейти к оплате или связаться с поддержкой.</p>
          <button class="btn" type="button" id="payBtn">Оплатить / Продлить</button>
          <button class="btn secondary" type="button" id="supportBtn">Поддержка</button>
        </div>
      `),
    );

    document.querySelectorAll(".seg-btn").forEach((btn) => {
      btn.onclick = () => {
        document.querySelectorAll(".seg-btn").forEach((x) => x.classList.remove("active"));
        btn.classList.add("active");
        const key = btn.getAttribute("data-target");
        document.querySelectorAll(".section").forEach((s) => s.classList.remove("is-visible"));
        document.getElementById(`section-${key}`)?.classList.add("is-visible");
      };
    });

    document.getElementById("linkBtn").onclick = async () => {
      const v = document.getElementById("linkInput").value.trim();
      if (!v) {
        showToast("Вставьте short UUID или ссылку");
        return;
      }
      try {
        await api("/api/link-subscription", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: JSON.stringify({ shortUuid: v }),
        });
        showToast("Привязано. Обновляю...");
        setTimeout(() => window.location.reload(), 500);
      } catch (e) {
        showToast(`Ошибка: ${e.message}`);
      }
    };
    document.getElementById("refreshBtn").onclick = () => window.location.reload();
    document.getElementById("payBtn").onclick = () => tg.showAlert("Скоро подключим прямую оплату в мини-аппе.");
    document.getElementById("supportBtn").onclick = () => tg.openTelegramLink("https://t.me/VL_VPNbot");
    return;
  }

  const exp = u.expireAt ? new Date(u.expireAt).toLocaleString("ru-RU") : "—";
  const status = u.status || "—";
  const sub = u.subscriptionUrl || "—";
  const isActive = String(status).toUpperCase() === "ACTIVE";
  const nav = el(`
    <div class="card">
      <div class="segmented">
        <button class="seg-btn active" data-target="status">Статус</button>
        <button class="seg-btn" data-target="connect">Подключение</button>
        <button class="seg-btn" data-target="extend">Продление</button>
      </div>
    </div>
  `);
  root.appendChild(nav);

  const card = el(`<div class="card section is-visible" id="section-status">
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
  </div>`);
  root.appendChild(card);

  const connect = el(`<div class="card section" id="section-connect">
    <h3 class="value" style="margin:0 0 6px">Подключение VPN</h3>
    <p class="muted">Скопируйте подписку или откройте ссылку напрямую в клиенте.</p>
    <div class="link-block">
      <div class="label">Ссылка подписки</div>
      <div class="link" id="subUrl">${sub}</div>
    </div>
    <button class="btn" type="button" id="copyBtn">Скопировать ссылку</button>
    <button class="btn secondary" type="button" id="openBtn">Открыть ссылку</button>
  </div>`);
  root.appendChild(connect);

  const extend = el(`<div class="card section" id="section-extend">
    <h3 class="value" style="margin:0 0 6px">Продление подписки</h3>
    <p class="muted">Выберите план. После оплаты срок обновится автоматически.</p>
    <div class="plans">
      <button class="plan-btn" data-days="30">30 дней</button>
      <button class="plan-btn" data-days="90">90 дней</button>
      <button class="plan-btn" data-days="180">180 дней</button>
    </div>
    <button class="btn secondary" type="button" id="supportBtn">Поддержка</button>
  </div>`);
  root.appendChild(extend);

  document.querySelectorAll(".seg-btn").forEach((btn) => {
    btn.onclick = () => {
      document.querySelectorAll(".seg-btn").forEach((x) => x.classList.remove("active"));
      btn.classList.add("active");
      const key = btn.getAttribute("data-target");
      document.querySelectorAll(".section").forEach((s) => s.classList.remove("is-visible"));
      document.getElementById(`section-${key}`)?.classList.add("is-visible");
    };
  });

  document.getElementById("copyBtn").onclick = async () => {
    try {
      await navigator.clipboard.writeText(sub);
      const b = document.getElementById("copyBtn");
      b.textContent = "Скопировано";
      b.classList.add("done");
      showToast("Ссылка скопирована");
      setTimeout(() => {
        b.textContent = "Скопировать ссылку";
        b.classList.remove("done");
      }, 1200);
    } catch {
      tg.showAlert("Не удалось скопировать");
    }
  };
  document.getElementById("openBtn").onclick = () => {
    if (sub && sub !== "—") tg.openLink(sub);
  };
  document.querySelectorAll(".plan-btn").forEach((b) => {
    b.onclick = () => {
      const days = b.getAttribute("data-days");
      tg.showAlert(`Тариф на ${days} дней. Подключим оплату на следующем шаге.`);
    };
  });
  document.getElementById("supportBtn").onclick = () => {
    tg.openTelegramLink("https://t.me/VL_VPNbot");
  };
}

boot();