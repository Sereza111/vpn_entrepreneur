import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import vm from "node:vm";

const html = readFileSync(new URL("../src/bot/widget.html", import.meta.url), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const snapshot = {
  v: 1, status: "ACTIVE", expiry: "2026-12-09T12:00:00Z",
  updated: "2026-11-10T12:00:00Z", used: 1073741824, limit: 0,
  balance: 12345, billing: true, free: false,
  app: "https://t.me/VL_VPNbot?startapp=", support: "https://t.me/VL_VPNbot",
};

// A minimal bridge/DOM harness exercises the immutable template's protocol.
// Browser layout and the Telegram widget renderer are separate checks.
function widget({ data = snapshot, request = () => Promise.resolve({ result: '{"ok":true}' }), ...bridge } = {}) {
  const nodes = new Map();
  const events = new Map();
  const timers = new Map();
  const requests = [];
  const links = [];
  let click;
  let id = 0;
  const get = (key) => {
    if (!nodes.has(key)) nodes.set(key, { textContent: "", innerHTML: "", className: "" });
    return nodes.get(key);
  };
  const W = {
    chatType: "private", isForward: false, isPreview: false,
    chatData: JSON.stringify(data), ready() {},
    onEvent(name, fn) { events.set(name, fn); },
    request(value) { requests.push(value); return request(value); },
    openTelegramLink(url) { links.push(url); },
    ...bridge,
  };
  vm.runInNewContext(script, {
    window: { TelegramWidget: W },
    document: {
      getElementById: get,
      querySelectorAll() { return []; },
      addEventListener(name, fn) { if (name === "click") click = fn; },
    },
    setTimeout(fn) { timers.set(++id, fn); return id; },
    clearTimeout(key) { timers.delete(key); },
  });
  return {
    get, requests, links, timers,
    tap(dataset) { click({ target: { closest() { return { dataset }; } } }); },
    update(data) { W.chatData = JSON.stringify(data); events.get("chatDataChanged")(); },
  };
}

test("widget fits Telegram's raw and compressed payload limits", () => {
  assert.ok(Buffer.byteLength(html) <= 32768);
  assert.ok(deflateSync(html, { level: 9 }).length <= 4096);
  assert.doesNotMatch(html, /\b(fetch|XMLHttpRequest|WebSocket|window\.open|visualize|openai)\b/);
  assert.doesNotMatch(html, /<(?:link|iframe|input|meta)\b/i);
});

test("snapshot renders only private state and distinguishes missing values from zero", () => {
  const w = widget();
  assert.match(w.get("content").innerHTML, /29 <small>дн/);
  assert.match(w.get("content").innerHTML, /123\.45 ₽/);
  assert.match(w.get("content").innerHTML, /1\.0 ГБ \/ ∞/);
  assert.deepEqual(w.requests, []);
  w.update({ ...snapshot, status: "UNKNOWN", expiry: null, balance: null, used: null, limit: null });
  assert.match(w.get("content").innerHTML, /Нет данных/);
  assert.doesNotMatch(w.get("content").innerHTML, /Без срока|∞|0\.00 ₽/);
  assert.match(w.get("notice").textContent, /Нет данных/);
  for (const bridge of [{ isForward: true }, { chatType: "group" }, { data: null }]) {
    assert.doesNotMatch(widget(bridge).get("content").innerHTML, /123\.45|Доступ активен/);
  }
});

test("connection choices open the matching Mini App and support cannot loop into the same bot", () => {
  const w = widget();
  for (const device of ["android", "ios", "windows"]) {
    w.tap({ view: "connect" });
    w.tap({ device });
    w.tap({ action: "guide" });
    assert.equal(w.links.at(-1), snapshot.app + "connect_" + device);
  }
  w.tap({ action: "balance" });
  assert.equal(w.links.at(-1), snapshot.app + "balance");
  w.tap({ view: "help" });
  w.tap({ issue: "access" });
  assert.doesNotMatch(w.get("content").innerHTML, /Открыть поддержку/);
  assert.match(w.get("content").innerHTML, /Соединение проверяй в VPN-клиенте/);
  w.update({ ...snapshot, support: "https://t.me/vl_help" });
  w.tap({ action: "support" });
  assert.equal(w.links.at(-1), "https://t.me/vl_help");
  const invalid = widget({ data: { ...snapshot, app: "javascript:alert(1)" } });
  invalid.tap({ action: "balance" });
  assert.deepEqual(invalid.links, []);
});

test("refresh waits for chatDataChanged, rather than treating the answer as fresh data", async () => {
  const w = widget();
  w.tap({ action: "refresh" });
  w.tap({ action: "refresh" });
  assert.deepEqual(w.requests, ["refresh"]);
  assert.match(w.get("notice").textContent, /Обновляем/);
  await Promise.resolve();
  assert.match(w.get("notice").textContent, /Ждём данные/);
  assert.equal(w.timers.size, 1);
  w.update({ ...snapshot, balance: 500, updated: "2026-11-10T12:01:00Z" });
  assert.match(w.get("notice").textContent, /Данные обновлены/);
  assert.match(w.get("content").innerHTML, /5\.00 ₽/);
  assert.equal(w.timers.size, 0);
});

test("all request failures and missing state updates are visible and retryable", async () => {
  const errors = {
    NOT_ALLOWED: "Открой личный чат", BUSY: "Запрос уже идёт",
    RATE_LIMITED: "Слишком часто", TIMEOUT: "Нет ответа",
    FAILED: "Сбой обновления", INVALID_ANSWER: "Ошибка ответа",
  };
  for (const [code, message] of Object.entries(errors)) {
    const w = widget({ request: () => Promise.reject({ code }) });
    w.tap({ action: "refresh" });
    await Promise.resolve();
    assert.match(w.get("notice").textContent, new RegExp(message));
    assert.equal(w.timers.size, 0);
    w.tap({ action: "refresh" });
    await Promise.resolve();
    assert.equal(w.requests.length, 2);
  }
  const w = widget();
  w.tap({ action: "refresh" });
  await Promise.resolve();
  [...w.timers.values()][0]();
  assert.match(w.get("notice").textContent, /Нет ответа/);
});

test("fresh data wins over a late rejected request and PENDING does not prescribe repair", async () => {
  let reject;
  const w = widget({ request: () => new Promise((_, fail) => { reject = fail; }) });
  w.tap({ action: "refresh" });
  w.update({ ...snapshot, updated: "2026-11-10T12:01:00Z" });
  reject({ code: "TIMEOUT" });
  await Promise.resolve();
  assert.equal(w.get("notice").textContent, "Данные обновлены");
  w.update({ ...snapshot, status: "PENDING" });
  assert.match(w.get("content").innerHTML, /Нужна проверка/);
  w.tap({ view: "help" });
  w.tap({ issue: "access" });
  assert.doesNotMatch(w.get("content").innerHTML, /Восстанови|ремонт/);
  w.tap({ issue: "connect" });
  assert.match(w.get("content").innerHTML, /повтори подключение/);
});
