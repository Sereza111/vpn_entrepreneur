import "./style.css";

const root = document.getElementById("root");

function escAttr(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Инлайн SVG fleur-de-lis:
 * - на сплэше рисуется по контуру и мягко заполняется;
 * - в шапке показывается как статичный знак.
 */
function vlFleurLogoBlock({ animate = false, variant = "splash" } = {}) {
  const base = variant === "brand" ? "vl-fleur-mark vl-fleur-mark--brand" : "vl-fleur-mark vl-fleur-mark--splash";
  const cls = animate ? `${base} vl-fleur-mark--animate` : base;
  return `<div class="${cls}" aria-hidden="true">
  <div class="vl-fleur-mark__inner">
    <svg class="vl-fleur-mark__svg" viewBox="0 0 128 128" role="img" aria-label="VL fleur">
      <path
        class="vl-fleur-core"
        d="M64 22c-10 11-15 23-15 34 0 11 6 20 15 28 9-8 15-17 15-28 0-11-5-23-15-34Zm-36 61c0-13 11-23 25-23 7 0 14 3 19 9-4 4-7 8-8 12-8 0-14 5-14 12h-22c0-3 0-6 0-10Zm72 0c0-13-11-23-25-23-7 0-14 3-19 9 4 4 7 8 8 12 8 0 14 5 14 12h22c0-3 0-6 0-10Zm-44 3c-6 0-11 5-11 11 0 6 5 11 11 11h16c6 0 11-5 11-11 0-6-5-11-11-11H56Zm8 8c-5 0-9 4-9 9 0 5 4 9 9 9s9-4 9-9c0-5-4-9-9-9Z"
      />
      <path
        class="vl-fleur-stroke vl-fleur-stroke--center"
        style="--len: 180"
        d="M64 14c-14 14-22 30-22 44 0 14 8 25 22 36 14-11 22-22 22-36 0-14-8-30-22-44Z"
      />
      <path
        class="vl-fleur-stroke vl-fleur-stroke--left"
        style="--len: 190"
        d="M24 92c0-18 13-31 31-31 9 0 17 3 23 11m-54 20h26c0-9 6-15 14-15m-34-2c-5-4-8-10-8-16 0-13 10-23 24-23 8 0 14 3 18 9"
      />
      <path
        class="vl-fleur-stroke vl-fleur-stroke--right"
        style="--len: 190"
        d="M104 92c0-18-13-31-31-31-9 0-17 3-23 11m54 20H78c0-9-6-15-14-15m34-2c5-4 8-10 8-16 0-13-10-23-24-23-8 0-14 3-18 9"
      />
      <path
        class="vl-fleur-stroke vl-fleur-stroke--base"
        style="--len: 130"
        d="M45 92c0 12 8 22 19 22s19-10 19-22M39 108h50M52 100c0 5-3 10-8 12m32-12c0 5 3 10 8 12"
      />
    </svg>
  </div>
</div>`;
}

/** ISO 3166-1 alpha-2 → флаг (региональные индикаторы). Невалидный код → 🌐 */
function countryCodeToFlagEmoji(countryCode) {
  const c = String(countryCode || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
  if (c.length !== 2) return "🌐";
  const base = 0x1f1e6 - 0x41;
  try {
    return String.fromCodePoint(c.charCodeAt(0) + base, c.charCodeAt(1) + base);
  } catch {
    return "🌐";
  }
}

/** Русское имя страны по коду; explicitLabel из PROXY_SERVERS_JSON имеет приоритет. */
function displayCountryName(countryCode, explicitLabel) {
  const manual = String(explicitLabel || "").trim();
  if (manual) return manual;
  const cc = String(countryCode || "").trim().toUpperCase();
  if (cc.length === 2 && typeof Intl !== "undefined" && Intl.DisplayNames) {
    try {
      const n = new Intl.DisplayNames(["ru-RU"], { type: "region" }).of(cc);
      if (n) return n;
    } catch {
      /* ignore */
    }
  }
  if (cc) return cc;
  return "Регион";
}

function formatProxyRegionHtml(it, servers) {
  const srv = Array.isArray(servers) ? servers.find((x) => x.id === it.serverId) : null;
  const code = String(it.country || srv?.country || "").trim();
  const flag = countryCodeToFlagEmoji(code);
  const name = escAttr(displayCountryName(code, srv?.label || ""));
  return `<span class="proxy-item-region" aria-hidden="true">${flag}<span class="proxy-item-region__name">${name}</span></span>`;
}

function proxyServerPickButtonsHtml(servers) {
  const list = Array.isArray(servers) ? servers : [];
  if (!list.length) {
    return `<div class="muted country-picker-empty">Нет серверов в PROXY_SERVERS_JSON</div>`;
  }
  return list
    .map((s) => {
      const id = escAttr(s.id);
      const codeRaw = String(s.country || "").trim().toUpperCase() || String(s.id || "");
      const flag = countryCodeToFlagEmoji(s.country);
      const name = escAttr(displayCountryName(s.country, s.label));
      const code = escAttr(codeRaw);
      return `<button type="button" class="proxy-btn" data-proxy-server="${id}" aria-label="${name}">
        <span class="proxy-btn__row">
          <span class="proxy-btn__flag">${flag}</span>
          <span class="proxy-btn__text">
            <span class="proxy-btn__name">${name}</span>
            <span class="proxy-btn__meta"><span class="proxy-btn__code">${code}</span> · ${id}</span>
          </span>
        </span>
      </button>`;
    })
    .join("");
}

function vpnPlanTileHtml(p) {
  const days = Number(p.grantDays);
  const safeDays = Number.isFinite(days) && days > 0 ? days : 0;
  const code = escAttr(p.code || "");
  const title = escAttr(safeDays ? `${safeDays} дней` : p.title || "Тариф");
  const priceMinor = Number(p.priceMinor || 0);
  const priceLabel = priceMinor > 0 ? `${(priceMinor / 100).toFixed(0)} ₽` : "цена по запросу";
  const meta = escAttr(safeDays ? `${safeDays} дн. · ${priceLabel}` : `VPS Premium · ${priceLabel}`);
  return `<button type="button" class="plan-tile" data-days="${safeDays}" data-product-code="${code}">
    <span class="plan-tile__title">${title}</span>
    <span class="plan-tile__meta">${meta}</span>
  </button>`;
}

function compactSubscriptionUrl(url) {
  const raw = String(url || "").trim();
  if (!raw || raw === "—") return "—";
  if (raw.length <= 54) return raw;
  return `${raw.slice(0, 30)}...${raw.slice(-16)}`;
}

function proxyPurchaseTileHtml(days, label, priceMinor = 0) {
  const safeDays = Number(days);
  const title = escAttr(label);
  const priceLabel = priceMinor > 0 ? `${(priceMinor / 100).toFixed(0)} ₽` : "цена по запросу";
  const meta = escAttr(`${safeDays} дн. · ${priceLabel}`);
  return `<button type="button" class="plan-tile plan-tile--proxy" data-proxy-days="${safeDays}">
    <span class="plan-tile__title">${title}</span>
    <span class="plan-tile__meta">${meta}</span>
  </button>`;
}

function formatBalanceTimeEstimate(balanceRub, hourlyRateRub, billingActive) {
  const bal = Number(balanceRub) || 0;
  const rate = Number(hourlyRateRub) || 0;
  if (rate <= 0) return { main: "—", sub: "Ставка не задана" };
  if (!billingActive && bal <= 0) {
    return { main: "—", sub: "Пополните счёт — после первого платежа включится почасовое списание" };
  }
  const hours = bal / rate;
  if (hours <= 0) {
    return { main: "0", sub: "Баланс пуст — пополните, чтобы снова включить VPS" };
  }
  let main;
  if (hours < 1) {
    main = `≈ ${Math.max(1, Math.round(hours * 60))} мин`;
  } else if (hours < 48) {
    main = `≈ ${hours < 10 ? hours.toFixed(1) : Math.round(hours)} ч`;
  } else {
    const d = Math.floor(hours / 24);
    const h = Math.round(hours - d * 24);
    main = `≈ ${d} д ${h} ч`;
  }
  const sub =
    billingActive && bal > 0
      ? "Оценка при активном VPS и текущей ставке"
      : "Оценка по текущей ставке (списание — после первого пополнения)";
  return { main, sub };
}

function balanceTopupBlockHtml(balance) {
  if (!balance?.enabled) return "";
  const br = Number(balance.balanceRub ?? 0);
  const hr = Number(balance.hourlyRateRub ?? 0);
  const minRub = Math.max(1, Math.floor(Number(balance.minTopupRub ?? 60)));
  const est = formatBalanceTimeEstimate(br, hr, Boolean(balance.billingActive));
  const chips = [100, 300, 500, 1000]
    .map(
      (amt) =>
        `<button type="button" class="balance-chip" data-balance-rub="${amt}" title="Подставить ${amt} ₽">${amt} ₽</button>`,
    )
    .join("");
  return `
    <div class="balance-screen">
      <div class="balance-hero">
        <div class="balance-hero__label">Баланс</div>
        <div class="balance-hero__amount">${br.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}<span class="balance-hero__currency"> ₽</span></div>
        <div class="balance-hero__rate">${hr > 0 ? `${hr.toFixed(2)} ₽/час` : "—"}</div>
      </div>
      <div class="balance-time-block">
        <div class="balance-time-block__label">Осталось по времени</div>
        <div class="balance-time-block__value">${escAttr(est.main)}</div>
        <div class="balance-time-block__hint">${escAttr(est.sub)}</div>
      </div>
      <div class="balance-topup-panel">
        <div class="balance-topup-panel__label">Пополнить на сумму</div>
        <div class="balance-input-row">
          <input type="number" class="balance-input text-input" id="balanceTopupAmount" inputmode="numeric" min="${minRub}" max="500000" step="1" placeholder="От ${minRub} ₽" autocomplete="transaction-amount" />
        </div>
        <div class="balance-chips" aria-label="Быстрые суммы">${chips}</div>
        <button type="button" class="btn balance-topup-submit balance-topup-submit--full" id="balanceTopupSubmit">Оплатить</button>
      </div>
    </div>`;
}

function applyTelegramChrome(tg) {
  try {
    const p = tg.themeParams;
    if (p?.secondary_bg_color && tg.setHeaderColor) tg.setHeaderColor(p.secondary_bg_color);
    if (p?.bg_color && tg.setBackgroundColor) tg.setBackgroundColor(p.bg_color);
  } catch {
    /* ignore */
  }
}

/** Светлая тема Telegram → класс для контрастных готических рамок */
function applyThemeVariant(tg) {
  try {
    const hex = tg.themeParams?.bg_color;
    if (!hex || typeof hex !== "string") return;
    const h = hex.replace(/^#/, "");
    if (h.length !== 6) return;
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    document.documentElement.classList.toggle("vl-theme-light", lum > 0.52);
  } catch {
    /* ignore */
  }
}

function appendAppFooter(container) {
  container.appendChild(
    el(
      `<div class="app-footer"><a href="https://t.me/VL_VPNbot" target="_blank" rel="noopener noreferrer">Поддержка</a></div>`,
    ),
  );
}

/** Нижняя навигация — «колесо»: дуга + свайп влево/вправо по доку */
function wheelNavHtml(hasProxy, balanceMode = false) {
  const extendLabel = balanceMode ? "Баланс" : "Срок";
  const rows = hasProxy
    ? [
        { target: "status", label: "Статус", glyph: "◇" },
        { target: "connect", label: "Сеть", glyph: "◎" },
        { target: "proxy", label: "Прокси", glyph: "◈" },
        { target: "extend", label: extendLabel, glyph: "⬡" },
      ]
    : [
        { target: "status", label: "Статус", glyph: "◇" },
        { target: "connect", label: "Сеть", glyph: "◎" },
        { target: "extend", label: extendLabel, glyph: "⬡" },
      ];
  const n = rows.length;
  const lift =
    n === 4 ? ["8px", "0px", "0px", "8px"] : ["8px", "2px", "8px"];
  const btns = rows
    .map(
      (r, i) =>
        `<button type="button" class="seg-btn wheel-dock__btn${i === 0 ? " active" : ""}" data-target="${r.target}" style="--wheel-lift:${lift[i]}"><span class="wheel-dock__glyph" aria-hidden="true">${r.glyph}</span><span class="wheel-dock__label">${r.label}</span></button>`,
    )
    .join("");
  return `<nav class="wheel-dock wheel-dock--${n}" id="vlWheelDock" aria-label="Разделы"><div class="wheel-dock__plate"><div class="wheel-dock__rim" aria-hidden="true"></div><div class="wheel-dock__nodes">${btns}</div></div></nav>`;
}

function bindWheelSwipe(dock) {
  if (!dock) return;
  let x0 = 0;
  dock.addEventListener(
    "touchstart",
    (e) => {
      x0 = e.changedTouches[0].clientX;
    },
    { passive: true },
  );
  dock.addEventListener(
    "touchend",
    (e) => {
      const x1 = e.changedTouches[0].clientX;
      const dx = x1 - x0;
      if (Math.abs(dx) < 44) return;
      const tabs = [...dock.querySelectorAll(".wheel-dock__btn")];
      if (!tabs.length) return;
      let i = tabs.findIndex((b) => b.classList.contains("active"));
      if (i < 0) i = 0;
      if (dx < 0) i = Math.min(i + 1, tabs.length - 1);
      else i = Math.max(i - 1, 0);
      tabs[i]?.click();
    },
    { passive: true },
  );
}

function bindVpnRenewalActions({ tg, me }) {
  const payCfg = me.payment || {};
  const showPaymentMessage = (text) => {
    const msg = String(text || "").trim();
    if (!msg) return;
    try {
      if (typeof tg?.showAlert === "function") {
        tg.showAlert(msg);
        return;
      }
    } catch {
      // fallback to toast
    }
    showToast(msg);
  };
  const openInvoiceInMiniApp = async ({ productCode, grantDays, serviceType = "vps", serverId = "" }) => {
    const token = window.__vlToken || "";
    if (!token) throw new Error("auth_token_missing");
    const r = await api("/api/payments/telegram/invoice-link", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        productCode,
        grantDays: Number(grantDays),
        serviceType,
        serverId: serverId || undefined,
      }),
    });
    if (r?.sentToChat || r?.fallbackToChat) {
      showPaymentMessage("Счёт отправлен в чат с ботом. Откройте диалог и оплатите там.");
      return;
    }
    const link = String(r?.invoiceLink || "").trim();
    if (!link) throw new Error("invoice_link_missing");
    if (typeof tg.openInvoice === "function") {
      tg.openInvoice(link, (status) => {
        if (status === "failed") {
          showPaymentMessage("Не удалось открыть окно оплаты. Счёт отправлен в чат с ботом.");
        }
      });
    } else {
      tg.openLink(link);
    }
  };

  const bindGrid = (rootEl) => {
    if (!rootEl) return;
    rootEl.querySelectorAll(".plan-tile[data-days]").forEach((b) => {
      b.onclick = async () => {
        const days = b.getAttribute("data-days");
        const code =
          b.getAttribute("data-product-code") || payCfg.defaultProductCode || "vps_30";
        try {
          await openInvoiceInMiniApp({ productCode: code, grantDays: days });
        } catch (e) {
          showToast(`Ошибка: ${e.message}`);
        }
      };
    });
  };

  const bindProxyPurchaseGrid = (rootEl, selectedServerGetter) => {
    if (!rootEl) return;
    rootEl.querySelectorAll(".plan-tile[data-proxy-days]").forEach((b) => {
      b.onclick = async () => {
        const days = Number(b.getAttribute("data-proxy-days") || 0);
        const serverId = String(selectedServerGetter?.() || "").trim();
        if (!serverId) return showToast("Сначала выберите площадку прокси");
        try {
          await openInvoiceInMiniApp({
            productCode: `proxy_${serverId}_${days}`,
            grantDays: days,
            serviceType: "proxy",
            serverId,
          });
        } catch (e) {
          showToast(`Ошибка: ${e.message}`);
        }
      };
    });
  };

  const bindProxyInstantPay = ({
    pickerRootSelector,
    planGridId,
    selectedServerRef,
  }) => {
    const pickerButtons = document.querySelectorAll(`${pickerRootSelector} .proxy-btn`);
    const planButtons = document.querySelectorAll(`#${planGridId} .plan-tile[data-proxy-days]`);
    if (!pickerButtons.length || !planButtons.length) return;

    let selectedProxyDays = 7;
    const markPlanActive = (days) => {
      planButtons.forEach((btn) => {
        const d = Number(btn.getAttribute("data-proxy-days") || 0);
        btn.classList.toggle("active", d === Number(days));
      });
    };

    markPlanActive(selectedProxyDays);
    planButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedProxyDays = Number(btn.getAttribute("data-proxy-days") || 7);
        markPlanActive(selectedProxyDays);
      });
    });

    pickerButtons.forEach((btn) => {
      btn.addEventListener("click", async () => {
        const serverId =
          String(btn.getAttribute("data-proxy-server") || "").trim() ||
          String(selectedServerRef?.() || "").trim();
        if (!serverId) return;
        try {
          await openInvoiceInMiniApp({
            productCode: `proxy_${serverId}_${selectedProxyDays}`,
            grantDays: selectedProxyDays,
            serviceType: "proxy",
            serverId,
          });
        } catch (e) {
          showToast(`Ошибка: ${e.message}`);
        }
      });
    });
  };

  bindGrid(document.getElementById("vpnPlanGrid"));
  bindProxyPurchaseGrid(document.getElementById("proxyPlanGrid"), () =>
    document.querySelector("#section-proxy .proxy-btn.active")?.getAttribute("data-proxy-server"),
  );
  bindProxyPurchaseGrid(document.getElementById("proxyPlanGridNoAcc"), () =>
    document.querySelector("#proxyServerPickNoAcc .proxy-btn.active")?.getAttribute("data-proxy-server"),
  );
  bindProxyInstantPay({
    pickerRootSelector: "#section-proxy",
    planGridId: "proxyPlanGrid",
    selectedServerRef: () =>
      document.querySelector("#section-proxy .proxy-btn.active")?.getAttribute("data-proxy-server"),
  });
  bindProxyInstantPay({
    pickerRootSelector: "#proxyServerPickNoAcc",
    planGridId: "proxyPlanGridNoAcc",
    selectedServerRef: () =>
      document.querySelector("#proxyServerPickNoAcc .proxy-btn.active")?.getAttribute("data-proxy-server"),
  });

  const minTopupRub = Math.max(1, Math.floor(Number(me.balance?.minTopupRub ?? 60)));

  const openBalanceInvoice = async (amountRub) => {
    const n = Math.floor(Number(amountRub));
    if (!Number.isFinite(n) || n < minTopupRub) {
      showToast(`Минимум ${minTopupRub} ₽ (ограничение Telegram/платёжного провайдера)`);
      return;
    }
    if (n > 500_000) {
      showToast("Максимум 500 000 ₽ за раз");
      return;
    }
    const token = window.__vlToken || "";
    if (!token) throw new Error("auth_token_missing");
    const r = await api("/api/payments/balance/invoice-link", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ amountRub: n }),
    });
    if (r?.sentToChat || r?.fallbackToChat) {
      showPaymentMessage("Счёт на пополнение отправлен в чат с ботом — откройте и оплатите.");
      return;
    }
    const link = String(r?.invoiceLink || "").trim();
    if (!link) throw new Error("invoice_link_missing");
    if (typeof tg.openInvoice === "function") {
      tg.openInvoice(link, (status) => {
        if (status === "failed") {
          showPaymentMessage("Не удалось открыть оплату. Проверьте чат с ботом.");
        }
      });
    } else {
      tg.openLink(link);
    }
  };

  if (me.balance?.enabled) {
    const submit = () => {
      const inp = document.getElementById("balanceTopupAmount");
      const raw = inp?.value?.trim() ?? "";
      const amountRub = raw === "" ? NaN : Number(raw.replace(",", "."));
      openBalanceInvoice(amountRub).catch((e) => showToast(`Ошибка: ${e.message}`));
    };
    document.getElementById("balanceTopupSubmit")?.addEventListener("click", submit);
    document.getElementById("balanceTopupAmount")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    });
    document.querySelectorAll(".balance-chip[data-balance-rub]").forEach((b) => {
      b.addEventListener("click", () => {
        const amt = b.getAttribute("data-balance-rub");
        const inp = document.getElementById("balanceTopupAmount");
        if (inp) inp.value = amt || "";
      });
    });
  }
}

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
  applyTelegramChrome(tg);
  applyThemeVariant(tg);

  /** Инлайн SVG — орнамент и герб наследуют `color` и тему мини‑аппа. */
  const heroWaveSvg = `<svg class="hero-scene__wave-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 96" fill="none" aria-hidden="true"><path d="M0 88V52c28-18 72-42 118-28 32 10 52 8 78-6 18-10 38-14 58-10 24 4 46 18 66 36 14 12 28 22 40 28v16H0Z" fill="currentColor" fill-opacity="0.08"/><path d="M0 72c32-22 78-48 124-32 30 10 48 6 72-8 22-14 48-20 74-14 26 6 50 22 70 42" stroke="currentColor" stroke-opacity="0.4" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M268 58 292 28l20 36 44-22" stroke="currentColor" stroke-opacity="0.5" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`;

  const initData = tg.initData;
  if (!initData) {
    showError("Нет initData. Откройте через кнопку бота /start.");
    return;
  }

  const splash = el(`
    <div class="splash" id="splash">
      <div class="splash-simple">
        <div class="splash-brand" aria-hidden="true">
          <div class="splash-logo splash-logo--mark">${vlFleurLogoBlock({ animate: true, variant: "splash" })}</div>
        </div>
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
    window.__vlToken = token;
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
  const priceMap = me?.payment?.prices || {};
  const defaultPriceMinorByCode = {
    vps_7: 2500,
    vps_30: 10000,
    vps_90: 30000,
    vps_180: 60000,
    proxy_7: 1800,
    proxy_30: 7200,
  };
  const resolveKnownPriceMinor = ({ code = "", days = 0, serviceType = "" } = {}) => {
    const normalizedCode = String(code || "").trim().toLowerCase();
    const normalizedService = String(serviceType || "").trim().toLowerCase();
    if (normalizedCode && Number.isFinite(Number(priceMap[normalizedCode]))) {
      return Number(priceMap[normalizedCode]);
    }
    if (normalizedCode && Number.isFinite(Number(defaultPriceMinorByCode[normalizedCode]))) {
      return Number(defaultPriceMinorByCode[normalizedCode]);
    }
    const d = Number(days || 0);
    const fallbackCode =
      normalizedService === "proxy" ? `proxy_${Math.floor(d)}` : `vps_${Math.floor(d)}`;
    if (Number.isFinite(Number(priceMap[fallbackCode]))) {
      return Number(priceMap[fallbackCode]);
    }
    if (Number.isFinite(Number(defaultPriceMinorByCode[fallbackCode]))) {
      return Number(defaultPriceMinorByCode[fallbackCode]);
    }
    return 0;
  };
  const proxyPrice7 = resolveKnownPriceMinor({ code: "proxy_7", days: 7, serviceType: "proxy" });
  const proxyPrice30 = resolveKnownPriceMinor({
    code: "proxy_30",
    days: 30,
    serviceType: "proxy",
  });
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
    `<div class="card card--hero card--hero-scene">
      <div class="hero-scene__header" aria-hidden="true">
        <div class="hero-scene__bar"></div>
        <div class="hero-scene__vl">VL</div>
      </div>
      <div class="hero-scene__content">
        <div class="brand">
          <div class="brand-mark brand-mark--logo" aria-hidden="true">
            ${vlFleurLogoBlock({ animate: false, variant: "brand" })}
          </div>
          <div>
            <h1 class="hero-title">VL</h1>
            <div class="muted hero-tagline">Подписка и прокси в одном месте</div>
          </div>
        </div>
      </div>
      <div class="hero-scene__wave-wrap" aria-hidden="true">${heroWaveSvg}</div>
    </div>`,
  );
  root.appendChild(head);

  if (!hasAccount) {
    root.appendChild(
      el(
        `<div class="card section is-visible" id="section-status"><p><b>Аккаунт в панели еще не привязан к вашему Telegram ID.</b></p><p class="muted">После оплаты бот создаст пользователя автоматически, либо обратитесь в поддержку.</p></div>`,
      ),
    );

    root.appendChild(
      el(`
        <div class="card section" id="section-connect">
          <h2 class="section-title">Подключение</h2>
          <p class="muted">После оплаты доступ к VPS Premium выдаётся автоматически. Затем здесь появится кнопка подключения.</p>
          <button class="btn secondary" type="button" id="refreshBtn">Обновить статус</button>
        </div>
      `),
    );

    root.appendChild(
      el(`
        <div class="card section" id="section-extend">
          ${
            me.balance?.enabled
              ? `<h2 class="section-title section-title--balance">Баланс VPS</h2>
          ${balanceTopupBlockHtml(me.balance)}
          <p class="balance-footnote">После пополнения бот привяжет доступ. Оплата через Telegram.</p>`
              : `<h2 class="section-title">Покупка VPS Premium</h2>
          <p class="muted">Выберите тариф и оплатите доступ к VPS Premium.</p>
          <button class="btn" type="button" id="payBtn">Оплатить / Продлить</button>`
          }
          <button class="btn secondary" type="button" id="supportBtnNoAcc">Связаться с поддержкой</button>
        </div>
      `),
    );

    root.appendChild(
      el(`
        <div class="card section" id="section-proxy">
          <h2 class="section-title">Прокси</h2>
          ${
            Array.isArray(me?.proxy?.items) && me.proxy.items.length
              ? `<div class="muted" style="margin-top:8px">Ваши прокси:</div>
                 ${me.proxy.items
                   .map(
                     (it, i) => `
                       <div class="link-block" style="margin-top:10px">
                         <div class="label">#${i + 1} • ${formatProxyRegionHtml(it, me?.proxyServers || [])}</div>
                         <div class="link">${it.socks5.host}:${it.socks5.port}  ${it.socks5.username}:${it.socks5.password}</div>
                         <div class="link" style="margin-top:6px">${it.http.host}:${it.http.port}  ${it.http.username}:${it.http.password}</div>
                       </div>
                     `,
                   )
                   .join("")}`
              : `<div class="muted" style="margin-top:8px;line-height:1.45">Прокси ещё не создан. Выберите площадку — после оплаты доступ создастся автоматически.</div>`
          }
          <div class="proxy-service-card">
            <div class="proxy-service-card__head">
              <span class="proxy-service-card__glyph" aria-hidden="true">◈</span>
              <div>
                <div class="proxy-service-card__title">Прокси</div>
                <div class="proxy-service-card__sub">Новый доступ SOCKS5 / HTTP</div>
              </div>
            </div>
            <div class="country-picker" id="proxyServerPickNoAcc">
              <div class="country-picker-label">Страна / площадка</div>
              <div class="country-picker-grid country-picker-grid--rows">
                ${proxyServerPickButtonsHtml(me?.proxyServers)}
              </div>
            </div>
            <div class="store-field-label" style="margin-top:12px">Тариф прокси</div>
            <div class="plan-grid plan-grid--proxy" id="proxyPlanGridNoAcc">
              ${proxyPurchaseTileHtml(7, "Прокси на неделю", proxyPrice7)}
              ${proxyPurchaseTileHtml(30, "Прокси на месяц", proxyPrice30)}
            </div>
          </div>
          <button class="btn secondary" type="button" id="refreshProxyBtn">Обновить</button>
        </div>
      `),
    );

    root.appendChild(el(wheelNavHtml(true, Boolean(me.balance?.enabled))));
    document.body.classList.add("vl-wheel-layout");
    if (me.balance?.enabled) document.body.classList.add("vl-balance-mode");

    document.querySelectorAll(".seg-btn").forEach((btn) => {
      btn.onclick = () => {
        document.querySelectorAll(".seg-btn").forEach((x) => x.classList.remove("active"));
        btn.classList.add("active");
        const key = btn.getAttribute("data-target");
        document.querySelectorAll(".section").forEach((s) => s.classList.remove("is-visible"));
        document.getElementById(`section-${key}`)?.classList.add("is-visible");
      };
    });
    bindWheelSwipe(document.getElementById("vlWheelDock"));

    document.getElementById("refreshBtn").onclick = () => window.location.reload();
    const payBtnNoAcc = document.getElementById("payBtn");
    if (payBtnNoAcc) payBtnNoAcc.onclick = async () => {
      const pay = me.payment || {};
      try {
        const r = await api("/api/payments/telegram/invoice-link", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            productCode: pay.defaultProductCode || "vps_30",
            grantDays: 30,
            serviceType: "vps",
          }),
        });
        if (r?.sentToChat || r?.fallbackToChat) {
          showToast("Счёт отправлен в чат с ботом — откройте диалог и оплатите.");
          return;
        }
        const link = String(r?.invoiceLink || "").trim();
        if (!link) throw new Error("invoice_link_missing");
        if (typeof tg.openInvoice === "function") tg.openInvoice(link);
        else tg.openLink(link);
      } catch (e) {
        showToast(`Ошибка: ${e.message}`);
      }
    };
    document.getElementById("refreshProxyBtn").onclick = () => window.location.reload();
    document.querySelectorAll("#proxyServerPickNoAcc .country-picker-grid .proxy-btn").forEach((b) => {
      b.onclick = () => {
        document.querySelectorAll("#proxyServerPickNoAcc .proxy-btn").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
      };
    });
    const supportHrefNoAcc = String(me?.subscriptionUi?.supportUrl || "https://t.me/VL_VPNbot");
    document.getElementById("supportBtnNoAcc").onclick = () => tg.openLink(supportHrefNoAcc);
    bindVpnRenewalActions({ tg, me });
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

  const su = me.subscriptionUi;
  const hasSubscriptionUi =
    su &&
    (su.announcement || su.supportUrl || su.profileUrl || su.subscriptionTitle);
  const uiExtras = hasSubscriptionUi
    ? `<div class="subscription-ui-extras" style="margin-top:12px">
          ${
            su.subscriptionTitle
              ? `<div class="label">Подпись узла в клиенте</div><p class="muted" style="margin:0 0 10px;line-height:1.45">${escAttr(su.subscriptionTitle)}</p>`
              : ""
          }
          ${
            su.announcement
              ? `<div class="label">Объявление</div><p class="muted" style="margin:0 0 10px;line-height:1.45;white-space:pre-wrap">${escAttr(su.announcement)}</p>`
              : ""
          }
          ${
            su.profileUrl
              ? `<p class="muted" style="margin:0"><a class="link" href="${escAttr(su.profileUrl)}" target="_blank" rel="noopener noreferrer">Сайт</a></p>`
              : ""
          }
        </div>`
    : "";

  const connect = el(`<div class="card section" id="section-connect">
    <h2 class="section-title">Подключение VPS Premium</h2>
    <p class="muted">Скопируйте URL и импортируйте подписку в клиент.</p>
    ${uiExtras}
    <div class="link-block link-block--compact">
      <div class="label">URL подписки</div>
      <div class="subscription-url" id="subUrl" title="${escAttr(sub)}">${compactSubscriptionUrl(sub)}</div>
    </div>
    <button class="btn secondary" type="button" id="xuiProvisionBtn">${xui?.linked ? "Обновить ссылку (XUI)" : "Создать XUI-подписку"}</button>
    <button class="btn" type="button" id="copyBtn">Скопировать ссылку</button>
    <button class="btn secondary" type="button" id="openBtn">Открыть ссылку</button>
  </div>`);
  root.appendChild(connect);

  if (hasProxy) {
    const p = me.proxy || {};
    const servers = Array.isArray(me.proxyServers) ? me.proxyServers : [];
    const items = Array.isArray(p.items) ? p.items : [];
    const proxySec = el(`<div class="card section" id="section-proxy">
      <h2 class="section-title">Прокси</h2>
      <p class="muted">SOCKS5 и HTTP прокси. Выберите площадку и тариф перед оплатой.</p>

      ${
        `${
           items.length
             ? `<div class="muted" style="margin-top:8px">Ваши прокси:</div>
                ${items
                  .map(
                    (it, i) => `
                      <div class="link-block" style="margin-top:10px">
                        <div class="label">#${i + 1} • ${formatProxyRegionHtml(it, servers)}</div>
                        <div class="link">${it.socks5.host}:${it.socks5.port}  ${it.socks5.username}:${it.socks5.password}</div>
                        <div class="link" style="margin-top:6px">${it.http.host}:${it.http.port}  ${it.http.username}:${it.http.password}</div>
                      </div>
                    `,
                  )
                  .join("")}`
             : `<div class="muted" style="margin-top:8px;line-height:1.45">Прокси ещё не создан. Выберите площадку — после оплаты доступ создастся автоматически.</div>`
         }
             <div class="proxy-service-card">
               <div class="proxy-service-card__head">
                 <span class="proxy-service-card__glyph" aria-hidden="true">◈</span>
                 <div>
                   <div class="proxy-service-card__title">Прокси</div>
                   <div class="proxy-service-card__sub">Выберите площадку и создайте доступ</div>
                 </div>
               </div>
               <div class="country-picker">
                 <div class="country-picker-label">Страна / площадка</div>
                 <div class="country-picker-grid country-picker-grid--rows">
                   ${proxyServerPickButtonsHtml(servers)}
                 </div>
               </div>
              <div class="store-field-label" style="margin-top:12px">Тариф прокси</div>
              <div class="plan-grid plan-grid--proxy" id="proxyPlanGrid">
                ${proxyPurchaseTileHtml(7, "Прокси на неделю", proxyPrice7)}
                ${proxyPurchaseTileHtml(30, "Прокси на месяц", proxyPrice30)}
              </div>
             </div>
             `
      }
    </div>`);
    root.appendChild(proxySec);
  }

  const cat = me.catalog;
  const catalogProducts =
    Array.isArray(cat?.products) && cat.products.length
      ? [...cat.products].sort(
          (a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0),
        )
      : null;
  const payCfg = me.payment || {};
  const invoiceEnabled = Boolean(payCfg.telegramInvoiceEnabled);

  const planTilesHtml = catalogProducts
    ? catalogProducts
        .map((p) => ({
          ...p,
          priceMinor: resolveKnownPriceMinor({
            code: p.code,
            days: p.grantDays,
            serviceType: "vps",
          }),
        }))
        .map((p) => vpnPlanTileHtml(p))
        .join("")
    : [
        {
          grantDays: 30,
          title: "30 дней",
          code: "vps_30",
          priceMinor: resolveKnownPriceMinor({ code: "vps_30", days: 30, serviceType: "vps" }),
        },
        {
          grantDays: 90,
          title: "90 дней",
          code: "vps_90",
          priceMinor: resolveKnownPriceMinor({ code: "vps_90", days: 90, serviceType: "vps" }),
        },
        {
          grantDays: 180,
          title: "180 дней",
          code: "vps_180",
          priceMinor: resolveKnownPriceMinor({
            code: "vps_180",
            days: 180,
            serviceType: "vps",
          }),
        },
      ]
        .map((p) => vpnPlanTileHtml(p))
        .join("");

  const balanceMode = Boolean(me.balance?.enabled);
  const extend = el(
    balanceMode
      ? `<div class="card section" id="section-extend">
    <h2 class="section-title section-title--balance">Баланс VPS</h2>
    ${balanceTopupBlockHtml(me.balance)}
    <p class="balance-footnote">${invoiceEnabled ? "Оплата через Telegram — счёт можно открыть здесь или в чате с ботом." : "Платежи временно недоступны."}</p>
    <div class="actions-stack">
    ${
      isXuiPrimary
        ? `<button class="btn secondary" type="button" id="addDeviceBtn">Докупить +1 устройство (IP лимит)</button>
           <p class="muted" style="margin-top:10px;line-height:1.45">Для XUI «устройство» = увеличение лимита IP в панели 3X-UI (limit IP) для вашего клиента.</p>`
        : `<button class="btn secondary" type="button" id="addDeviceBtn">Докупить +1 устройство</button>`
    }
    <button class="btn secondary" type="button" id="supportBtn">Поддержка</button>
    </div>
  </div>`
      : `<div class="card section" id="section-extend">
    <h2 class="section-title">Покупка VPS Premium</h2>
    ${
      invoiceEnabled
        ? `<p class="muted" style="margin-top:6px;line-height:1.45">После выбора тарифа счёт придёт в чат с ботом.</p>`
        : `<p class="muted" style="margin-top:6px;line-height:1.45">Платежи временно недоступны, обратитесь в поддержку.</p>`
    }
    ${
      catalogProducts
        ? `<p class="muted" style="margin-top:6px;font-size:0.78rem;line-height:1.45">Тарифы загружены из конфигурации сервиса.</p>`
        : ""
    }
    <div class="vpn-renew-card">
      <div class="vpn-renew-card__head">
        <span class="vpn-renew-card__glyph" aria-hidden="true">◎</span>
        <div class="vpn-renew-card__head-text">
          <span class="vpn-renew-card__kind">VPS Premium</span>
          <span class="vpn-renew-card__sub">Продление подписки</span>
        </div>
      </div>
      <div class="store-field-label">Период</div>
      <div class="plan-grid plan-grid--vpn" id="vpnPlanGrid">
        ${planTilesHtml}
      </div>
    </div>
    <div class="actions-stack">
    ${
      isXuiPrimary
        ? `<button class="btn secondary" type="button" id="addDeviceBtn">Докупить +1 устройство (IP лимит)</button>
           <p class="muted" style="margin-top:10px;line-height:1.45">Для XUI «устройство» = увеличение лимита IP в панели 3X-UI (limit IP) для вашего клиента.</p>`
        : `<button class="btn secondary" type="button" id="addDeviceBtn">Докупить +1 устройство</button>`
    }
    <button class="btn secondary" type="button" id="supportBtn">Поддержка</button>
    </div>
  </div>`,
  );
  root.appendChild(extend);

  root.appendChild(el(wheelNavHtml(hasProxy, balanceMode)));
  document.body.classList.add("vl-wheel-layout");
  if (balanceMode) document.body.classList.add("vl-balance-mode");

  bindVpnRenewalActions({ tg, me });

  document.querySelectorAll(".seg-btn").forEach((btn) => {
    btn.onclick = () => {
      document.querySelectorAll(".seg-btn").forEach((x) => x.classList.remove("active"));
      btn.classList.add("active");
      const key = btn.getAttribute("data-target");
      document.querySelectorAll(".section").forEach((s) => s.classList.remove("is-visible"));
      document.getElementById(`section-${key}`)?.classList.add("is-visible");
    };
  });
  bindWheelSwipe(document.getElementById("vlWheelDock"));

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

  document.querySelectorAll("#section-proxy .country-picker-grid .proxy-btn").forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll("#section-proxy .proxy-btn").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
    };
  });

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
        // Fallback: если provision не удался, пробуем /api/me — там есть авто-восстановление привязки.
        try {
          const me2 = await api("/api/me", {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (me2?.xui?.linked && me2?.subscriptionUrl) {
            showToast("Ссылка восстановлена. Обновляем...");
            setTimeout(() => window.location.reload(), 700);
            return;
          }
        } catch {
          // ignored
        }

        const msg = String(e?.message || "");
        if (msg === "xui_not_configured" || msg === "xui_inbound_id_required") {
          showToast("XUI не настроен на сервере (панель/инбаунд)");
        } else if (msg.includes("xui_login_failed")) {
          showToast("Не удалось войти в XUI: проверь URL/логин/пароль/WebBasePath");
        } else if (msg.includes("xui_add_client")) {
          showToast("XUI не создал клиента. Проверь inbound и логи панели");
        } else {
          showToast(`Ошибка: ${msg || "не удалось обновить ссылку"}`);
        }
      } finally {
        provBtn.disabled = false;
        provBtn.textContent = xui?.linked ? "Обновить ссылку (XUI)" : "Создать XUI-подписку";
      }
    };
  }
  const addDev = document.getElementById("addDeviceBtn");
  if (addDev && payCfg.allowTestTools) {
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
  } else if (addDev) {
    addDev.style.display = "none";
  }
  const supportHref = String(me?.subscriptionUi?.supportUrl || "https://t.me/VL_VPNbot");
  document.getElementById("supportBtn").onclick = () => {
    tg.openLink(supportHref);
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