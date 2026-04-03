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
  const xui = me.xui || null;
  root.innerHTML = "";

  const fmtBytes = (bytes) => {
    const n = Number(bytes || 0);
    if (!Number.isFinite(n) || n <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let v = n;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i++;
    }
    const digits = v >= 100 ? 0 : v >= 10 ? 1 : 2;
    return `${v.toFixed(digits)} ${units[i]}`;
  };
  const fmtSpeed = (bps) => {
    const n = Number(bps || 0);
    if (!Number.isFinite(n) || n <= 0) return "0 Mbps";
    const mbps = (n * 8) / 1_000_000;
    return `${mbps.toFixed(mbps >= 10 ? 0 : 1)} Mbps`;
  };

  const head = el(
    `<div class="card">
      <div class="brand">
        <div class="brand-mark">VPN</div>
        <div>
          <h1 class="hero-title">VPN подписка</h1>
          <div class="muted">Все регионы в одной подписке</div>
        </div>
      </div>
    </div>`,
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
          <p class="muted">После оплаты доступ к VPN выдаётся автоматически. Затем здесь появится кнопка подключения.</p>
          <button class="btn secondary" type="button" id="refreshBtn">Обновить статус</button>
        </div>
      `),
    );

    root.appendChild(
      el(`
        <div class="card section" id="section-extend">
          <h3 class="value" style="margin:0 0 6px">Продление подписки</h3>
          <p class="muted">Выберите удобный способ: оплата или связь с оператором.</p>
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

    document.getElementById("refreshBtn").onclick = () => window.location.reload();
    document.getElementById("payBtn").onclick = async () => {
      try {
        await api("/api/test/grant", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: JSON.stringify({ days: 30 }),
        });
        showToast("Тестово выдано на 30 дней");
        setTimeout(() => window.location.reload(), 600);
      } catch (e) {
        showToast(`Ошибка: ${e.message}`);
      }
    };
    document.getElementById("supportBtn").onclick = () => tg.openTelegramLink("https://t.me/VL_VPNbot");
    return;
  }

  const exp = u.expireAt ? new Date(u.expireAt).toLocaleString("ru-RU") : "—";
  const status = u.status || "—";
  const sub = u.subscriptionUrl || "—";
  const isActive = String(status).toUpperCase() === "ACTIVE";
  const usedBytes = Number(u.userTraffic?.usedTrafficBytes ?? 0);
  const limitBytes = Number(u.trafficLimitBytes ?? 0);
  const hasLimit = Number.isFinite(limitBytes) && limitBytes > 0;

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
    <div class="meter" style="margin-top:10px">
      <div class="meter-head">
        <div>
          <div class="label">Трафик</div>
          <div class="value" id="trafficText">${hasLimit ? `${fmtBytes(usedBytes)} / ${fmtBytes(limitBytes)}` : `${fmtBytes(usedBytes)} / ∞`}</div>
        </div>
        <div style="text-align:right">
          <div class="label">Сейчас</div>
          <div class="value" id="speedText">0 Mbps</div>
        </div>
      </div>
      <div class="meter-bar" aria-hidden="true">
        <div class="meter-fill" id="trafficFill" style="width:${hasLimit ? `${Math.min(100, Math.max(0, (usedBytes / limitBytes) * 100)).toFixed(1)}%` : "0%"}"></div>
      </div>
      <div class="label" id="trafficHint">${hasLimit ? "Прогресс по лимиту" : "Безлимит: показываем использовано"}</div>
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
        <div class="value">${hasLimit ? fmtBytes(limitBytes) : "∞"}</div>
      </div>
      <div class="stat">
        <div class="label">Лимит устройств</div>
        <div class="value">${u.hwidDeviceLimit || "—"}</div>
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
    ${
      xui && !xui.linked
        ? `<button class="btn secondary" type="button" id="xuiProvisionBtn">Создать XUI-подписку</button>
           <div class="muted" style="margin-top:8px">Нажмите один раз — бот создаст клиента в 3X-UI и выдаст новую ссылку.</div>`
        : ""
    }
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
    <button class="btn secondary" type="button" id="addDeviceBtn">Докупить +1 устройство</button>
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

  const provBtn = document.getElementById("xuiProvisionBtn");
  if (provBtn) {
    provBtn.onclick = async () => {
      try {
        provBtn.disabled = true;
        provBtn.textContent = "Создаём...";
        await api("/api/xui/provision", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: JSON.stringify({}),
        });
        showToast("Готово. Обновляем...");
        setTimeout(() => window.location.reload(), 700);
      } catch (e) {
        showToast(`Ошибка: ${e.message}`);
        provBtn.disabled = false;
        provBtn.textContent = "Создать XUI-подписку";
      }
    };
  }
  document.querySelectorAll(".plan-btn").forEach((b) => {
    b.onclick = async () => {
      const days = b.getAttribute("data-days");
      try {
        await api("/api/test/grant", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: JSON.stringify({ days: Number(days) }),
        });
        showToast(`Тестово продлено на ${days} дней`);
        setTimeout(() => window.location.reload(), 600);
      } catch (e) {
        showToast(`Ошибка: ${e.message}`);
      }
    };
  });
  document.getElementById("addDeviceBtn").onclick = async () => {
    try {
      await api("/api/test/add-device-slot", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ slots: 1 }),
      });
      showToast("Лимит устройств увеличен на +1");
      setTimeout(() => window.location.reload(), 700);
    } catch (e) {
      showToast(`Ошибка: ${e.message}`);
    }
  };
  document.getElementById("supportBtn").onclick = () => {
    tg.openTelegramLink("https://t.me/VL_VPNbot");
  };

  // "Спидометр": считаем скорость как прирост usedTrafficBytes за интервал.
  // Никаких внешних speedtest — только то, что реально прошло через подписку.
  let last = { at: Date.now(), used: usedBytes };
  const tick = async () => {
    try {
      const me2 = await api("/api/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const u2 = me2.remnawaveUser;
      const used2 = Number(u2?.userTraffic?.usedTrafficBytes ?? 0);
      const now = Date.now();
      const dt = Math.max(1, (now - last.at) / 1000);
      const du = Math.max(0, used2 - last.used);
      const bps = du / dt;
      last = { at: now, used: used2 };

      const speedEl = document.getElementById("speedText");
      if (speedEl) speedEl.textContent = fmtSpeed(bps);

      const trafficEl = document.getElementById("trafficText");
      if (trafficEl) {
        trafficEl.textContent = hasLimit
          ? `${fmtBytes(used2)} / ${fmtBytes(limitBytes)}`
          : `${fmtBytes(used2)} / ∞`;
      }
      if (hasLimit) {
        const fill = document.getElementById("trafficFill");
        if (fill) {
          const pct = Math.min(100, Math.max(0, (used2 / limitBytes) * 100));
          fill.style.width = `${pct.toFixed(1)}%`;
        }
      }
    } catch {
      // Игнорим временные ошибки (например, если Remnawave недоступен).
    }
  };
  setInterval(tick, 5000);
}

boot();