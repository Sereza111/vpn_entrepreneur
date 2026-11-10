import { readFileSync } from "node:fs";
import * as defaultStore from "./cabinetStore.js";

export const CABINET_UPDATES = ["message", "callback_query", "pre_checkout_query", "widget_query"];
const statuses = new Set(["ACTIVE", "EXPIRED", "DISABLED", "LIMITED", "PENDING"]);
const labels = {
  ACTIVE: "Доступ активен", EXPIRED: "Срок доступа истёк", DISABLED: "Доступ приостановлен",
  LIMITED: "Лимит трафика исчерпан", PENDING: "Подписка требует проверки",
  UNLINKED: "Подписка ещё не подключена", UNKNOWN: "Не удалось проверить доступ",
};
const numberOrNull = (v) => v != null && Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : null;
const validId = (v) => Number.isSafeInteger(Number(v)) && Number(v) > 0;

function telegramUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "t.me" && !url.username && !url.password &&
      !url.port && value.length <= 200 ? value : "";
  } catch { return ""; }
}

// Explicit allowlist: loadMe also contains VPN credentials and must never be serialized wholesale.
export function cabinetSnapshot(me, { username = "", now = new Date() } = {}) {
  const s = me?.subscriptionStatus;
  const status = !me || me.subscriptionCheck === "unavailable" ? "UNKNOWN"
    : statuses.has(s?.panelStatus) ? s.panelStatus
    : me?.xui?.linked ? "PENDING" : "UNLINKED";
  const date = s?.expireAt ? Date.parse(s.expireAt) : NaN;
  const support = telegramUrl(me?.subscriptionUi?.supportUrl || "");
  const ownUrl = /^[a-zA-Z0-9_]{5,32}$/.test(username) ? `https://t.me/${username}` : "";
  return {
    v: 1, status, expiry: Number.isFinite(date) ? new Date(date).toISOString() : null,
    used: s ? numberOrNull(s.usedTrafficBytes) : null,
    limit: s ? numberOrNull(s.trafficLimitBytes) : null,
    balance: me?.balance?.enabled ? numberOrNull(me.balance.balanceMinor) : null,
    billing: Boolean(me?.balance?.enabled), free: Boolean(me?.balance?.freeMode),
    updated: now.toISOString(), app: ownUrl ? `${ownUrl}?startapp=` : "",
    support: support.toLowerCase() === ownUrl.toLowerCase() ? "" : support,
  };
}

export function cabinetCaption(data) {
  const lines = ["VL VPN · ваш кабинет", "", labels[data.status] || labels.UNKNOWN];
  if (data.expiry) lines.push(`Доступ до ${new Date(data.expiry).toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" })}`);
  else if (data.status === "ACTIVE") lines.push("Без ограничения по дате");
  if (data.balance !== null) lines.push(`Баланс: ${(data.balance / 100).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₽`);
  if (data.used !== null) lines.push(`Трафик: ${(data.used / 1073741824).toFixed(2)} ГБ${data.limit > 0 ? ` из ${(data.limit / 1073741824).toFixed(2)} ГБ` : ""}`);
  lines.push("", "Подключение, пополнение и помощь — кнопками ниже.");
  if (data.status === "ACTIVE") lines.push("Статус доступа не означает, что VPN включён на устройстве.");
  return lines.join("\n");
}

export function diagnosis(data) {
  const advice = {
    ACTIVE: "Срок и лимиты позволяют пользоваться подпиской. Обновите подписку в VPN-приложении и повторите подключение. Если соединение есть, но сайты не открываются, проверьте включение VPN/системного прокси в клиенте.",
    EXPIRED: "Срок доступа истёк. Откройте пополнение, затем обновите подписку в клиенте.",
    DISABLED: "Доступ приостановлен. Проверьте баланс в кабинете; если средств достаточно, обратитесь в поддержку.",
    LIMITED: "Достигнут лимит трафика. Проверьте условия подписки в кабинете или обратитесь в поддержку.",
    PENDING: "Привязка подписки есть, но доступ в панели пока не подтверждён. Откройте кабинет; при повторении обратитесь в поддержку.",
    UNLINKED: "Для аккаунта ещё нет подключённой подписки. Откройте кабинет и оформите доступ; затем следуйте инструкции подключения.",
    UNKNOWN: "Панель временно не ответила. Повторите проверку позже. Это не означает, что VPN-соединение перестало работать.",
  };
  return `VL VPN · помощь\n\n${labels[data.status]}\n\n${advice[data.status] || advice.UNKNOWN}`;
}

const apiCode = (e) => Number(e?.error_code) || "network";
const notModified = (e) => Number(e?.error_code) === 400 && /not modified/i.test(e?.description || "");
const gone = (e) => Number(e?.error_code) === 403 || Number(e?.error_code) === 400 && /message to edit not found|message can't be edited|message_id_invalid/i.test(e?.description || "");
const widgetUnavailable = (e) => Number(e?.error_code) === 404 || Number(e?.error_code) === 400 && /widget|method.*not.*found|unsupported/i.test(e?.description || "");
async function withDeadline(operation, ms) {
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("deadline")), ms); }),
    ]);
  } finally { clearTimeout(timer); }
}

export function createCabinet({ api, loadMe, webAppUrl, store = defaultStore,
  widgetsEnabled = true, html, log = console, snapshotTimeoutMs = 8000, ownershipTimeoutMs = 1500 }) {
  let template = html;
  let username = "";
  let widgetDisabledUntil = 0;
  const cache = new Map();
  const inFlight = new Map();
  const busyRefresh = new Set();
  let identity;

  async function ensureIdentity() {
    if (username) return;
    identity ??= api.getMe(AbortSignal.timeout(5000)).then(me => { username = me.username; }).finally(() => { identity = null; });
    await identity;
  }

  function appLink(view) {
    const url = new URL(webAppUrl);
    url.searchParams.set("view", view);
    return url.toString();
  }
  function keyboard(kind = "widget") {
    const rows = [
      [{ text: "Подключить", web_app: { url: appLink("connect") } }, { text: "Пополнить", web_app: { url: appLink("balance") } }],
      [{ text: "Обновить", callback_data: "cab:refresh" }, { text: "Не работает?", callback_data: "cab:help" }],
    ];
    if (kind === "widget") rows.push([{ text: "Текстовое меню", callback_data: "cab:text" }]);
    return { inline_keyboard: rows };
  }
  async function snapshot(id, { force = false } = {}) {
    const old = cache.get(id);
    if (!force && old && Date.now() - old.at < 5000) return old.data;
    if (inFlight.has(id)) {
      const pending = await inFlight.get(id);
      if (!force) return pending;
      // A payment must not reuse a read started before the balance was credited.
    }
    const task = (async () => {
      let timer;
      let me = null;
      try {
        me = await Promise.race([
          Promise.all([loadMe(id), ensureIdentity()]).then(([me]) => me),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("snapshot_timeout")), snapshotTimeoutMs); }),
        ]);
      } catch { log.warn("[cabinet] status unavailable"); }
      finally { clearTimeout(timer); }
      const data = cabinetSnapshot(me, { username });
      if (Buffer.byteLength(JSON.stringify(data)) > 1024) throw new Error("cabinet_state_too_large");
      if (cache.size >= 256) cache.delete(cache.keys().next().value);
      cache.set(id, { at: Date.now(), data });
      return data;
    })();
    inFlight.set(id, task);
    try { return await task; }
    finally { if (inFlight.get(id) === task) inFlight.delete(id); }
  }
  async function edit(id, card, data) {
    try {
      if (card.kind === "widget") {
        await api.raw.editMessageWidgetData({ chat_id: id, message_id: card.messageId, chat_data: JSON.stringify(data) }, AbortSignal.timeout(5000));
        try { await api.editMessageCaption(id, card.messageId, { caption: cabinetCaption(data) }, AbortSignal.timeout(5000)); }
        catch (e) { if (!notModified(e)) throw e; }
      } else {
        await api.editMessageText(id, card.messageId, cabinetCaption(data), { reply_markup: keyboard("text") }, AbortSignal.timeout(5000));
      }
    } catch (e) {
      if (gone(e)) await store.forgetCard(id, card.messageId);
      else if (!notModified(e)) log.warn("[cabinet] update failed", apiCode(e));
    }
  }
  async function show(ctx, { textOnly = false } = {}) {
    if (ctx.chat?.type !== "private" || ctx.chat.id !== ctx.from?.id) return;
    username = ctx.me?.username || username;
    const id = ctx.from.id;
    const data = await snapshot(id);
    let sent;
    let kind = "text";
    if (widgetsEnabled && !textOnly && Date.now() >= widgetDisabledUntil) {
      try {
        template ??= readFileSync(new URL("./widget.html", import.meta.url), "utf8");
        sent = await api.raw.sendWidget({
          chat_id: id, html: template, chat_data: JSON.stringify(data), allow_queries: true,
          caption: cabinetCaption(data), reply_markup: keyboard("widget"), protect_content: true,
        }, AbortSignal.timeout(5000));
        kind = "widget";
      } catch (e) {
        // A network timeout may have delivered the widget; do not send duplicate messages.
        if (!widgetUnavailable(e)) throw e;
        widgetDisabledUntil = Date.now() + 5 * 60_000;
        log.warn("[cabinet] widget unavailable; using text menu", apiCode(e));
      }
    }
    sent ??= await ctx.reply(cabinetCaption(data), { reply_markup: keyboard("text") }, AbortSignal.timeout(5000));
    await store.rememberCard(id, { messageId: sent.message_id, kind });
  }
  async function refreshUser(id) {
    id = Number(id);
    if (!validId(id)) return;
    const cards = await store.getCards(id);
    if (!cards.length) return;
    const data = await snapshot(id, { force: true });
    for (const card of cards) await edit(id, card, data);
  }
  async function middleware(ctx, next) {
    const q = ctx.update.widget_query;
    if (q) {
      const id = q.from?.id;
      const privateQuery = validId(id) && q.chat?.type === "private" && q.chat.id === id &&
        q.type?.type === "data" && q.data === "refresh" && validId(q.message_id);
      const cards = privateQuery
        ? await withDeadline(store.getCards(id), ownershipTimeoutMs).catch(() => []) : [];
      const authorized = cards.some(c => c.kind === "widget" && c.messageId === q.message_id);
      await api.raw.answerWidgetQuery({ widget_query_id: q.id, data: JSON.stringify({ ok: Boolean(authorized) }) }, AbortSignal.timeout(5000));
      const key = `${id}:${q.message_id}`;
      if (!authorized || busyRefresh.has(key)) return;
      busyRefresh.add(key);
      try {
        username = ctx.me?.username || username;
        const data = await snapshot(id);
        // Change the revision even on a cached response so the widget leaves its loading state.
        await edit(id, { kind: "widget", messageId: q.message_id }, { ...data, updated: new Date().toISOString() });
      } finally { busyRefresh.delete(key); }
      return;
    }
    const cb = ctx.callbackQuery;
    if (!cb?.data?.startsWith("cab:")) return next();
    const id = cb.from?.id;
    if (!validId(id) || cb.message?.chat?.type !== "private" || cb.message.chat.id !== id) {
      await ctx.answerCallbackQuery({ text: "Откройте личный чат с ботом." });
      return;
    }
    await ctx.answerCallbackQuery();
    username = ctx.me?.username || username;
    if (cb.data === "cab:text") return show(ctx, { textOnly: true });
    const data = await snapshot(id);
    if (cb.data === "cab:help") {
      const rows = keyboard("text").inline_keyboard;
      if (data.support) rows.push([{ text: "Поддержка", url: data.support }]);
      await ctx.reply(diagnosis(data), { reply_markup: { inline_keyboard: rows } });
    } else if (cb.data === "cab:refresh") {
      const card = (await store.getCards(id)).find(c => c.messageId === cb.message.message_id);
      if (card) await edit(id, card, { ...data, updated: new Date().toISOString() });
      else await show(ctx, { textOnly: true });
    }
  }
  return { show, middleware, refreshUser };
}
