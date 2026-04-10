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

  const splash = el(`
    <div class="splash" id="splash">
      <div class="splash-simple">
        <div class="splash-vl" id="splashVL">VL</div>
        <div class="splash-hint" id="splashHint">Подключение…</div>
      </div>
    </div>
  `);
  document.body.appendChild(splash);
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
    const hint = document.getElementById("splashHint");
    if (hint) hint.textContent = "Авторизация…";
    const auth = await api("/api/auth/telegram", {
      method: "POST",
      body: JSON.stringify({ initData }),
    });
    token = auth.token;
  } catch (e) {
    document.getElementById("splash")?.remove();
    showError("Авторизация: " + e.message);
    return;
  }

  let me;
  try {
    const hint = document.getElementById("splashHint");
    if (hint) hint.textContent = "Получаем данные…";
    me = await api("/api/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (e) {
    document.getElementById("splash")?.remove();
    showError("Профиль: " + e.message);
    return;
  }

  // Remove splash smoothly
  const sp = document.getElementById("splash");
  if (sp) {
    sp.classList.add("is-hidden");
    setTimeout(() => sp.remove(), 260);
  }

  const u = null;
  const xui = me.xui || null;
  const hasAccount = Boolean(u || xui?.linked);
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
        <div class="brand-mark">VL</div>
        <div>
          <h1 class="hero-title">VL</h1>
          <div class="muted">Подписка и прокси в одном месте</div>
        </div>
      </div>
    </div>`,
  );
  root.appendChild(head);

  if (!hasAccount) {
    const nav = el(`
      <div class="card">
        <div class="segmented">
          <button class="seg-btn active" data-target="status">Статус</button>
          <button class="seg-btn" data-target="connect">Подключение</button>
          <button class="seg-btn" data-target="proxy">Прокси</button>
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
          <button class="btn secondary" type="button" id="supportBtnNoAcc">Поддержка</button>
        </div>
      `),
    );

    root.appendChild(
      el(`
        <div class="card section" id="section-proxy">
          <h3 class="value" style="margin:0 0 6px">Прокси</h3>
          <div class="muted">Доступно прокси: <b>${Number(me?.proxy?.remaining || 0)}</b></div>
          <div class="muted" style="margin-top:4px">Выдано: ${Number(me?.proxy?.used || 0)} / ${Number(me?.proxy?.total || 0)}</div>
          <div class="plans" id="proxyServerPickNoAcc" style="margin-top:10px">
            ${(Array.isArray(me?.proxyServers) ? me.proxyServers : [])
              .map((s) => `<button class="proxy-btn" data-proxy-server="${s.id}">${s.country}</button>`)
              .join("") || `<div class="muted">Нет серверов в PROXY_SERVERS_JSON</div>`}
          </div>
          <button class="btn" type="button" id="proxyCreateBtnNoAcc">Создать прокси</button>
          <button class="btn secondary" type="button" id="proxyTestGrant1NoAcc">Тест: +1 прокси</button>
          <button class="btn secondary" type="button" id="proxyTestGrant5NoAcc">Тест: +5 прокси</button>
          <button class="btn secondary" type="button" id="refreshProxyBtn">Обновить</button>
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
    document.getElementById("refreshProxyBtn").onclick = () => window.location.reload();
    const proxyCreateBtnNoAcc = document.getElementById("proxyCreateBtnNoAcc");
    if (proxyCreateBtnNoAcc) {
      let selectedServerNoAcc = null;
      document.querySelectorAll("#proxyServerPickNoAcc .proxy-btn").forEach((b) => {
        b.onclick = () => {
          document.querySelectorAll("#proxyServerPickNoAcc .proxy-btn").forEach((x) => x.classList.remove("active"));
          b.classList.add("active");
          selectedServerNoAcc = b.getAttribute("data-proxy-server");
        };
      });
      proxyCreateBtnNoAcc.onclick = async () => {
        try {
          if (!selectedServerNoAcc) return showToast("Выберите страну");
          proxyCreateBtnNoAcc.disabled = true;
          proxyCreateBtnNoAcc.textContent = "Создаём...";
          await api("/api/proxy/provision", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            body: JSON.stringify({ serverId: selectedServerNoAcc }),
          });
          showToast("Прокси создан");
          setTimeout(() => window.location.reload(), 700);
        } catch (e) {
          showToast(`Ошибка: ${e.message}`);
          proxyCreateBtnNoAcc.disabled = false;
          proxyCreateBtnNoAcc.textContent = "Создать прокси";
        }
      };
    }
    const proxyTestGrant1NoAcc = document.getElementById("proxyTestGrant1NoAcc");
    if (proxyTestGrant1NoAcc) {
      proxyTestGrant1NoAcc.onclick = async () => {
        try {
          proxyTestGrant1NoAcc.disabled = true;
          await api("/api/test/proxy/grant", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            body: JSON.stringify({ count: 1, days: 30 }),
          });
          showToast("Выдано +1 прокси (тест)");
          setTimeout(() => window.location.reload(), 600);
        } catch (e) {
          showToast(`Ошибка: ${e.message}`);
          proxyTestGrant1NoAcc.disabled = false;
        }
      };
    }
    const proxyTestGrant5NoAcc = document.getElementById("proxyTestGrant5NoAcc");
    if (proxyTestGrant5NoAcc) {
      proxyTestGrant5NoAcc.onclick = async () => {
        try {
          proxyTestGrant5NoAcc.disabled = true;
          await api("/api/test/proxy/grant", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            body: JSON.stringify({ count: 5, days: 30 }),
          });
          showToast("Выдано +5 прокси (тест)");
          setTimeout(() => window.location.reload(), 600);
        } catch (e) {
          showToast(`Ошибка: ${e.message}`);
          proxyTestGrant5NoAcc.disabled = false;
        }
      };
    }
    document.getElementById("supportBtnNoAcc").onclick = () => tg.openTelegramLink("https://t.me/VL_VPNbot");
    return;
  }

  const st = me.subscriptionStatus || null;
  const exp = st?.expireAt
    ? new Date(st.expireAt).toLocaleString("ru-RU")
    : "—";
  const status = st?.panelStatus || "—";
  const sub =
    me.subscriptionPrimarySource === "xui"
      ? me.subscriptionUrl || "—"
      : me.subscriptionUrl || "—";
  const isActive = String(status).toUpperCase() === "ACTIVE";
  const isPending = String(status).toUpperCase() === "PENDING";
  const usedBytes = Number(
    st?.usedTrafficBytes ?? 0,
  );
  const limitBytes = Number(st?.trafficLimitBytes ?? 0);
  const hasLimit = Number.isFinite(limitBytes) && limitBytes > 0;
  const displayUser = st?.username || "—";
  const hwidOrDash = st?.deviceLimit ?? "—";
  const limitEndStat =
    st?.source === "xui"
      ? `<div class="stat">
        <div class="label">Лимит IP</div>
        <div class="value">${st.ipLimit > 0 ? st.ipLimit : "∞"}</div>
      </div>`
      : `<div class="stat">
        <div class="label">Лимит устройств</div>
        <div class="value">${hwidOrDash}</div>
      </div>`;

  const hasProxy = Boolean(me.proxy) || Array.isArray(me.proxyServers);
  const nav = el(`
    <div class="card">
      <div class="segmented">
        <button class="seg-btn active" data-target="status">Статус</button>
        <button class="seg-btn" data-target="connect">Подключение</button>
        ${hasProxy ? `<button class="seg-btn" data-target="proxy">Прокси</button>` : ""}
        <button class="seg-btn" data-target="extend">Продление</button>
      </div>
    </div>
  `);
  root.appendChild(nav);

  const card = el(`<div class="card section is-visible" id="section-status">
    <div class="chip ${isActive ? "active" : ""}" style="${isPending ? "opacity:0.85;border:1px dashed rgba(255,255,255,0.35)" : ""}">
      ${isActive ? "Активна" : isPending ? "Создайте клиента" : "Неактивна"}
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
        <div class="value">${displayUser}</div>
      </div>
      <div class="stat">
        <div class="label">${st?.source === "xui" ? "Статус (XUI)" : "Статус панели"}</div>
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
      ${limitEndStat}
    </div>
  </div>`);
  root.appendChild(card);

  const isXuiPrimary = me.subscriptionPrimarySource === "xui";

  const connect = el(`<div class="card section" id="section-connect">
    <h3 class="value" style="margin:0 0 6px">Подключение VPN</h3>
    <p class="muted">Скопируйте подписку или откройте ссылку напрямую в клиенте.</p>
    ${
      isXuiPrimary
        ? `<p class="muted" style="margin-top:8px;line-height:1.45">На втором устройстве (ПК) добавляйте <b>подписку по URL</b> / «обновить подписку», а не «импорт из буфера как YAML/конфиг» — иначе клиент пытается разобрать base64 как YAML и показывает ошибку про <code>vless</code>.</p>`
        : ""
    }
    <div class="link-block">
      <div class="label">Ссылка подписки</div>
      <div class="link" id="subUrl">${sub}</div>
    </div>
    <button class="btn secondary" type="button" id="xuiProvisionBtn">${xui?.linked ? "Обновить ссылку (XUI)" : "Создать XUI-подписку"}</button>
    <div class="muted" style="margin-top:8px">Если клиент уже есть в панели (ваш Telegram) — ссылка обновится без нового клиента. Новый клиент создаётся только при первом выдавании.</div>
    <button class="btn" type="button" id="copyBtn">Скопировать ссылку</button>
    <button class="btn secondary" type="button" id="openBtn">Открыть ссылку</button>
  </div>`);
  root.appendChild(connect);

  if (hasProxy) {
    const p = me.proxy || {};
    const servers = Array.isArray(me.proxyServers) ? me.proxyServers : [];
    const items = Array.isArray(p.items) ? p.items : [];
    const proxySec = el(`<div class="card section" id="section-proxy">
      <h3 class="value" style="margin:0 0 6px">Прокси</h3>
      <p class="muted">SOCKS5 и HTTP прокси (отдельная услуга).</p>

      ${
        `<div class="muted" style="margin-top:8px">
           Доступно: <b>${Number(p.remaining || 0)}</b> / Куплено: <b>${Number(p.total || 0)}</b>
         </div>
         <div class="plans" style="margin-top:10px">
           <button class="plan-btn" type="button" id="proxyTestGrant1">Тест: +1 прокси</button>
           <button class="plan-btn" type="button" id="proxyTestGrant5">Тест: +5 прокси</button>
         </div>
         ${
           items.length
             ? `<div class="muted" style="margin-top:8px">Ваши прокси:</div>
                ${items
                  .map(
                    (it, i) => `
                      <div class="link-block" style="margin-top:10px">
                        <div class="label">#${i + 1} • ${it.country || "—"}</div>
                        <div class="link">${it.socks5.host}:${it.socks5.port}  ${it.socks5.username}:${it.socks5.password}</div>
                        <div class="link" style="margin-top:6px">${it.http.host}:${it.http.port}  ${it.http.username}:${it.http.password}</div>
                      </div>
                    `,
                  )
                  .join("")}`
             : `<div class="muted" style="margin-top:8px;line-height:1.45">Прокси ещё не создан. Выберите страну и нажмите «Создать прокси».</div>`
         }
             <div class="plans" style="margin-top:10px">
               ${servers
                 .map(
                   (s) =>
                     `<button class="proxy-btn" data-proxy-server="${s.id}">${s.country || s.id}</button>`,
                 )
                 .join("")}
             </div>
             <button class="btn secondary" type="button" id="proxyCreateBtn">Создать прокси</button>`
      }
    </div>`);
    root.appendChild(proxySec);
  }

  const extend = el(`<div class="card section" id="section-extend">
    <h3 class="value" style="margin:0 0 6px">Продление подписки</h3>
    <p class="muted">Выберите план. После оплаты срок обновится автоматически.</p>
    <div class="plans">
      <button class="plan-btn" data-days="30">30 дней</button>
      <button class="plan-btn" data-days="90">90 дней</button>
      <button class="plan-btn" data-days="180">180 дней</button>
    </div>
    ${
      isXuiPrimary
        ? `<button class="btn secondary" type="button" id="addDeviceBtn">Докупить +1 устройство (IP лимит)</button>
           <p class="muted" style="margin-top:10px;line-height:1.45">Для XUI «устройство» = увеличение лимита IP в панели 3X-UI (limit IP) для вашего клиента.</p>`
        : `<button class="btn secondary" type="button" id="addDeviceBtn">Докупить +1 устройство</button>`
    }
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

  // (Per-proxy copy buttons can be added later if needed)

  const proxyCreateBtn = document.getElementById("proxyCreateBtn");
  if (proxyCreateBtn) {
    let selectedServer = null;
    document.querySelectorAll(".proxy-btn").forEach((b) => {
      b.onclick = () => {
        document.querySelectorAll(".proxy-btn").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        selectedServer = b.getAttribute("data-proxy-server");
      };
    });
    proxyCreateBtn.onclick = async () => {
      try {
        if (!selectedServer) return showToast("Выберите страну");
        proxyCreateBtn.disabled = true;
        proxyCreateBtn.textContent = "Создаём...";
        await api("/api/proxy/provision", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: JSON.stringify({ serverId: selectedServer }),
        });
        showToast("Прокси создан");
        setTimeout(() => window.location.reload(), 700);
      } catch (e) {
        showToast(`Ошибка: ${e.message}`);
        proxyCreateBtn.disabled = false;
        proxyCreateBtn.textContent = "Создать прокси";
      }
    };
  }

  const proxyTestGrant1 = document.getElementById("proxyTestGrant1");
  if (proxyTestGrant1) {
    proxyTestGrant1.onclick = async () => {
      try {
        proxyTestGrant1.disabled = true;
        await api("/api/test/proxy/grant", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: JSON.stringify({ count: 1, days: 30 }),
        });
        showToast("Выдано +1 прокси (тест)");
        setTimeout(() => window.location.reload(), 600);
      } catch (e) {
        showToast(`Ошибка: ${e.message}`);
        proxyTestGrant1.disabled = false;
      }
    };
  }
  const proxyTestGrant5 = document.getElementById("proxyTestGrant5");
  if (proxyTestGrant5) {
    proxyTestGrant5.onclick = async () => {
      try {
        proxyTestGrant5.disabled = true;
        await api("/api/test/proxy/grant", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: JSON.stringify({ count: 5, days: 30 }),
        });
        showToast("Выдано +5 прокси (тест)");
        setTimeout(() => window.location.reload(), 600);
      } catch (e) {
        showToast(`Ошибка: ${e.message}`);
        proxyTestGrant5.disabled = false;
      }
    };
  }

  const provBtn = document.getElementById("xuiProvisionBtn");
  if (provBtn) {
    provBtn.onclick = async () => {
      try {
        provBtn.disabled = true;
        provBtn.textContent = "Создаём...";
        await api("/api/xui/provision", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: JSON.stringify({ force: true }),
        });
        showToast("Готово. Обновляем...");
        setTimeout(() => window.location.reload(), 700);
      } catch (e) {
        showToast(`Ошибка: ${e.message}`);
        provBtn.disabled = false;
        provBtn.textContent = xui?.linked ? "Обновить ссылку (XUI)" : "Создать XUI-подписку";
      }
    };
  }
  document.querySelectorAll(".plan-btn[data-days]").forEach((b) => {
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
  const addDev = document.getElementById("addDeviceBtn");
  if (addDev) {
    addDev.onclick = async () => {
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
  }
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
      const st2 = me2.subscriptionStatus;
      const used2 = Number(
        st2?.usedTrafficBytes ?? 0,
      );
      const limit2 = Number(st2?.trafficLimitBytes ?? 0);
      const hasLimit2 = Number.isFinite(limit2) && limit2 > 0;
      const now = Date.now();
      const dt = Math.max(1, (now - last.at) / 1000);
      const du = Math.max(0, used2 - last.used);
      const bps = du / dt;
      last = { at: now, used: used2 };

      const speedEl = document.getElementById("speedText");
      if (speedEl) speedEl.textContent = fmtSpeed(bps);

      const trafficEl = document.getElementById("trafficText");
      if (trafficEl) {
        trafficEl.textContent = hasLimit2
          ? `${fmtBytes(used2)} / ${fmtBytes(limit2)}`
          : `${fmtBytes(used2)} / ∞`;
      }
      if (hasLimit2) {
        const fill = document.getElementById("trafficFill");
        if (fill) {
          const pct = Math.min(100, Math.max(0, (used2 / limit2) * 100));
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