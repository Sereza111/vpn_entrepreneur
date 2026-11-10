// Official client downloads and import format:
// https://github.com/Happ-proxy/happ-android#readme
// https://www.happ.su/main/faq/adding-configuration-subscription
// https://github.com/Happ-proxy/3x-ui/blob/main/web/assets/js/subscription.js (happUrl)
// XHTTP: Happ 4.3.0 release notes; v2rayN/ServiceLib/Enums/ETransport.cs.
const DEVICES = {
  android: {
    label: "Android", client: "Happ", icon: "phone",
    download: "https://play.google.com/store/apps/details?id=com.happproxy",
    downloadLabel: "Happ в Google Play",
    alternate: "https://github.com/Happ-proxy/happ-android/releases/latest/download/Happ.apk",
    alternateLabel: "APK с официального GitHub",
    install: "Установите актуальную версию Happ. Если Google Play недоступен, скачайте APK со страницы разработчика.",
  },
  ios: {
    label: "iPhone / iPad", client: "Happ", icon: "phone",
    download: "https://apps.apple.com/us/app/happ-proxy-utility/id6504287215",
    downloadLabel: "Happ в App Store",
    alternate: "https://apps.apple.com/ru/app/happ-lite/id6799917773",
    alternateLabel: "Happ Lite · российский App Store",
    install: "Установите Happ из App Store. Для российского Apple ID разработчик предлагает Happ Lite.",
  },
  windows: {
    label: "Windows", client: "v2rayN", icon: "desktop",
    download: "https://github.com/2dust/v2rayN/releases/latest",
    downloadLabel: "Скачать v2rayN",
    install: "На официальной странице откройте Assets и выберите пакет для Windows: x64 для большинства ПК или arm64 для Windows on ARM. Распакуйте архив целиком и запустите v2rayN.exe.",
  },
};

const STEPS = ["Установка", "Подписка", "Запуск"];

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]));

function validDevice(value) {
  return Object.hasOwn(DEVICES, value || "") ? value : "";
}

/** Navigation hints only; authentication is still completed by boot before use. */
export function readLaunchTarget(tg, search = window.location.search) {
  const query = new URLSearchParams(search);
  const view = query.get("view");
  if (view === "balance") return { section: "extend", device: "" };
  if (view === "connect") return { section: "connect", device: validDevice(query.get("device")) };
  const start = String(tg?.initDataUnsafe?.start_param ||
    new URLSearchParams(tg?.initData || "").get("start_param") ||
    query.get("tgWebAppStartParam") || query.get("start_param") || "");
  if (start === "balance") return { section: "extend", device: "" };
  if (start === "connect") return { section: "connect", device: "" };
  const match = /^connect_(android|ios|windows)$/.exec(start);
  return match ? { section: "connect", device: match[1] } : null;
}

function subscriptionLink(value) {
  const raw = String(value || "").trim();
  try {
    const url = new URL(raw);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return "";
    return raw;
  } catch {
    return "";
  }
}

function deviceIcon(kind) {
  return `<svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true">${kind === "desktop"
    ? '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8m-4-4v4"/>'
    : '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 5h4m-3 14h2"/>'}</svg>`;
}

export function mountConnectionWizard(host, { subscriptionUrl, initialDevice = "", balanceEnabled = false, tg, toast }) {
  if (!host || host.dataset.mounted) return;
  host.dataset.mounted = "true";
  // Keep navigation state in this mounted wizard; status polling never resets it.
  const state = { device: validDevice(initialDevice), steps: {}, manual: false, notice: "" };
  const sub = subscriptionLink(subscriptionUrl);

  const externalLink = (url, label, secondary = false) => `<a class="${secondary ? "connect-text-link" : "btn"}" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" data-client-download>${label} <span aria-hidden="true">↗</span></a>`;

  function render() {
    const device = DEVICES[state.device];
    const step = state.steps[state.device] || 0;
    host.dataset.device = state.device;
    host.dataset.step = String(step);
    host.innerHTML = `<div class="connect-device-label">На каком устройстве подключаемся?</div>
      <div class="connect-devices" role="group" aria-label="Устройство для подключения">${Object.entries(DEVICES).map(([key, item]) =>
        `<button type="button" class="connect-device ${state.device === key ? "is-selected" : ""}" data-connect-device="${key}" aria-pressed="${state.device === key}">${deviceIcon(item.icon)}<span>${item.label}</span></button>`).join("")}</div>
      ${device ? `<nav class="connect-steps" aria-label="Шаги подключения">${STEPS.map((label, index) =>
        `<button type="button" data-connect-step="${index}" ${index === step ? 'aria-current="step"' : ""}><span>${String(index + 1).padStart(2, "0")}</span>${label}</button>`).join("")}</nav>
        <div class="connect-stage" aria-labelledby="connectStageTitle">
          <div class="connect-stage__overline">${escapeHtml(device.client)} / ${escapeHtml(device.label)}</div>
          ${stageHtml(device, step)}
        </div>` : `<div class="connect-intro"><span aria-hidden="true">✦</span><p>Три шага до вашей сети.<br>Выберите устройство — покажем подходящее приложение и способ добавления подписки.</p></div>`}`;
  }

  function stageHtml(device, step) {
    if (step === 0) return `<h3 id="connectStageTitle">Установите ${device.client}</h3>
      <p class="muted">${device.install}</p>
      ${externalLink(device.download, device.downloadLabel)}
      ${device.alternate ? externalLink(device.alternate, device.alternateLabel, true) : ""}
      <p class="connect-note">После установки вернитесь в этот экран. Приложение уже есть? Переходите дальше.</p>
      <button type="button" class="btn secondary" data-connect-step="1">Приложение установлено →</button>`;

    if (!sub) return `<h3 id="connectStageTitle">Подписка пока недоступна</h3>
      <p class="muted">Если доступ ещё не оформлен, ${balanceEnabled ? "пополните баланс" : "выберите тариф"}. Если уже оплатили, обновите кабинет. Установленное приложение пригодится после появления ссылки.</p>
      <button type="button" class="btn" data-go="extend">${balanceEnabled ? "Перейти к балансу" : "Выбрать тариф"} ↗</button>
      <button type="button" class="btn secondary" data-connect-refresh>Обновить кабинет</button>`;

    if (step === 1) return `<h3 id="connectStageTitle">Добавьте вашу подписку</h3>
      <p class="muted">Одна ссылка добавит доступные направления в ${device.client}. Скопируйте её на устройство, которое подключаете.</p>
      <button type="button" class="btn" id="copyBtn" data-connect-copy>Скопировать подписку</button>
      ${state.device !== "windows" ? `<a class="btn secondary" data-connect-import href="${escapeHtml(`happ://add/${sub}`)}">Добавить в Happ <span aria-hidden="true">↗</span></a>
        <p class="connect-note">Кнопка предложит открыть установленный Happ. Если Telegram не открывает приложение, используйте буфер обмена по инструкции ниже.</p>` : ""}
      <ol class="connect-instructions">${state.device === "windows"
        ? '<li>Откройте v2rayN на компьютере.</li><li>В меню <strong>Подписки / Subscription group</strong> откройте настройки группы, создайте группу с названием VL VPN и вставьте скопированную ссылку в поле URL.</li><li>Сохраните группу и выберите обновление подписки <strong>без прокси / without proxy</strong>. Дождитесь списка серверов.</li>'
        : '<li>Откройте Happ и нажмите <strong>«+»</strong>.</li><li>Выберите добавление <strong>из буфера обмена</strong> и разрешите вставку, если приложение спросит.</li><li>Подтвердите добавление подписки и дождитесь списка серверов.</li>'}</ol>
      <button type="button" class="connect-text-link" data-connect-manual>Показать ссылку для ручного копирования</button>
      <div class="connect-manual" ${state.manual ? "" : "hidden"}>
        <label for="connectSubscriptionUrl">Личная ссылка подписки</label>
        <textarea id="connectSubscriptionUrl" rows="3" readonly spellcheck="false" autocapitalize="off">${escapeHtml(sub)}</textarea>
        <p class="connect-note">Выделите и скопируйте весь адрес. Не публикуйте его: он даёт доступ к вашей подписке.</p>
      </div>
      <p class="connect-notice" role="status" aria-live="polite">${escapeHtml(state.notice)}</p>
      <button type="button" class="btn secondary" data-connect-step="2">Подписка добавлена →</button>`;

    return `<h3 id="connectStageTitle">Включите VPN в приложении</h3>
      <ol class="connect-instructions">${state.device === "windows"
        ? '<li>В v2rayN выберите сервер VL VPN и сделайте его активным. Используйте ядро <strong>Xray</strong> для этого подключения.</li><li>Включите <strong>Системный прокси / Set system proxy</strong>. Это подключит браузер и программы, использующие системный прокси.</li><li>Откройте обычный сайт и проверьте, что он загружается. Для всего трафика на компьютере в клиенте предусмотрен TUN-режим с правами администратора.</li>'
        : '<li>В Happ выберите сервер из подписки VL VPN.</li><li>Нажмите кнопку подключения. При первом запуске подтвердите системный запрос на добавление VPN.</li><li>Откройте обычный сайт и проверьте, что он загружается.</li>'}</ol>
      <div class="connect-check"><span aria-hidden="true">◇</span><p>Состояние соединения смотрите в ${device.client}. Кабинет не может определить, включён ли VPN на устройстве.</p></div>
      <button type="button" class="btn secondary" data-connect-step="1">Вернуться к подписке</button>
      <details class="connection-guide"><summary>Не подключается? <span aria-hidden="true">+</span></summary><p class="muted">Обновите приложение и подписку, попробуйте другой сервер из списка. Проверьте баланс и статус доступа в кабинете. Если список пуст или ошибка остаётся, обратитесь в поддержку на экране оплаты.</p></details>`;
  }

  host.addEventListener("click", async (event) => {
    const deviceButton = event.target.closest("[data-connect-device]");
    if (deviceButton) {
      state.device = validDevice(deviceButton.dataset.connectDevice);
      state.notice = "";
      render();
      return;
    }
    const stepButton = event.target.closest("[data-connect-step]");
    if (stepButton) {
      const step = Number(stepButton.dataset.connectStep);
      if (!state.device || !Number.isInteger(step) || step < 0 || step >= STEPS.length) return;
      state.steps[state.device] = step;
      state.notice = "";
      render();
      host.querySelector("#connectStageTitle")?.setAttribute("tabindex", "-1");
      host.querySelector("#connectStageTitle")?.focus({ preventScroll: true });
      host.querySelector(".connect-stage")?.scrollIntoView({ block: "start", behavior: "auto" });
      return;
    }
    if (event.target.closest("[data-connect-manual]")) {
      state.manual = true;
      host.querySelector(".connect-manual").hidden = false;
      const field = host.querySelector("#connectSubscriptionUrl");
      field.focus({ preventScroll: true });
      field.select();
      field.scrollIntoView({ block: "center", behavior: "auto" });
      return;
    }
    if (event.target.closest("[data-connect-copy]")) {
      try {
        await navigator.clipboard.writeText(sub);
        state.notice = "Ссылка скопирована. Теперь добавьте её в VPN-приложение.";
        toast?.("Подписка скопирована");
      } catch {
        state.manual = true;
        state.notice = "Автокопирование недоступно. Скопируйте выделенную ссылку вручную.";
      }
      // Clipboard completion may arrive after the user has changed devices or steps.
      const notice = host.querySelector(".connect-notice");
      if (notice) notice.textContent = state.notice;
      const manual = host.querySelector(".connect-manual");
      if (manual && state.manual) {
        manual.hidden = false;
        const field = host.querySelector("#connectSubscriptionUrl");
        field.focus({ preventScroll: true });
        field.select();
        field.scrollIntoView({ block: "center", behavior: "auto" });
      }
      return;
    }
    const download = event.target.closest("[data-client-download]");
    if (download && typeof tg?.openLink === "function") {
      event.preventDefault();
      tg.openLink(download.href);
    }
    if (event.target.closest("[data-connect-refresh]")) window.location.reload();
  });

  render();
}
