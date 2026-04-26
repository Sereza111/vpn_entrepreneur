import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import net from "node:net";
import fs from "fs/promises";
import { Bot, InlineKeyboard, webhookCallback } from "grammy";
import { Agent } from "undici";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { config } from "./config.js";
import { validateWebAppInitData } from "./telegramWebApp.js";
import { signSession, verifySession } from "./session.js";
import * as xuiStore from "./xuiLinksStore.js";
import * as xui from "./xuiApi.js";
import * as proxyStore from "./proxyStore.js";
import {
  ensureProxyUserOnServer,
  generateProxyCredentials,
  parseProxyServers,
  removeProxyUserOnServer,
} from "./proxyProvision.js";
import * as balanceStore from "./balanceStore.js";
import * as referralStore from "./referralStore.js";
import * as paymentWebhookStore from "./paymentWebhookStore.js";
import * as timewebApi from "./timewebApi.js";
import * as yookassaApi from "./yookassaApi.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "..", "public");
const whPath = "/telegram/webhook";

const DEFAULT_PRICE_MAP_MINOR = {
  vps_7: 2500,
  vps_30: 10000,
  vps_90: 30000,
  vps_180: 60000,
  proxy_7: 1800,
  proxy_30: 7200,
  device_1: 15000,
};

function parsePriceMapFromConfig(raw) {
  if (!raw) return { ...DEFAULT_PRICE_MAP_MINOR };
  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return { ...DEFAULT_PRICE_MAP_MINOR };
    const out = {};
    const normalizeMinorAmount = (value) => {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 1) return null;
      const i = Math.floor(n);
      // Compatibility: some configs were entered in RUB (25, 99, 300),
      // while Telegram expects minor units (kopeks).
      return i < 1000 ? i * 100 : i;
    };
    for (const [k, v] of Object.entries(obj)) {
      const n = normalizeMinorAmount(v);
      if (!Number.isFinite(n) || n < 1) continue;
      out[String(k).trim().toLowerCase()] = n;
    }
    // Canonical weekly pricing must stay consistent in UI and invoice
    // even when stale environment values are still present.
    return { ...out, ...DEFAULT_PRICE_MAP_MINOR };
  } catch {
    return { ...DEFAULT_PRICE_MAP_MINOR };
  }
}

const PAYMENT_PRICE_MAP_MINOR = parsePriceMapFromConfig(config.payment.priceMapJson);

function extractStartPayload(text) {
  const raw = String(text || "").trim();
  if (!raw) return "";
  const m = /^\/start(?:@\w+)?(?:\s+(.+))?$/i.exec(raw);
  return String(m?.[1] || "").trim();
}

function parseRefInviterId(payload) {
  const p = String(payload || "").trim();
  const m = /^ref_(\d{5,20})$/i.exec(p);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function maybeAwardReferralBonus({ inviteeTelegramId, paidMinor }) {
  if (!config.referral.enabled) return null;
  const amount = Math.max(0, Math.floor(Number(paidMinor || 0)));
  if (amount < config.referral.minQualifyingTopupMinor) return null;
  const ref = await referralStore.getByInvitee(inviteeTelegramId);
  const inviterId = Number(ref?.inviterTelegramId || 0);
  if (!ref || !inviterId || inviterId === Number(inviteeTelegramId || 0)) return null;
  if (ref.rewardedAt) return null;
  const bonusMinor = Math.max(0, Math.floor(Number(config.referral.bonusMinor || 0)));
  if (bonusMinor < 1) return null;
  await balanceStore.credit(inviterId, bonusMinor);
  await referralStore.markRewarded({
    inviteeTelegramId,
    qualifyingPaymentMinor: amount,
    bonusMinor,
  });
  return { inviterId, bonusMinor };
}

function resolvePlanPriceMinor(selection = {}) {
  const code = String(selection.productCode || "").trim().toLowerCase();
  const days = Number(selection.days || selection.grantDays || 0);
  const serviceType = String(selection.serviceType || "").trim().toLowerCase();
  const canonicalKey = serviceType === "proxy" && days > 0
    ? `proxy_${Math.floor(days)}`
    : days > 0
      ? `vps_${Math.floor(days)}`
      : "";
  if (canonicalKey && Number.isFinite(PAYMENT_PRICE_MAP_MINOR[canonicalKey])) {
    return PAYMENT_PRICE_MAP_MINOR[canonicalKey];
  }
  if (code && Number.isFinite(PAYMENT_PRICE_MAP_MINOR[code])) {
    return PAYMENT_PRICE_MAP_MINOR[code];
  }
  if (serviceType === "proxy") {
    const key = days > 0 ? `proxy_${Math.floor(days)}` : "proxy_30";
    if (Number.isFinite(PAYMENT_PRICE_MAP_MINOR[key])) return PAYMENT_PRICE_MAP_MINOR[key];
  }
  if (days > 0) {
    const key = `vps_${Math.floor(days)}`;
    if (Number.isFinite(PAYMENT_PRICE_MAP_MINOR[key])) return PAYMENT_PRICE_MAP_MINOR[key];
  }
  return Number(config.payment.telegramTestPriceMinor || 9900);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function safeParseDbJson(raw) {
  const src = String(raw || "").trim();
  if (!src) return {};
  try {
    const obj = JSON.parse(src);
    return obj && typeof obj === "object" ? obj : {};
  } catch {
    if (src[0] !== "{") return {};
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === "\"") inStr = false;
        continue;
      }
      if (ch === "\"") {
        inStr = true;
        continue;
      }
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          try {
            const obj = JSON.parse(src.slice(0, i + 1));
            return obj && typeof obj === "object" ? obj : {};
          } catch {
            return {};
          }
        }
      }
    }
    return {};
  }
}

async function readDataDbFile(filename) {
  const fp = path.join(process.cwd(), "data", filename);
  try {
    const raw = await fs.readFile(fp, "utf8");
    return safeParseDbJson(raw);
  } catch (e) {
    if (e && e.code === "ENOENT") return {};
    throw e;
  }
}

async function collectKnownTelegramIds() {
  const files = [
    "xui-links.json",
    "balance.json",
    "proxy-links.json",
    "referrals.json",
    "payment-webhook.json",
  ];
  const ids = new Set();
  for (const f of files) {
    const db = await readDataDbFile(f).catch(() => ({}));
    for (const k of Object.keys(db || {})) {
      const n = Number(k);
      if (Number.isFinite(n) && n > 0) ids.add(n);
    }
  }
  return [...ids].sort((a, b) => a - b);
}

async function readNotifyState() {
  const fp = path.join(process.cwd(), "data", "notify-expiring.json");
  try {
    const raw = await fs.readFile(fp, "utf8");
    return safeParseDbJson(raw);
  } catch (e) {
    if (e && e.code === "ENOENT") return {};
    throw e;
  }
}

async function writeNotifyState(obj) {
  const dir = path.join(process.cwd(), "data");
  await fs.mkdir(dir, { recursive: true });
  const fp = path.join(dir, "notify-expiring.json");
  const tmp = `${fp}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(obj || {}, null, 2), "utf8");
  await fs.rename(tmp, fp);
}

async function runNotifyExpiringJob({ daysLeftMax, daysLeftMin, text, dryRun }) {
  const now = Date.now();
  const ids = await collectKnownTelegramIds();
  const msgText = String(text || "").trim() ||
    "Напоминание: у вас скоро заканчивается подписка VL. Откройте мини‑приложение и продлите доступ заранее, чтобы не потерять связь.";
  const state = await readNotifyState().catch(() => ({}));
  const targets = [];
  for (const tid of ids) {
    const me = await loadMe(tid).catch(() => null);
    const exp = me?.subscriptionStatus?.expireAt;
    const status = String(me?.subscriptionStatus?.panelStatus || "").toUpperCase();
    if (!exp || status !== "ACTIVE") continue;
    const expMs = Date.parse(String(exp));
    if (!Number.isFinite(expMs) || expMs <= 0) continue;
    const daysLeft = Math.floor((expMs - now) / 86400_000);
    if (daysLeft < daysLeftMin || daysLeft > daysLeftMax) continue;

    // de-dup: one message per user per expiry timestamp
    const key = String(tid);
    const prev = state[key];
    if (prev?.expireAt === exp && Number(prev?.sentAtMs || 0) > 0) continue;
    targets.push({ telegramId: tid, daysLeft, expireAt: exp });
  }

  let sent = 0;
  let failed = 0;
  if (!dryRun) {
    for (const t of targets) {
      try {
        await bot.api.sendMessage(
          t.telegramId,
          `${msgText}\n\nОсталось дней: ${t.daysLeft}`,
        );
        sent += 1;
        state[String(t.telegramId)] = { expireAt: t.expireAt, sentAtMs: Date.now() };
      } catch {
        failed += 1;
      }
      await sleep(80);
    }
    await writeNotifyState(state).catch(() => null);
  }
  return { candidates: ids.length, matched: targets.length, sent, failed };
}

function checkTcpReachable(host, port, timeoutMs = 3500) {
  return new Promise((resolve) => {
    const p = Number(port);
    if (!host || !Number.isFinite(p) || p <= 0) return resolve(false);
    const socket = new net.Socket();
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      try {
        socket.destroy();
      } catch {
        // ignore
      }
      resolve(Boolean(ok));
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(p, String(host));
  });
}

/** Не даём упасть всему процессу из‑за сети до api.telegram.org (502 у nginx). */
async function setupTelegramTransport() {
  if (String(process.env.TELEGRAM_SKIP_WEBHOOK_SETUP || "").trim() === "1") {
    console.warn("TELEGRAM_SKIP_WEBHOOK_SETUP=1 — пропускаем setWebhook/deleteWebhook (бот не получит апдейты, пока не настроите вручную).");
    return;
  }

  const retries = Math.max(1, Number(process.env.TELEGRAM_WEBHOOK_RETRIES || 12));
  const baseDelayMs = Math.max(500, Number(process.env.TELEGRAM_WEBHOOK_RETRY_MS || 5000));

  const base = config.publicBaseUrl?.replace(/\/$/, "");
  if (base) {
    const url = `${base}${whPath}`;
    const extra = config.webhookSecret ? { secret_token: config.webhookSecret } : {};
    let lastErr;
    for (let i = 0; i < retries; i++) {
      try {
        await bot.api.setWebhook(url, extra);
        console.log("Telegram webhook ->", url);
        return;
      } catch (e) {
        lastErr = e;
        const msg = e?.message || String(e);
        console.warn(
          `[telegram] setWebhook failed (${i + 1}/${retries}): ${msg}`,
        );
        if (i < retries - 1) {
          await sleep(baseDelayMs * Math.min(4, 1 + Math.floor(i / 3)));
        }
      }
    }
    console.error(
      "[telegram] setWebhook не удался после всех попыток. HTTP-сервер работает (мини‑апп), но апдейты бота не придут, пока сервер не сможет достучаться до https://api.telegram.org",
    );
    console.error(
      "[telegram] Частые причины: блокировка Telegram с хоста, фаервол, нет исходящего HTTPS. Решения: другой регион/VPS, прокси для Node, или временно TELEGRAM_SKIP_WEBHOOK_SETUP=1",
    );
    if (lastErr) console.error(lastErr);

    const intervalMs = Math.max(60_000, Number(process.env.TELEGRAM_WEBHOOK_RETRY_INTERVAL_MS || 300_000));
    setInterval(async () => {
      try {
        await bot.api.setWebhook(url, extra);
        console.log("[telegram] setWebhook (повтор) ok ->", url);
      } catch (e) {
        console.warn("[telegram] setWebhook (фон):", e?.message || e);
      }
    }, intervalMs).unref?.();
    return;
  }

  console.log("PUBLIC_BASE_URL not set, using long polling");
  try {
    await bot.api.deleteWebhook({ drop_pending_updates: true });
    bot.start();
  } catch (e) {
    console.error(
      "[telegram] long polling setup failed:",
      e?.message || e,
    );
  }
}

const app = express();
app.disable("x-powered-by");

// Correlation id for logs/diagnostics
app.use((req, res, next) => {
  const incoming = String(req.headers["x-request-id"] || "").trim();
  const id = incoming && incoming.length < 128 ? incoming : crypto.randomUUID();
  req.requestId = id;
  res.setHeader("x-request-id", id);
  next();
});

app.use(express.json({ limit: "1mb", strict: true, type: ["application/json", "application/*+json"] }));

app.use(
  helmet({
    // Mini-app is embedded in Telegram; avoid breaking it with a strict CSP here.
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }),
);

app.use(
  rateLimit({
    windowMs: 60 * 1000,
    limit: Number(process.env.RATE_LIMIT_RPM || 240),
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "rate_limited" },
  }),
);

if (config.corsOrigin) {
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", config.corsOrigin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });
}

function authMiddleware(req, res, next) {
  const h = req.headers.authorization;
  const m = h && /^Bearer (.+)$/.exec(h);
  if (!m) return res.status(401).json({ error: "unauthorized" });
  try {
    req.tgSession = verifySession(m[1]);
    next();
  } catch {
    return res.status(401).json({ error: "bad_token" });
  }
}

function adminGrantAuth(req, res, next) {
  if (!config.adminGrantSecret) {
    return res.status(503).json({ error: "admin_grant_disabled" });
  }
  const sec = String(req.headers["x-admin-secret"] || "").trim();
  if (!sec || sec !== config.adminGrantSecret) {
    return res.status(403).json({ error: "forbidden" });
  }
  next();
}

app.get("/health", (_req, res) => res.json({ ok: true }));

// Warn for common misconfigurations (helps prod ops)
if (config.xui.extraBaseUrls?.length && !config.xuiSecondary.enabled) {
  console.warn(
    "[env] XUI_EXTRA_BASE_URLS is set, but XUI_SECONDARY_ENABLED is not enabled. " +
      "Merge will call extra /sub/<id>, but NL usually returns 400 unless the same subId exists there.",
  );
}

function isProbablyBase64(s) {
  const t = String(s || "").trim();
  if (!t || t.length < 16) return false;
  if (t.includes("://") || t.includes("\n")) return false;
  return /^[A-Za-z0-9+/=_-]+$/.test(t);
}

function decodeSubscriptionToLines(body) {
  const raw = String(body || "").trim();
  if (!raw) return [];
  let text = raw;
  if (isProbablyBase64(raw)) {
    try {
      text = Buffer.from(raw, "base64").toString("utf8");
    } catch {
      text = raw;
    }
  }
  return text
    .split(/\r?\n/g)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

async function fetchText(url, opts = {}) {
  const { insecureTls = false } = opts;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 10_000);
  try {
    const dispatcher = insecureTls
      ? new Agent({ connect: { rejectUnauthorized: false } })
      : undefined;
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      ...(dispatcher ? { dispatcher } : {}),
    });
    if (!res.ok) {
      const tt = await res.text().catch(() => "");
      throw new Error(`fetch failed: ${res.status} ${tt}`.trim());
    }
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

function resolveXuiUrlFromLink(link) {
  if (!link) return null;
  if (link.kind === "url") return link.value;
  if (link.kind === "token") {
    if (!config.xui.baseUrl) return null;
    const root = String(config.xui.subPath || "/sub").trim() || "/sub";
    const root2 = root.startsWith("/") ? root : `/${root}`;
    const root3 = root2.replace(/\/+$/, "");
    return `${config.xui.baseUrl}${root3}/${link.value}`;
  }
  return null;
}

function resolveExtraXuiUrls(link) {
  const arr = Array.isArray(link?.extraLinks) ? link.extraLinks : [];
  const urls = [];
  let tokenForExtra = "";
  if (link?.kind === "token" && link?.value) {
    tokenForExtra = String(link.value).trim();
  } else if (link?.kind === "url" && link?.value) {
    const m = String(link.value).match(/\/sub\/([^/?#]+)/i);
    tokenForExtra = String(m?.[1] || "").trim();
  }
  if (tokenForExtra) {
    const root = String(config.xui.subPath || "/sub").trim() || "/sub";
    const root2 = root.startsWith("/") ? root : `/${root}`;
    const root3 = root2.replace(/\/+$/, "");
    for (const base of config.xui.extraBaseUrls || []) {
      urls.push(`${base}${root3}/${tokenForExtra}`);
    }
  }
  for (const it of arr) {
    const u = resolveXuiUrlFromLink(it);
    if (u) urls.push(u);
  }
  return [...new Set(urls)];
}

function extractSubIdFromStoredLink(link) {
  if (!link) return "";
  if (link.kind === "token" && link.value) return String(link.value).trim();
  if (link.kind === "url" && link.value) {
    const m = String(link.value).match(/\/sub\/([^/?#]+)/i);
    return String(m?.[1] || "").trim();
  }
  return "";
}

function parseXuiLinkInput(raw) {
  const text = String(raw || "").trim();
  if (!text) return [];
  return text
    .split(/[\n,;]+/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

function passThroughSubscriptionHeaders(upstreamHeaders, res) {
  const allow = new Set([
    "content-type",
    "content-disposition",
    "profile-title",
    "profile-update-interval",
    "profile-web-page-url",
    "support-url",
    "subscription-userinfo",
    "cache-control",
    "etag",
    "last-modified",
  ]);
  for (const [k, v] of upstreamHeaders.entries()) {
    const key = String(k || "").toLowerCase();
    if (!allow.has(key)) continue;
    if (v != null && v !== "") res.setHeader(k, v);
  }
}

async function fetchSubscriptionBody(url, { dispatcher, timeoutMs = 7000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || 7000));
  try {
    const upstream = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      ...(dispatcher ? { dispatcher } : {}),
    });
    const body = await upstream.text().catch(() => "");
    return { upstream, body };
  } finally {
    clearTimeout(timer);
  }
}

// Public 3X-UI subscription proxy by token (token is generated by the bot on link).
app.get("/sub/xui/:token", async (req, res) => {
  const token = String(req.params.token || "").trim();
  if (!token) return res.status(400).send("token_required");
  try {
    const link = await xuiStore.getXuiLinkByPublicToken(token);
    if (!link) return res.status(404).send("not_found");
    const targetUrl = resolveXuiUrlFromLink(link);
    const targets = [
      ...(targetUrl ? [targetUrl] : []),
      ...resolveExtraXuiUrls(link),
    ];
    if (!targets.length) return res.status(503).send("xui_base_url_required");
    const dispatcher = config.xui.insecureTls
      ? new Agent({ connect: { rejectUnauthorized: false } })
      : undefined;
    const mergedLines = [];
    const seen = new Set();
    let firstHeaders = null;
    let okCount = 0;
    let failCount = 0;
    let firstStatus = 500;
    let firstErrorText = "upstream_failed";

    for (const url of targets) {
      let upstream;
      let tt = "";
      try {
        const r = await fetchSubscriptionBody(url, { dispatcher, timeoutMs: 7000 });
        upstream = r.upstream;
        tt = r.body;
      } catch (e) {
        failCount += 1;
        if (okCount === 0) {
          firstStatus = 504;
          firstErrorText = "upstream_timeout";
        }
        console.warn("[xui-sub] upstream timeout/fail:", req.requestId, url, String(e?.message || e));
        continue;
      }
      if (!upstream.ok) {
        failCount += 1;
        if (okCount === 0) {
          firstStatus = upstream.status;
          firstErrorText = tt || "upstream_failed";
        }
        continue;
      }
      if (!firstHeaders) firstHeaders = upstream.headers;
      okCount += 1;
      for (const line of decodeSubscriptionToLines(tt)) {
        if (seen.has(line)) continue;
        seen.add(line);
        mergedLines.push(line);
      }
    }
    if (okCount < 1) {
      return res.status(firstStatus).send(firstErrorText);
    }
    if (firstHeaders) {
      passThroughSubscriptionHeaders(firstHeaders, res);
    }
    res.setHeader("x-sub-upstreams", `ok=${okCount};fail=${failCount};total=${targets.length}`);
    if (!res.getHeader("Content-Type")) {
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
    }
    return res.status(200).send(Buffer.from(mergedLines.join("\n"), "utf8").toString("base64"));
  } catch (e) {
    return res.status(500).send(String(e?.message || e));
  }
});

app.post("/api/auth/telegram", (req, res) => {
  const { initData } = req.body || {};
  const v = validateWebAppInitData(initData);
  if (!v.ok) return res.status(401).json({ error: v.error });
  const telegramId = v.user.id;
  const token = signSession({
    telegramId,
    username: v.user.username,
  });
  res.json({
    token,
    user: {
      id: telegramId,
      first_name: v.user.first_name,
      username: v.user.username,
    },
  });
});

async function loadMe(telegramId, username = null) {
  const base = String(config.publicBaseUrl || "").replace(/\/$/, "");
  let xuiLink = await xuiStore.getXuiLinkByTelegramId(telegramId);

  /** Единый блок для вкладки «Статус» (XUI или Remnawave). */
  let subscriptionStatus = null;
  const canQueryXui =
    Boolean(config.xui.panelBaseUrl && config.xui.username && config.xui.password) &&
    Number(config.xui.inboundId) > 0;

  if (canQueryXui) {
    try {
      const found = await xui.findClientInInbound({
        inboundId: config.xui.inboundId,
        telegramId,
      });
      if (found?.client) {
        const email =
          String(found.client.email || "").trim() ||
          xui.stableXuiEmailFromTelegramId(telegramId);
        // Если локальная привязка потерялась (redeploy/чистка data), но клиент в XUI живой —
        // восстановим ссылку автоматически, чтобы пользователь не "покупал заново".
        if (!xuiLink) {
          const recoveredSubId =
            String(found.client.subId || "").trim() ||
            String(
              await xui.getClientSubIdFromInbound({
                inboundId: config.xui.inboundId,
                telegramId,
                email,
              }),
            ).trim();
          if (recoveredSubId) {
            xuiLink = await xuiStore.linkXuiSubscription({
              telegramId,
              xuiUrlOrToken: recoveredSubId,
            });
          }
        }
        const trJson = await xui.getClientTrafficsByEmail(email);
        const t = trJson?.obj ?? trJson?.response ?? trJson;
        const up = Number(t?.up ?? 0);
        const down = Number(t?.down ?? 0);
        const client = found.client;
        const totalGb = Number(client.totalGB ?? client.totalGb ?? 0);
        const expMs = Number(client.expiryTime ?? 0);
        const limitIp = Number(client.limitIp ?? 0);
        subscriptionStatus = {
          source: "xui",
          username: email,
          panelStatus: client.enable === false ? "DISABLED" : "ACTIVE",
          expireAt: expMs > 0 ? new Date(expMs).toISOString() : null,
          usedTrafficBytes: up + down,
          trafficLimitBytes: totalGb > 0 ? Math.round(totalGb * 1024 * 1024 * 1024) : 0,
          ipLimit: Number.isFinite(limitIp) ? limitIp : null,
        };
      } else if (xuiPublicUrl) {
        subscriptionStatus = {
          source: "xui",
          username: xui.stableXuiEmailFromTelegramId(telegramId),
          panelStatus: "PENDING",
          expireAt: null,
          usedTrafficBytes: 0,
          trafficLimitBytes: 0,
          ipLimit: null,
        };
      }
    } catch {
      // не ломаем /api/me, если панель временно недоступна
    }
  }

  const xuiPublicUrl =
    base && xuiLink?.publicToken ? `${base}/sub/xui/${xuiLink.publicToken}` : null;
  const primary = xuiPublicUrl || null;
  const subscriptionPrimarySource = "xui";

  const xuiPayload = xuiLink
    ? { linked: true, subscriptionUrl: xuiPublicUrl }
    : { linked: false };

  const proxyServers = parseProxyServers(config.proxy.serversJson);
  const proxyRec = await proxyStore.getProxyByTelegramId(telegramId);
  const remaining = proxyStore.computeProxyRemaining(proxyRec);
  const proxyItems = Array.isArray(proxyRec?.items) ? proxyRec.items : [];
  const proxyAddons = proxyRec?.addons || { proxyEnabled: false, dedicatedIpEnabled: false };
  const proxyPayload = {
    remaining,
    total: Number(proxyRec?.credits?.total || 0),
    used: Number(proxyRec?.credits?.used || 0),
    creditExpiresAt: proxyRec?.creditExpiresAt || null,
    addons: {
      proxyEnabled: Boolean(proxyAddons?.proxyEnabled),
      dedicatedIpEnabled: Boolean(proxyAddons?.dedicatedIpEnabled),
    },
    dedicatedIp: proxyRec?.dedicatedIp || null,
    rotateIpRequestedAt: proxyRec?.rotateIpRequestedAt || null,
    items: proxyItems
      .map((it) => {
        const srv = proxyServers.find((s) => s.id === it.serverId) || null;
        if (!srv) return null;
        return {
          id: it.id,
          country: srv.country,
          serverId: srv.id,
          createdAt: it.createdAt || null,
          expiresAt: it.expiresAt || null,
          socks5: { host: srv.host, port: srv.socksPort, username: it.username, password: it.password },
          http: { host: srv.host, port: srv.httpPort, username: it.username, password: it.password },
        };
      })
      .filter(Boolean),
  };

  const catalog = { source: "builtin", products: [] };
  const supportUsername = String(config.support?.telegramUsername || "VL_VPNbot").trim().replace(/^@+/, "");
  const supportUrl = `https://t.me/${supportUsername}`;
  const subscriptionUi = { supportUrl };
  const referralStats = await referralStore.getInviterStats(telegramId).catch(() => ({
    invitedTotal: 0,
    rewardedTotal: 0,
    rewardMinorTotal: 0,
  }));

  let balancePayload = { enabled: false };
  if (config.balance.billingEnabled) {
    const shouldBillHourly =
      subscriptionStatus?.source === "xui" &&
      String(subscriptionStatus.panelStatus || "").toUpperCase() === "ACTIVE";
    const proxyItemsCount = Array.isArray(proxyPayload?.items) ? proxyPayload.items.length : 0;
    const addonProxyUnitMinor = Boolean(proxyAddons?.proxyEnabled)
      ? Number(config.balance.proxyHourlyMinor || 0)
      : 0;
    const addonProxy = Math.max(0, Math.floor(addonProxyUnitMinor || 0)) *
      Math.max(0, Math.floor(proxyItemsCount || 0));
    const addonIp = Boolean(proxyAddons?.dedicatedIpEnabled)
      ? Number(config.balance.dedicatedIpHourlyMinor || 0)
      : 0;
    const ipLimitNow = Number(subscriptionStatus?.ipLimit ?? 0);
    const extraDeviceSlots = Number.isFinite(ipLimitNow) && ipLimitNow > 2
      ? Math.floor(ipLimitNow - 2)
      : 0;
    const addonDeviceSlotUnitMinor = Math.max(
      0,
      Math.floor(Number(config.balance.deviceSlotHourlyMinor || 0)),
    );
    const addonDeviceSlots = addonDeviceSlotUnitMinor * Math.max(0, extraDeviceSlots);
    const totalRateMinor = Math.max(1, Math.floor(Number(config.balance.hourlyRateMinor || 1))) +
      Math.max(0, Math.floor(addonProxy || 0)) +
      Math.max(0, Math.floor(addonIp || 0)) +
      Math.max(0, Math.floor(addonDeviceSlots || 0));
    const snap = shouldBillHourly
      ? await balanceStore.applyHourlyDeduction(telegramId, totalRateMinor)
      : await balanceStore.getDisplaySnapshot(telegramId, totalRateMinor);
    const rec = await balanceStore.getRecord(telegramId);
    balancePayload = {
      enabled: true,
      billingActive: snap.billingActive,
      balanceMinor: snap.balanceMinor,
      balanceRub: snap.balanceMinor / 100,
      hourlyRateMinor: snap.hourlyRateMinor,
      hourlyRateRub: snap.hourlyRateMinor / 100,
      hourlyRatePartsMinor: {
        vps: Math.max(1, Math.floor(Number(config.balance.hourlyRateMinor || 1))),
        proxy: Math.max(0, Math.floor(addonProxy || 0)),
        proxyPerItem: Math.max(0, Math.floor(addonProxyUnitMinor || 0)),
        proxyItemsCount: Math.max(0, Math.floor(proxyItemsCount || 0)),
        deviceSlots: Math.max(0, Math.floor(addonDeviceSlots || 0)),
        deviceSlotPerItem: Math.max(0, Math.floor(addonDeviceSlotUnitMinor || 0)),
        deviceSlotsCount: Math.max(0, Math.floor(extraDeviceSlots || 0)),
        dedicatedIp: Math.max(0, Math.floor(addonIp || 0)),
      },
      freeMode: Boolean(snap?.freeMode || rec?.freeMode),
      minTopupRub: config.payment.telegramMinInvoiceAmountMajor,
    };
    if (
      shouldBillHourly &&
      snap.billingActive &&
      snap.depleted &&
      canQueryXui &&
      subscriptionStatus?.source === "xui"
    ) {
      await setXuiClientEnabled(telegramId, false).catch(() => {});
      subscriptionStatus = {
        ...subscriptionStatus,
        panelStatus: "DISABLED",
      };
    } else if (
      snap.billingActive &&
      snap.balanceMinor > 0 &&
      rec?.suspendedForBilling &&
      canQueryXui &&
      subscriptionStatus?.source === "xui"
    ) {
      await setXuiClientEnabled(telegramId, true).catch(() => {});
      await balanceStore.clearSuspendedForBilling(telegramId).catch(() => {});
      subscriptionStatus = {
        ...subscriptionStatus,
        panelStatus: "ACTIVE",
      };
    }
  }

  return {
    telegramId,
    remnawaveUser: null,
    subscriptionUrl: primary,
    subscriptionPrimarySource,
    xui: xuiPayload,
    subscriptionStatus,
    subscriptionUi,
    proxy: proxyPayload,
    proxyServers: proxyServers.map((s) => ({
      id: s.id,
      country: s.country,
      label: s.label || "",
      mtproto: s.mtprotoSecret && Number(s.mtprotoPort) > 0
        ? {
            host: s.host,
            port: Number(s.mtprotoPort),
            secret: s.mtprotoSecret,
          }
        : null,
    })),
    catalog,
    balance: balancePayload,
    referral: {
      enabled: Boolean(config.referral.enabled),
      bonusMinor: Number(config.referral.bonusMinor || 0),
      minQualifyingTopupMinor: Number(config.referral.minQualifyingTopupMinor || 0),
      invitedTotal: Number(referralStats.invitedTotal || 0),
      rewardedTotal: Number(referralStats.rewardedTotal || 0),
      rewardMinorTotal: Number(referralStats.rewardMinorTotal || 0),
      refStartParam: `ref_${telegramId}`,
      refLink: `https://t.me/${supportUsername}?start=ref_${telegramId}`,
    },
    payment: {
      checkoutUrlTemplate: config.payment.checkoutUrlTemplate || "",
      defaultProductCode: config.payment.defaultProductCode || "vps_30",
      mode: config.payment.mode,
      currency: config.payment.telegramCurrency || "RUB",
      telegramInvoiceEnabled: Boolean(config.payment.telegramProviderToken),
      prices: {
        ...PAYMENT_PRICE_MAP_MINOR,
        device_1: Math.max(1, Math.floor(Number(config.payment.deviceSlotMinor || 15000))),
      },
      testGrantEnabled: config.testGrantEnabled,
      allowTestTools: config.payment.mode === "test" && config.testGrantEnabled,
      yookassaEnabled: isYookassaEnabled(),
    },
  };
}

function calcNewDeviceLimit(currentLimit, addSlots) {
  const base = Number.isFinite(Number(currentLimit)) && Number(currentLimit) > 0
    ? Number(currentLimit)
    : 1;
  return Math.max(1, base + Number(addSlots || 0));
}

/** Имя узла в клиенте (часть после # в VLESS и строка в списке серверов). */
function buildXuiClientRemark(telegramId, username, branding) {
  const title = String(branding?.subscriptionTitle || "").trim();
  const tpl = String(config.xui.clientRemarkTemplate || "").trim();
  const u = username ? String(username).replace(/^@/, "") : "";
  const vars = {
    subscriptionTitle: title || "VL",
    telegramId: String(telegramId),
    username: u ? `@${u}` : "",
  };
  let out = tpl;
  if (out) {
    for (const [k, v] of Object.entries(vars)) {
      out = out.split(`{${k}}`).join(v);
    }
    // Если плейсхолдер оказался пустым (например {username}),
    // убираем висящие разделители в конце: "-", "|", "·", ":" и т.п.
    out = out
      .replace(/\s+/g, " ")
      .replace(/\s*[-|·•:]+\s*$/u, "")
      .trim();
  } else {
    out = title || "VL";
  }
  return out.slice(0, 120);
}

/** Обновляет поле remark клиента 3X-UI без внешних интеграций. */
async function syncXuiClientRemarkIfNeeded(telegramId, username) {
  if (!Number(config.xui.inboundId)) return;
  const want = buildXuiClientRemark(telegramId, username, null);
  const found = await xui
    .findClientInInbound({
      inboundId: config.xui.inboundId,
      telegramId,
    })
    .catch(() => null);
  if (!found?.client) return;
  const cur = String(found.client.remark ?? found.client.Remark ?? "").trim();
  const curEmail = String(found.client.email || "").trim();
  const wantEmail = xui.stableXuiEmailFromTelegramId(telegramId);
  const needsRemarkUpdate = Boolean(want) && cur !== want;
  const looksLegacyNumeric = /^\d{8,}$/.test(curEmail);
  const needsEmailSanitize =
    (curEmail.startsWith("tg_") || curEmail.startsWith("u_") || looksLegacyNumeric) &&
    curEmail !== wantEmail;
  if (!needsRemarkUpdate && !needsEmailSanitize) return;
  const clientId = String(found.client.id || found.client.ID || "").trim();
  if (!clientId) return;
  const patch = { ...found.client };
  if (needsRemarkUpdate) patch.remark = want;
  if (needsEmailSanitize) patch.email = wantEmail;
  await xui.updateClientInInbound({
    inboundId: config.xui.inboundId,
    clientId,
    client: patch,
  });
}

let secondaryCookie = null;
let secondaryCookieExpiresAt = 0;

function getSecondaryPanelRoot() {
  const base = String(config.xuiSecondary.panelBaseUrl || "").trim();
  const wp = String(config.xuiSecondary.webBasePath || "").trim();
  if (!base) return "";
  if (!wp) return base.replace(/\/+$/, "");
  let path = wp.startsWith("/") ? wp : `/${wp}`;
  path = path.replace(/\/+$/, "");
  try {
    const u = new URL(base.includes("://") ? base : `http://${base}`);
    return `${u.origin}${path}`;
  } catch {
    return `${base.replace(/\/+$/, "")}${path}`;
  }
}

function secondaryDispatcher() {
  return config.xuiSecondary.insecureTls
    ? new Agent({ connect: { rejectUnauthorized: false } })
    : undefined;
}

function encodeForm(obj) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(obj || {})) {
    sp.set(k, String(v ?? ""));
  }
  return sp.toString();
}

async function secondaryLogin() {
  const root = getSecondaryPanelRoot();
  if (!root || !config.xuiSecondary.username || !config.xuiSecondary.password) {
    throw new Error("xui_secondary_not_configured");
  }
  const dispatcher = secondaryDispatcher();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  let res;
  try {
    res = await fetch(`${root}/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: encodeForm({
        username: config.xuiSecondary.username,
        password: config.xuiSecondary.password,
      }),
      redirect: "manual",
      signal: controller.signal,
      ...(dispatcher ? { dispatcher } : {}),
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok && res.status !== 302) {
    const t = await res.text().catch(() => "");
    throw new Error(`xui_secondary_login_failed: ${res.status} ${t}`.trim());
  }
  const sc = res.headers.getSetCookie?.() || res.headers.get("set-cookie");
  const raw = Array.isArray(sc) ? sc : sc ? [sc] : [];
  const cookie = raw
    .map((h) => String(h || "").split(";")[0].trim())
    .filter((x) => x.includes("="))
    .join("; ");
  if (!cookie) throw new Error("xui_secondary_login_no_cookie");
  secondaryCookie = cookie;
  secondaryCookieExpiresAt = Date.now() + 25 * 60 * 1000;
  return cookie;
}

async function secondaryCookieValue() {
  if (secondaryCookie && Date.now() < secondaryCookieExpiresAt) return secondaryCookie;
  return await secondaryLogin();
}

async function secondaryFetch(path, { method = "GET", json } = {}) {
  const root = getSecondaryPanelRoot();
  const dispatcher = secondaryDispatcher();
  const cookie = await secondaryCookieValue();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  const headers = {
    Accept: "application/json",
    Cookie: cookie,
  };
  if (json !== undefined) headers["Content-Type"] = "application/json";
  try {
    let res = await fetch(`${root}${path.startsWith("/") ? path : `/${path}`}`, {
      method,
      headers,
      body: json !== undefined ? JSON.stringify(json) : undefined,
      signal: controller.signal,
      ...(dispatcher ? { dispatcher } : {}),
    });
    if (res.status === 401) {
      secondaryCookie = null;
      const cookie2 = await secondaryCookieValue();
      headers.Cookie = cookie2;
      res = await fetch(`${root}${path.startsWith("/") ? path : `/${path}`}`, {
        method,
        headers,
        body: json !== undefined ? JSON.stringify(json) : undefined,
        signal: controller.signal,
        ...(dispatcher ? { dispatcher } : {}),
      });
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeClientsFromInbound(inbound) {
  try {
    const st = JSON.parse(String(inbound?.settings || "{}"));
    return Array.isArray(st?.clients) ? st.clients : [];
  } catch {
    return [];
  }
}

async function ensureSecondaryXuiClient({
  telegramId,
  subId,
  baseRemark,
  expiryTimeMs = null,
}) {
  if (!config.xuiSecondary.enabled) return;
  if (!Number(config.xuiSecondary.inboundId)) return;
  const stableEmail = xui.stableXuiEmailFromTelegramId(telegramId);
  const prefix = String(config.xuiSecondary.remarkPrefix || "").trim();
  const cleanBase = String(baseRemark || "")
    .replace(/-\s*(tg_|u_)\S*$/i, "")
    .replace(/\bRU\b/gi, "NL")
    .trim();
  const remark = `${prefix}${cleanBase}`.trim().slice(0, 120);

  const listRes = await secondaryFetch("/panel/api/inbounds/list");
  if (!listRes.ok) {
    const t = await listRes.text().catch(() => "");
    throw new Error(`xui_secondary_list_inbounds: ${listRes.status} ${t}`.trim());
  }
  const list = await listRes.json().catch(() => ({}));
  const inb = list?.obj?.find?.((x) => Number(x?.id) === Number(config.xuiSecondary.inboundId)) || null;
  if (!inb) throw new Error("xui_secondary_inbound_not_found");
  const clients = normalizeClientsFromInbound(inb);
  const tid = String(telegramId);
  const found =
    clients.find((c) => String(c?.tgId || "") === tid) ||
    clients.find((c) => String(c?.email || "") === stableEmail) ||
    clients.find((c) => String(c?.email || "").startsWith(`tg_${tid}`)) ||
    clients.find((c) => String(c?.remark || "").includes(tid)) ||
    null;

  if (found) {
    const clientId = String(found.id || found.ID || "").trim();
    if (!clientId) throw new Error("xui_secondary_client_id_missing");
    const nextLimitIp = Math.max(2, Number(found.limitIp || 0) || 0);
    const patch = {
      ...found,
      enable: true,
      limitIp: nextLimitIp,
      email: stableEmail,
      tgId: tid,
      subId,
      remark,
      ...(Number.isFinite(Number(expiryTimeMs)) && Number(expiryTimeMs) > 0
        ? { expiryTime: Number(expiryTimeMs) }
        : {}),
    };
    const upd = await secondaryFetch(`/panel/api/inbounds/updateClient/${encodeURIComponent(clientId)}`, {
      method: "POST",
      json: {
        id: Number(config.xuiSecondary.inboundId),
        settings: JSON.stringify({ clients: [patch] }),
      },
    });
    if (!upd.ok) {
      const t = await upd.text().catch(() => "");
      throw new Error(`xui_secondary_update_client: ${upd.status} ${t}`.trim());
    }
    return;
  }

  const client = {
    id: crypto.randomUUID(),
    email: stableEmail,
    enable: true,
    limitIp: 2,
    totalGB: 0,
    expiryTime:
      Number.isFinite(Number(expiryTimeMs)) && Number(expiryTimeMs) > 0
        ? Number(expiryTimeMs)
        : 0,
    tgId: tid,
    subId,
    remark,
  };
  const add = await secondaryFetch("/panel/api/inbounds/addClient", {
    method: "POST",
    json: {
      id: Number(config.xuiSecondary.inboundId),
      settings: JSON.stringify({ clients: [client] }),
    },
  });
  if (!add.ok) {
    const t = await add.text().catch(() => "");
    throw new Error(`xui_secondary_add_client: ${add.status} ${t}`.trim());
  }
}

/**
 * Создаёт клиента в 3X-UI (если нет) и привязывает subId в боте.
 * @returns {"already_linked"|"reused"|"created"}
 */
async function xuiProvisionCore(telegramId, { force, username }) {
  const tid = Number(telegramId);
  if (!config.xui.panelBaseUrl || !config.xui.username || !config.xui.password) {
    throw new Error("xui_not_configured");
  }
  if (!config.xui.inboundId) {
    throw new Error("xui_inbound_id_required");
  }
  const runRemarkSync = () =>
    syncXuiClientRemarkIfNeeded(tid, username).catch((e) =>
      console.warn("[xui] remark sync:", e?.message || e),
    );

  const existing = await xuiStore.getXuiLinkByTelegramId(tid);
  const existingExtraValues = Array.isArray(existing?.extraLinks)
    ? existing.extraLinks.map((x) => x?.value).filter(Boolean)
    : [];
  const baseRemark = buildXuiClientRemark(tid, username, null);
  if (existing && !force) {
    // Even if already linked, keep NL in sync when secondary is enabled.
    const subId = extractSubIdFromStoredLink(existing);
    if (subId) {
      await ensureSecondaryXuiClient({
        telegramId: tid,
        subId,
        baseRemark,
      }).catch((e) => console.warn("[xui-secondary] ensure:", e?.message || e));
    }
    await runRemarkSync();
    return "already_linked";
  }

  const found = await xui
    .findClientInInbound({
      inboundId: config.xui.inboundId,
      telegramId: tid,
    })
    .catch(() => null);
  if (found?.client) {
    const currentLimitIp = Number(found.client.limitIp ?? 0);
    if (!Number.isFinite(currentLimitIp) || currentLimitIp < 2) {
      const clientId = String(found.client.id || found.client.ID || "").trim();
      if (clientId) {
        const patch = { ...found.client, limitIp: 2 };
        await xui.updateClientInInbound({
          inboundId: config.xui.inboundId,
          clientId,
          client: patch,
        }).catch((e) => console.warn("[xui] enforce min limitIp:", e?.message || e));
      }
    }
    const subFromClient = found.client.subId ? String(found.client.subId) : "";
    const effective =
      subFromClient ||
      (await xui.getClientSubIdFromInbound({
        inboundId: config.xui.inboundId,
        telegramId: tid,
        email: found.client.email,
      }));
    if (effective) {
      await xuiStore.linkXuiSubscription({
        telegramId: tid,
        xuiUrlOrToken: effective,
        extraXuiUrlOrTokens: existingExtraValues,
      });
      await ensureSecondaryXuiClient({
        telegramId: tid,
        subId: String(effective),
        baseRemark,
      }).catch((e) => console.warn("[xui-secondary] ensure:", e?.message || e));
      await runRemarkSync();
      return "reused";
    }
  }

  const remark = baseRemark;

  const created = await xui.addClientToInbound({
    inboundId: config.xui.inboundId,
    telegramId: tid,
    limitIp: 2,
    remark,
  });

  await xuiStore.linkXuiSubscription({
    telegramId: tid,
    xuiUrlOrToken: created.creds.subIdEffective || created.creds.subId,
    extraXuiUrlOrTokens: existingExtraValues,
  });
  await ensureSecondaryXuiClient({
    telegramId: tid,
    subId: String(created.creds.subIdEffective || created.creds.subId),
    baseRemark,
  }).catch((e) => console.warn("[xui-secondary] ensure:", e?.message || e));
  await runRemarkSync();
  return "created";
}

async function setXuiClientEnabled(telegramId, enabled) {
  if (!config.xui.panelBaseUrl || !config.xui.username || !config.xui.password) return;
  if (!config.xui.inboundId) return;
  const tid = Number(telegramId);
  const found = await xui.findClientInInbound({
    inboundId: config.xui.inboundId,
    telegramId: tid,
  });
  if (!found?.client) return;
  const clientId = String(found.client.id || found.client.ID || "").trim();
  if (!clientId) return;
  const patch = { ...found.client, enable: Boolean(enabled) };
  await xui.updateClientInInbound({
    inboundId: config.xui.inboundId,
    clientId,
    client: patch,
  });
}

async function extendXuiClientDays({ telegramId, days, username = null }) {
  const tid = Number(telegramId);
  const addDays = Math.floor(Number(days || 0));
  if (!Number.isFinite(tid) || tid < 1) throw new Error("bad_telegram_id");
  if (!Number.isFinite(addDays) || addDays < 1) throw new Error("bad_days");
  if (!config.xui.inboundId) throw new Error("xui_inbound_id_required");

  await xuiProvisionCore(tid, { force: true, username });
  const found = await xui.findClientInInbound({
    inboundId: config.xui.inboundId,
    telegramId: tid,
  });
  if (!found?.client) throw new Error("xui_client_not_found");
  const clientId = String(found.client.id || found.client.ID || "").trim();
  if (!clientId) throw new Error("xui_client_id_missing");

  const now = Date.now();
  const curExpiryMs = Number(found.client.expiryTime || 0);
  const baseMs = Number.isFinite(curExpiryMs) && curExpiryMs > now ? curExpiryMs : now;
  const nextExpiryMs = baseMs + addDays * 86400_000;
  const patch = { ...found.client, enable: true, expiryTime: nextExpiryMs };
  await xui.updateClientInInbound({
    inboundId: config.xui.inboundId,
    clientId,
    client: patch,
  });
  const linked = await xuiStore.getXuiLinkByTelegramId(tid).catch(() => null);
  const subId = extractSubIdFromStoredLink(linked) || String(found.client.subId || "").trim();
  const baseRemark = buildXuiClientRemark(tid, username, null);
  if (subId) {
    await ensureSecondaryXuiClient({
      telegramId: tid,
      subId,
      baseRemark,
      expiryTimeMs: nextExpiryMs,
    }).catch((e) => console.warn("[xui-secondary] extend sync:", e?.message || e));
  }
  return {
    previousExpiryMs: Number.isFinite(curExpiryMs) ? curExpiryMs : 0,
    nextExpiryMs,
  };
}

async function syncSecondaryExpiryFromPrimary({ telegramId, username = null }) {
  const tid = Number(telegramId);
  if (!Number.isFinite(tid) || tid < 1) throw new Error("bad_telegram_id");
  if (!config.xui.inboundId) throw new Error("xui_inbound_id_required");

  await xuiProvisionCore(tid, { force: true, username });
  const found = await xui.findClientInInbound({
    inboundId: config.xui.inboundId,
    telegramId: tid,
  });
  if (!found?.client) throw new Error("xui_client_not_found");
  const primaryExpiryMs = Number(found.client.expiryTime || 0);
  const linked = await xuiStore.getXuiLinkByTelegramId(tid).catch(() => null);
  const subId = extractSubIdFromStoredLink(linked) || String(found.client.subId || "").trim();
  if (!subId) throw new Error("xui_subid_missing");
  const baseRemark = buildXuiClientRemark(tid, username, null);
  await ensureSecondaryXuiClient({
    telegramId: tid,
    subId,
    baseRemark,
    expiryTimeMs: Number.isFinite(primaryExpiryMs) ? primaryExpiryMs : 0,
  });
  return {
    primaryExpireAt: primaryExpiryMs > 0 ? new Date(primaryExpiryMs).toISOString() : null,
  };
}

function parseTelegramPaymentPayload(raw) {
  const shortKey = String(raw || "").trim();
  if (shortKey.startsWith("p:")) {
    const saved = paymentPayloadStore.get(shortKey);
    if (!saved || typeof saved !== "object") return null;
    if (saved.kind === "balance_topup") {
      const telegramId = Number(saved.telegramId);
      if (!Number.isFinite(telegramId) || telegramId < 1) return null;
      return {
        kind: "balance_topup",
        telegramId,
        username: saved.username != null ? String(saved.username) : null,
      };
    }
    const telegramId = Number(saved.telegramId);
    const days = Number(saved.days);
    const productCode = String(saved.productCode || "").trim() || config.payment.telegramTestProductCode;
    const serviceType = String(saved.serviceType || "vps").trim().toLowerCase();
    const serverId = String(saved.serverId || "").trim();
    const proxyCredits = Number(saved.proxyCredits || 0);
    const addDeviceSlots = Number(saved.addDeviceSlots || 0);
    if (!Number.isFinite(telegramId) || telegramId < 1) return null;
    if (
      serviceType !== "device_slot" &&
      (!Number.isFinite(days) || days < 1)
    ) return null;
    return {
      kind: "plan",
      telegramId,
      days: Number.isFinite(days) && days > 0 ? Math.floor(days) : 0,
      productCode,
      serviceType: serviceType === "proxy" ? "proxy" : serviceType === "device_slot" ? "device_slot" : "vps",
      serverId: serverId || null,
      proxyCredits: Number.isFinite(proxyCredits) && proxyCredits > 0 ? Math.floor(proxyCredits) : 0,
      addDeviceSlots: Number.isFinite(addDeviceSlots) && addDeviceSlots > 0
        ? Math.floor(addDeviceSlots)
        : 0,
    };
  }
  try {
    const obj = JSON.parse(String(raw || ""));
    if (!obj || typeof obj !== "object") return null;
    const telegramId = Number(obj.telegramId);
    if (!Number.isFinite(telegramId) || telegramId < 1) return null;
    if (obj.kind === "balance_topup") {
      return {
        kind: "balance_topup",
        telegramId,
        username: obj.username != null ? String(obj.username) : null,
      };
    }
    const days = Number(obj.days);
    const productCode = String(obj.productCode || "").trim() || config.payment.telegramTestProductCode;
    const serviceType = String(obj.serviceType || "vps").trim().toLowerCase();
    const serverId = String(obj.serverId || "").trim();
    const proxyCredits = Number(obj.proxyCredits || 0);
    const addDeviceSlots = Number(obj.addDeviceSlots || 0);
    if (
      serviceType !== "device_slot" &&
      (!Number.isFinite(days) || days < 1)
    ) return null;
    return {
      kind: "plan",
      telegramId,
      days: Number.isFinite(days) && days > 0 ? Math.floor(days) : 0,
      productCode,
      serviceType: serviceType === "proxy" ? "proxy" : serviceType === "device_slot" ? "device_slot" : "vps",
      serverId: serverId || null,
      proxyCredits: Number.isFinite(proxyCredits) && proxyCredits > 0 ? Math.floor(proxyCredits) : 0,
      addDeviceSlots: Number.isFinite(addDeviceSlots) && addDeviceSlots > 0
        ? Math.floor(addDeviceSlots)
        : 0,
    };
  } catch {
    return null;
  }
}

const processedPayments = new Set();
const paymentPayloadStore = new Map();

function makePaymentDedupKey(sp) {
  return String(
    sp?.provider_payment_charge_id ||
      sp?.telegram_payment_charge_id ||
      "",
  ).trim();
}

function savePaymentPayload(data) {
  const id = `p:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  paymentPayloadStore.set(id, data);
  setTimeout(() => {
    paymentPayloadStore.delete(id);
  }, 24 * 60 * 60 * 1000).unref?.();
  return id;
}

app.get("/api/me", authMiddleware, async (req, res) => {
  try {
    const tid = Number(req.tgSession.sub || req.tgSession.tg);
    const data = await loadMe(tid, req.tgSession?.u ?? null);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/subscription", authMiddleware, async (req, res) => {
  try {
    const tid = Number(req.tgSession.sub || req.tgSession.tg);
    const data = await loadMe(tid, req.tgSession?.u ?? null);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Link 3X-UI subscription to this Telegram user.
// Body: { subscriptionUrlOrToken: "https://.../sub/xxxx" } OR { subscriptionUrlOrToken: "xxxx" }
app.post("/api/link-xui", authMiddleware, async (req, res) => {
  const raw = String(req.body?.subscriptionUrlOrToken || "").trim();
  const parsed = parseXuiLinkInput(raw);
  if (!parsed.length) return res.status(400).json({ error: "subscriptionUrlOrToken_required" });
  try {
    const tid = Number(req.tgSession.sub || req.tgSession.tg);
    await xuiStore.linkXuiSubscription({
      telegramId: tid,
      xuiUrlOrToken: parsed[0],
      extraXuiUrlOrTokens: parsed.slice(1),
    });
    const data = await loadMe(tid);
    return res.json({ ok: true, ...data });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.post("/api/unlink-xui", authMiddleware, async (req, res) => {
  try {
    const tid = Number(req.tgSession.sub || req.tgSession.tg);
    await xuiStore.unlinkXuiSubscription({ telegramId: tid });
    const data = await loadMe(tid);
    return res.json({ ok: true, ...data });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// Auto-provision 3X-UI client for current Telegram user and link subscription.
app.post("/api/xui/provision", authMiddleware, async (req, res) => {
  try {
    const tid = Number(req.tgSession.sub || req.tgSession.tg);
    const force = Boolean(req.body?.force);
    const username = req.tgSession?.u ?? null;
    const r = await xuiProvisionCore(tid, { force, username });
    const data = await loadMe(tid);
    if (r === "already_linked") {
      return res.json({ ok: true, alreadyLinked: true, ...data });
    }
    return res.json({
      ok: true,
      reused: r === "reused",
      created: r === "created",
      ...data,
    });
  } catch (e) {
    const msg = String(e?.message || e);
    if (msg === "xui_not_configured" || msg === "xui_inbound_id_required") {
      return res.status(503).json({ error: msg });
    }
    return res.status(500).json({ error: msg });
  }
});

app.post("/api/xui/add-device-slot", authMiddleware, async (req, res) => {
  try {
    const tid = Number(req.tgSession.sub || req.tgSession.tg);
    const slots = Number(req.body?.slots || 1);
    if (!Number.isFinite(slots) || slots < 1) return res.status(400).json({ error: "bad_slots" });
    if (!config.xui.inboundId) return res.status(503).json({ error: "xui_inbound_id_required" });
    const bal = await balanceStore.getRecord(tid);
    const canEnableWithoutTopup = Boolean(bal?.freeMode);
    if (!canEnableWithoutTopup && !bal?.billingStartedAt) {
      return res.status(412).json({ error: "balance_not_started" });
    }
    await xuiProvisionCore(tid, { force: true, username: req.tgSession?.u ?? null });
    const r = await xui.incrementClientLimitIp({
      inboundId: config.xui.inboundId,
      telegramId: tid,
      addSlots: Math.floor(slots),
      minFloor: 2,
    });
    const data = await loadMe(tid, req.tgSession?.u ?? null);
    return res.json({ ok: true, addedSlots: Math.floor(slots), xuiLimitIp: r.next, ...data });
  } catch (e) {
    const msg = String(e?.message || e);
    if (msg === "xui_client_not_found") return res.status(404).json({ error: msg });
    if (msg === "bad_slots") return res.status(400).json({ error: msg });
    return res.status(500).json({ error: msg });
  }
});

// Create per-user proxy account on selected proxy server.
app.post("/api/proxy/provision", authMiddleware, async (req, res) => {
  try {
    const tid = Number(req.tgSession.sub || req.tgSession.tg);
    const servers = parseProxyServers(config.proxy.serversJson);
    const serverId = String(req.body?.serverId || "").trim();
    const server = servers.find((s) => s.id === serverId) || null;
    if (!server) return res.status(400).json({ error: "bad_serverId" });

    const rec = await proxyStore.getProxyByTelegramId(tid);
    const remaining = proxyStore.computeProxyRemaining(rec);
    const addons = rec?.addons || {};
    const hasAddon = Boolean(addons?.proxyEnabled);
    if (!hasAddon && remaining < 1) {
      return res.status(402).json({ error: "proxy_not_enabled" });
    }

    const creds = generateProxyCredentials(tid);
    await ensureProxyUserOnServer({ server, username: creds.username, password: creds.password });
    await proxyStore.addProxyItem({
      telegramId: tid,
      item: {
        id: `p_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        serverId,
        username: creds.username,
        password: creds.password,
        createdAt: new Date().toISOString(),
        expiresAt: rec?.creditExpiresAt || null,
      },
    });
    const data = await loadMe(tid);
    return res.json({ ok: true, created: true, ...data });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post("/api/proxy/delete", authMiddleware, async (req, res) => {
  const tid = Number(req.tgSession.sub || req.tgSession.tg);
  try {
    const itemId = String(req.body?.itemId || "").trim();
    const itemIndex = Number(req.body?.itemIndex);
    const current = await proxyStore.getProxyByTelegramId(tid);
    const currentItems = Array.isArray(current?.items) ? current.items : [];
    let target = null;
    if (itemId) {
      target = currentItems.find((x) => String(x?.id || "") === itemId) || null;
    } else if (Number.isFinite(itemIndex) && itemIndex >= 0 && itemIndex < currentItems.length) {
      target = currentItems[itemIndex] || null;
    }
    if (!target) return res.status(404).json({ error: "proxy_item_not_found" });

    let removedFromServer = false;
    try {
      const servers = parseProxyServers(config.proxy.serversJson);
      const srv = servers.find((s) => s.id === String(target.serverId || "").trim()) || null;
      if (srv && target.username) {
        await removeProxyUserOnServer({ server: srv, username: target.username });
        removedFromServer = true;
      }
    } catch (e) {
      console.warn("[proxy] remove on server failed:", e?.message || e);
    }

    await proxyStore.removeProxyItem({
      telegramId: tid,
      itemId: itemId || undefined,
      itemIndex: Number.isFinite(itemIndex) ? itemIndex : undefined,
    });
    const data = await loadMe(tid, req.tgSession?.u ?? null);
    return res.json({ ok: true, removedFromServer, ...data });
  } catch (e) {
    const msg = String(e?.message || e);
    if (msg === "proxy_item_not_found") return res.status(404).json({ error: msg });
    return res.status(500).json({ error: msg });
  }
});

app.post("/api/proxy/delete-all", authMiddleware, async (req, res) => {
  const tid = Number(req.tgSession.sub || req.tgSession.tg);
  try {
    const current = await proxyStore.getProxyByTelegramId(tid);
    const currentItems = Array.isArray(current?.items) ? current.items : [];
    if (!currentItems.length) {
      const data = await loadMe(tid, req.tgSession?.u ?? null);
      return res.json({ ok: true, removed: 0, removedFromServer: 0, ...data });
    }

    const servers = parseProxyServers(config.proxy.serversJson);
    let removedFromServer = 0;
    for (const item of currentItems) {
      try {
        const srv = servers.find((s) => s.id === String(item?.serverId || "").trim()) || null;
        if (!srv || !item?.username) continue;
        await removeProxyUserOnServer({ server: srv, username: item.username });
        removedFromServer += 1;
      } catch (e) {
        console.warn("[proxy] bulk remove on server failed:", e?.message || e);
      }
    }

    const next = {
      ...(current || { telegramId: String(tid), credits: { total: 0, used: 0 }, items: [] }),
      items: [],
      credits: {
        total: Number(current?.credits?.total || 0),
        used: 0,
      },
    };
    await proxyStore.setProxyForTelegramId(tid, next);
    const data = await loadMe(tid, req.tgSession?.u ?? null);
    return res.json({ ok: true, removed: currentItems.length, removedFromServer, ...data });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post("/api/proxy/repair", authMiddleware, async (req, res) => {
  const tid = Number(req.tgSession.sub || req.tgSession.tg);
  try {
    const current = await proxyStore.getProxyByTelegramId(tid);
    const items = Array.isArray(current?.items) ? current.items : [];
    if (!items.length) {
      const data = await loadMe(tid, req.tgSession?.u ?? null);
      return res.json({ ok: true, repaired: 0, failed: 0, ...data });
    }
    const servers = parseProxyServers(config.proxy.serversJson);
    let repaired = 0;
    let failed = 0;
    for (const item of items) {
      try {
        const srv = servers.find((s) => s.id === String(item?.serverId || "").trim()) || null;
        if (!srv) {
          failed += 1;
          continue;
        }
        await ensureProxyUserOnServer({
          server: srv,
          username: String(item?.username || ""),
          password: String(item?.password || ""),
        });
        repaired += 1;
      } catch (e) {
        failed += 1;
        console.warn("[proxy] repair failed:", e?.message || e);
      }
    }
    const mtServer = servers.find((s) => s?.mtprotoSecret && Number(s?.mtprotoPort) > 0) || null;
    const mtproto = mtServer
      ? {
          configured: true,
          host: String(mtServer.host || ""),
          port: Number(mtServer.mtprotoPort),
          reachable: await checkTcpReachable(mtServer.host, mtServer.mtprotoPort),
        }
      : { configured: false, reachable: false };
    const data = await loadMe(tid, req.tgSession?.u ?? null);
    return res.json({ ok: true, repaired, failed, mtproto, ...data });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

// Proxy as an hourly addon (shared / dedicated IPv4).
app.post("/api/proxy/addons", authMiddleware, async (req, res) => {
  const tid = Number(req.tgSession.sub || req.tgSession.tg);
  const proxyEnabled = req.body?.proxyEnabled;
  const dedicatedIpEnabled = req.body?.dedicatedIpEnabled;
  if (proxyEnabled === undefined && dedicatedIpEnabled === undefined) {
    return res.status(400).json({ error: "nothing_to_change" });
  }
  if (dedicatedIpEnabled === true && proxyEnabled === false) {
    return res.status(400).json({ error: "dedicated_requires_proxy" });
  }
  try {
    const bal = await balanceStore.getRecord(tid);
    const canEnableWithoutTopup = Boolean(bal?.freeMode);
    if (!canEnableWithoutTopup && (proxyEnabled === true || dedicatedIpEnabled === true) && !bal?.billingStartedAt) {
      return res.status(412).json({ error: "balance_not_started" });
    }
    await proxyStore.setProxyAddons({ telegramId: tid, proxyEnabled, dedicatedIpEnabled });
    const data = await loadMe(tid, req.tgSession?.u ?? null);
    return res.json({ ok: true, ...data });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post("/api/proxy/acquire-shared", authMiddleware, async (req, res) => {
  const tid = Number(req.tgSession.sub || req.tgSession.tg);
  try {
    const bal = await balanceStore.getRecord(tid);
    const canEnableWithoutTopup = Boolean(bal?.freeMode);
    if (!canEnableWithoutTopup && !bal?.billingStartedAt) {
      return res.status(412).json({ error: "balance_not_started" });
    }
    await proxyStore.setProxyAddons({ telegramId: tid, proxyEnabled: true });
    const data = await loadMe(tid, req.tgSession?.u ?? null);
    return res.json({ ok: true, acquired: "shared", ...data });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post("/api/proxy/acquire-dedicated", authMiddleware, async (req, res) => {
  const tid = Number(req.tgSession.sub || req.tgSession.tg);
  try {
    const bal = await balanceStore.getRecord(tid);
    const canEnableWithoutTopup = Boolean(bal?.freeMode);
    if (!canEnableWithoutTopup && !bal?.billingStartedAt) {
      return res.status(412).json({ error: "balance_not_started" });
    }
    const requestedServerId = String(req.body?.serverId || "").trim();
    if (!requestedServerId) return res.status(400).json({ error: "server_not_selected" });
    const servers = parseProxyServers(config.proxy.serversJson);
    const srv = servers.find((s) => s.id === requestedServerId) || null;
    if (!srv) return res.status(400).json({ error: "bad_serverId" });
    const twServerId = String(srv.timewebServerId || "").trim();
    await proxyStore.setProxyAddons({ telegramId: tid, proxyEnabled: true, dedicatedIpEnabled: true });
    const rec = await proxyStore.getProxyByTelegramId(tid);
    if (config.timeweb.apiToken) {
      if (!twServerId) return res.status(503).json({ error: "timeweb_server_id_required" });
      if (rec?.dedicatedIp?.ipv4Id) {
        await timewebApi
          .deleteServerIP(twServerId, rec.dedicatedIp.ipv4Id)
          .catch((e) => console.warn("[timeweb] delete old ip (acquire):", e?.message || e));
      }
      let ipInfo;
      try {
        ipInfo = await timewebApi.addServerIPv4(twServerId);
      } catch (e) {
        if (e instanceof timewebApi.TimewebApiError && e.message === "timeweb_no_balance_for_month") {
          return res.status(402).json({
            error: "timeweb_no_balance_for_month",
            requiredBalance: e.details?.required_balance ?? null,
            responseId: e.responseId || null,
          });
        }
        throw e;
      }
      if (!ipInfo?.ip) throw new Error("timeweb_ip_create_failed");
      await proxyStore.setProxyForTelegramId(tid, {
        ...(rec || { telegramId: String(tid), credits: { total: 0, used: 0 }, items: [] }),
        dedicatedIp: {
          serverId: srv.id,
          ip: String(ipInfo.ip),
          ipv4Id: ipInfo.id || null,
          source: "timeweb",
          updatedAt: new Date().toISOString(),
        },
        rotateIpRequestedAt: null,
      });
    }
    const data = await loadMe(tid, req.tgSession?.u ?? null);
    return res.json({ ok: true, acquired: "dedicated", ...data });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

// Rotate dedicated IP: if Timeweb configured, rotate immediately; otherwise create manual request.
app.post("/api/proxy/rotate-ip", authMiddleware, async (req, res) => {
  const tid = Number(req.tgSession.sub || req.tgSession.tg);
  try {
    const rec = await proxyStore.getProxyByTelegramId(tid);
    const addons = rec?.addons || {};
    if (!addons?.proxyEnabled) return res.status(403).json({ error: "proxy_not_enabled" });
    if (!addons?.dedicatedIpEnabled) return res.status(403).json({ error: "dedicated_ip_not_enabled" });
    const requestedServerId = String(req.body?.serverId || "").trim();
    const preferredServerId =
      requestedServerId ||
      String(rec?.dedicatedIp?.serverId || "").trim() ||
      String(rec?.items?.[0]?.serverId || "").trim();
    if (!preferredServerId) return res.status(400).json({ error: "server_not_selected" });
    const servers = parseProxyServers(config.proxy.serversJson);
    const srv = servers.find((s) => s.id === preferredServerId) || null;
    if (!srv) return res.status(400).json({ error: "bad_serverId" });
    const twServerId = String(srv.timewebServerId || "").trim();

    if (config.timeweb.apiToken) {
      if (!twServerId) return res.status(503).json({ error: "timeweb_server_id_required" });
      if (rec?.dedicatedIp?.ipv4Id) {
        await timewebApi
          .deleteServerIP(twServerId, rec.dedicatedIp.ipv4Id)
          .catch((e) => console.warn("[timeweb] delete old ip:", e?.message || e));
      }
      let ipInfo;
      try {
        ipInfo = await timewebApi.addServerIPv4(twServerId);
      } catch (e) {
        if (e instanceof timewebApi.TimewebApiError && e.message === "timeweb_no_balance_for_month") {
          return res.status(402).json({
            error: "timeweb_no_balance_for_month",
            requiredBalance: e.details?.required_balance ?? null,
            responseId: e.responseId || null,
          });
        }
        throw e;
      }
      if (!ipInfo?.ip) throw new Error("timeweb_ip_create_failed");
      await proxyStore.setProxyForTelegramId(tid, {
        ...(rec || { telegramId: String(tid), credits: { total: 0, used: 0 }, items: [] }),
        dedicatedIp: {
          serverId: srv.id,
          ip: String(ipInfo.ip),
          ipv4Id: ipInfo.id || null,
          source: "timeweb",
          updatedAt: new Date().toISOString(),
        },
        rotateIpRequestedAt: null,
      });
      const data = await loadMe(tid, req.tgSession?.u ?? null);
      return res.json({ ok: true, rotated: true, dedicatedIp: data?.proxy?.dedicatedIp || null, ...data });
    }

    const next = await proxyStore.setProxyForTelegramId(tid, {
      ...(rec || { telegramId: String(tid), credits: { total: 0, used: 0 }, items: [] }),
      rotateIpRequestedAt: new Date().toISOString(),
      dedicatedIp: rec?.dedicatedIp
        ? {
            ...rec.dedicatedIp,
            serverId: preferredServerId,
          }
        : rec?.dedicatedIp || null,
    });
    const data = await loadMe(tid, req.tgSession?.u ?? null);
    return res.json({ ok: true, requestedAt: next.rotateIpRequestedAt, ...data });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

// Test/admin: grant proxy quota
app.post("/api/test/proxy/grant", authMiddleware, async (req, res) => {
  if (!(config.payment.mode === "test" && config.testGrantEnabled)) {
    return res.status(403).json({ error: "test_grant_disabled" });
  }
  const count = Number(req.body?.count || 1);
  const days = Number(req.body?.days || 30);
  if (!Number.isFinite(count) || count < 1) return res.status(400).json({ error: "bad_count" });
  if (!Number.isFinite(days) || days < 0) return res.status(400).json({ error: "bad_days" });
  try {
    const tid = Number(req.tgSession.sub || req.tgSession.tg);
    await proxyStore.grantProxyCredits({ telegramId: tid, addCount: count, days });
    const data = await loadMe(tid);
    return res.json({ ok: true, ...data });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

/**
 * Webhook провайдера оплаты. Заголовок: x-webhook-secret = PAYMENT_WEBHOOK_SECRET.
 * Тело (JSON): telegramId (обяз.), extendDays или planDays, опционально addDeviceSlots,
 * amount, currency, externalPaymentId|paymentId, productCode, username.
 * Провайдер должен дергать этот URL после успешной оплаты; дальше — XUI provision.
 */
app.post("/api/webhooks/payment", async (req, res) => {
  if (!config.paymentWebhookSecret) {
    return res.status(503).json({ error: "webhook_disabled" });
  }
  const sec = req.headers["x-webhook-secret"];
  if (sec !== config.paymentWebhookSecret) {
    return res.status(403).json({ error: "forbidden" });
  }
  const {
    telegramId,
    extendDays,
    planDays,
    addDeviceSlots,
    externalPaymentId,
    paymentId,
    productCode,
    username,
    amountMinor,
    amount,
  } = req.body || {};
  const idKey = String(externalPaymentId ?? paymentId ?? "").trim();
  const days = Number(extendDays || planDays || 0);
  const slots = Number(addDeviceSlots || 0);
  if (!telegramId || (!Number.isFinite(days) && !Number.isFinite(slots))) {
    return res.status(400).json({ error: "bad_body" });
  }
  if (days < 0 || slots < 0 || (days < 1 && slots < 1)) {
    return res.status(400).json({ error: "nothing_to_apply" });
  }
  try {
    const tid = Number(telegramId);
    if (idKey) {
      const processed = await paymentWebhookStore.wasProcessed(idKey);
      if (processed) {
        return res.json({ ok: true, duplicate: true });
      }
    } else {
      console.warn("[payment-webhook] missing paymentId/externalPaymentId; idempotency disabled for this call");
    }
    if (days < 1 && slots < 1) {
      return res.status(400).json({ error: "nothing_to_apply" });
    }
    await xuiProvisionCore(tid, { force: true, username: username ?? null });
    const paidMinor =
      Number.isFinite(Number(amountMinor)) && Number(amountMinor) > 0
        ? Math.floor(Number(amountMinor))
        : Number.isFinite(Number(amount)) && Number(amount) > 0
          ? Math.floor(Number(amount) * 100)
          : 0;
    const refAward = await maybeAwardReferralBonus({ inviteeTelegramId: tid, paidMinor });
    if (refAward?.inviterId) {
      await bot.api.sendMessage(
        Number(refAward.inviterId),
        `Реферал оплатил подписку. Начислено ${(refAward.bonusMinor / 100).toFixed(0)} ₽ бонуса.`,
      ).catch(() => null);
    }
    if (idKey) {
      await paymentWebhookStore.markProcessed(idKey, {
        telegramId: String(tid),
        productCode: String(productCode || ""),
      });
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/test/grant", authMiddleware, async (req, res) => {
  if (!(config.payment.mode === "test" && config.testGrantEnabled)) {
    return res.status(403).json({ error: "test_grant_disabled" });
  }
  const days = Number(req.body?.days || 30);
  if (!Number.isFinite(days) || days < 1) {
    return res.status(400).json({ error: "bad_days" });
  }
  try {
    const tid = Number(req.tgSession.sub || req.tgSession.tg);
    const username = req.tgSession?.u ?? null;
    await xuiProvisionCore(tid, { force: true, username });
    const data = await loadMe(tid);
    return res.json({ ok: true, ...data });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.post("/api/test/add-device-slot", authMiddleware, async (req, res) => {
  if (!(config.payment.mode === "test" && config.testGrantEnabled)) {
    return res.status(403).json({ error: "test_grant_disabled" });
  }
  const slots = Number(req.body?.slots || 1);
  if (!Number.isFinite(slots) || slots < 1) {
    return res.status(400).json({ error: "bad_slots" });
  }
  try {
    // Ensure client exists / link is present, then bump limitIp.
    const tid = Number(req.tgSession.sub || req.tgSession.tg);
    const username = req.tgSession?.u ?? null;
    await xuiProvisionCore(tid, { force: true, username });
    const r = await xui.incrementClientLimitIp({
      inboundId: config.xui.inboundId,
      telegramId: tid,
      addSlots: slots,
    });
    const data = await loadMe(tid);
    return res.json({ ok: true, addedSlots: slots, xuiLimitIp: r.next, ...data });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/**
 * Временная ручная выдача доступа админом (без платежки).
 * Header: x-admin-secret = ADMIN_GRANT_SECRET
 * Body: { telegramId, username?, addDeviceSlots? }
 */
app.post("/api/admin/grant-subscription", adminGrantAuth, async (req, res) => {
  const telegramId = Number(req.body?.telegramId || 0);
  const username = req.body?.username != null ? String(req.body.username || "").trim() || null : null;
  const addDeviceSlots = Number(req.body?.addDeviceSlots || 0);
  if (!Number.isFinite(telegramId) || telegramId < 1) {
    return res.status(400).json({ error: "bad_telegram_id" });
  }
  if (!Number.isFinite(addDeviceSlots) || addDeviceSlots < 0) {
    return res.status(400).json({ error: "bad_addDeviceSlots" });
  }
  try {
    const provisionResult = await xuiProvisionCore(telegramId, { force: true, username });
    let xuiLimitIp = null;
    if (addDeviceSlots > 0) {
      const r = await xui.incrementClientLimitIp({
        inboundId: config.xui.inboundId,
        telegramId,
        addSlots: addDeviceSlots,
      });
      xuiLimitIp = Number(r?.next || 0) || null;
    }
    const data = await loadMe(telegramId, username);
    return res.json({
      ok: true,
      telegramId,
      provisionResult,
      addedSlots: addDeviceSlots,
      xuiLimitIp,
      data,
    });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

/**
 * Admin: extend XUI client expiry by exact number of days.
 * Header: x-admin-secret = ADMIN_GRANT_SECRET
 * Body: { telegramId, days, username? }
 */
app.post("/api/admin/grant-days", adminGrantAuth, async (req, res) => {
  const telegramId = Number(req.body?.telegramId || 0);
  const days = Number(req.body?.days || 0);
  const username = req.body?.username != null ? String(req.body.username || "").trim() || null : null;
  if (!Number.isFinite(telegramId) || telegramId < 1) {
    return res.status(400).json({ error: "bad_telegram_id" });
  }
  if (!Number.isFinite(days) || days < 1) {
    return res.status(400).json({ error: "bad_days" });
  }
  try {
    const r = await extendXuiClientDays({ telegramId, days, username });
    const data = await loadMe(telegramId, username);
    return res.json({
      ok: true,
      telegramId,
      grantedDays: Math.floor(days),
      previousExpireAt: r.previousExpiryMs > 0 ? new Date(r.previousExpiryMs).toISOString() : null,
      nextExpireAt: new Date(r.nextExpiryMs).toISOString(),
      data,
    });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

/**
 * Admin: sync secondary(NL bypass) expiry to current primary expiry without adding days.
 * Header: x-admin-secret = ADMIN_GRANT_SECRET
 * Body: { telegramId, username? }
 */
app.post("/api/admin/sync-secondary-expiry", adminGrantAuth, async (req, res) => {
  const telegramId = Number(req.body?.telegramId || 0);
  const username = req.body?.username != null ? String(req.body.username || "").trim() || null : null;
  if (!Number.isFinite(telegramId) || telegramId < 1) {
    return res.status(400).json({ error: "bad_telegram_id" });
  }
  try {
    const r = await syncSecondaryExpiryFromPrimary({ telegramId, username });
    const data = await loadMe(telegramId, username);
    return res.json({
      ok: true,
      telegramId,
      synced: true,
      primaryExpireAt: r.primaryExpireAt,
      data,
    });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

/**
 * Dev/admin: enable/disable free mode (no billing) for a user.
 * Header: x-admin-secret = ADMIN_GRANT_SECRET
 * Body: { telegramId, freeMode: true|false }
 */
app.post("/api/admin/free-mode", adminGrantAuth, async (req, res) => {
  const telegramId = Number(req.body?.telegramId || 0);
  const freeMode = req.body?.freeMode;
  if (!Number.isFinite(telegramId) || telegramId < 1) {
    return res.status(400).json({ error: "bad_telegram_id" });
  }
  if (freeMode !== true && freeMode !== false) {
    return res.status(400).json({ error: "bad_freeMode" });
  }
  try {
    await balanceStore.setFreeMode(telegramId, freeMode);
    const data = await loadMe(telegramId);
    return res.json({ ok: true, telegramId, freeMode, ...data });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

/**
 * Dev/admin: set proxy addons for user, bypassing balance checks.
 * Header: x-admin-secret = ADMIN_GRANT_SECRET
 * Body: { telegramId, proxyEnabled?, dedicatedIpEnabled? }
 */
app.post("/api/admin/proxy/addons", adminGrantAuth, async (req, res) => {
  const telegramId = Number(req.body?.telegramId || 0);
  const proxyEnabled = req.body?.proxyEnabled;
  const dedicatedIpEnabled = req.body?.dedicatedIpEnabled;
  if (!Number.isFinite(telegramId) || telegramId < 1) {
    return res.status(400).json({ error: "bad_telegram_id" });
  }
  if (proxyEnabled === undefined && dedicatedIpEnabled === undefined) {
    return res.status(400).json({ error: "nothing_to_change" });
  }
  if (dedicatedIpEnabled === true && proxyEnabled === false) {
    return res.status(400).json({ error: "dedicated_requires_proxy" });
  }
  try {
    await proxyStore.setProxyAddons({ telegramId, proxyEnabled, dedicatedIpEnabled });
    const data = await loadMe(telegramId);
    return res.json({ ok: true, telegramId, ...data });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

/**
 * Dev/admin: fulfill dedicated IP info after you allocated it in Timeweb manually.
 * Header: x-admin-secret = ADMIN_GRANT_SECRET
 * Body: { telegramId, serverId, ip, ipv4Id? }
 */
app.post("/api/admin/proxy/dedicated-ip", adminGrantAuth, async (req, res) => {
  const telegramId = Number(req.body?.telegramId || 0);
  const serverId = String(req.body?.serverId || "").trim();
  const ip = String(req.body?.ip || "").trim();
  const ipv4Id = req.body?.ipv4Id != null ? String(req.body.ipv4Id || "").trim() : "";
  if (!Number.isFinite(telegramId) || telegramId < 1) {
    return res.status(400).json({ error: "bad_telegram_id" });
  }
  if (!serverId) return res.status(400).json({ error: "bad_serverId" });
  if (!ip) return res.status(400).json({ error: "bad_ip" });
  try {
    const cur = (await proxyStore.getProxyByTelegramId(telegramId)) || {
      telegramId: String(telegramId),
      credits: { total: 0, used: 0 },
      items: [],
    };
    const next = await proxyStore.setProxyForTelegramId(telegramId, {
      ...cur,
      dedicatedIp: { serverId, ip, ipv4Id: ipv4Id || null, updatedAt: new Date().toISOString() },
      rotateIpRequestedAt: null,
    });
    const data = await loadMe(telegramId);
    return res.json({ ok: true, telegramId, dedicatedIp: next.dedicatedIp, ...data });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post("/api/admin/timeweb/rotate-ip", adminGrantAuth, async (req, res) => {
  const telegramId = Number(req.body?.telegramId || 0);
  const serverId = String(req.body?.serverId || "").trim();
  if (!Number.isFinite(telegramId) || telegramId < 1) {
    return res.status(400).json({ error: "bad_telegram_id" });
  }
  if (!serverId) return res.status(400).json({ error: "bad_serverId" });
  try {
    const servers = parseProxyServers(config.proxy.serversJson);
    const srv = servers.find((s) => s.id === serverId) || null;
    if (!srv) return res.status(400).json({ error: "server_not_found" });
    const twServerId = String(srv.timewebServerId || srv.id || "").trim();
    if (!config.timeweb.apiToken || !twServerId) {
      return res.status(503).json({ error: "timeweb_not_configured_for_server" });
    }
    const cur = (await proxyStore.getProxyByTelegramId(telegramId)) || {
      telegramId: String(telegramId),
      credits: { total: 0, used: 0 },
      items: [],
    };
    if (cur?.dedicatedIp?.ipv4Id) {
      await timewebApi
        .deleteServerIP(twServerId, cur.dedicatedIp.ipv4Id)
        .catch((e) => console.warn("[timeweb-admin] delete old ip:", e?.message || e));
    }
    const ipInfo = await timewebApi.addServerIPv4(twServerId);
    if (!ipInfo?.ip) throw new Error("timeweb_ip_create_failed");
    await proxyStore.setProxyForTelegramId(telegramId, {
      ...cur,
      addons: {
        proxyEnabled: true,
        dedicatedIpEnabled: true,
      },
      dedicatedIp: {
        serverId,
        ip: String(ipInfo.ip),
        ipv4Id: ipInfo.id || null,
        source: "timeweb",
        updatedAt: new Date().toISOString(),
      },
      rotateIpRequestedAt: null,
    });
    const data = await loadMe(telegramId);
    return res.json({ ok: true, telegramId, dedicatedIp: data?.proxy?.dedicatedIp || null, ...data });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

/**
 * Admin: notify users whose subscription expires soon.
 * Header: x-admin-secret = ADMIN_GRANT_SECRET
 * Body: { daysLeftMax?, daysLeftMin?, dryRun?, text? }
 */
app.post("/api/admin/notify-expiring", adminGrantAuth, async (req, res) => {
  const daysLeftMax = Number(req.body?.daysLeftMax ?? 4);
  const daysLeftMin = Number(req.body?.daysLeftMin ?? 0);
  const dryRun = req.body?.dryRun === true;
  const customText = req.body?.text != null ? String(req.body.text || "").trim() : "";
  const msgText = customText ||
    "Напоминание: у вас скоро заканчивается подписка VL. Откройте мини‑приложение и продлите доступ заранее, чтобы не потерять связь.";

  if (!Number.isFinite(daysLeftMax) || daysLeftMax < 0 || daysLeftMax > 365) {
    return res.status(400).json({ error: "bad_daysLeftMax" });
  }
  if (!Number.isFinite(daysLeftMin) || daysLeftMin < 0 || daysLeftMin > daysLeftMax) {
    return res.status(400).json({ error: "bad_daysLeftMin" });
  }

  try {
    const r = await runNotifyExpiringJob({
      daysLeftMax,
      daysLeftMin,
      text: msgText,
      dryRun,
    });
    return res.json({ ok: true, dryRun, ...r });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post("/api/admin/yookassa/reconcile", adminGrantAuth, async (req, res) => {
  if (!isYookassaEnabled()) return res.status(503).json({ error: "yookassa_disabled" });
  const paymentId = String(req.body?.paymentId || "").trim();
  if (!paymentId) return res.status(400).json({ error: "paymentId_required" });
  try {
    const payment = await yookassaApi.getPayment(paymentId);
    if (String(payment?.status || "").toLowerCase() !== "succeeded" || payment?.paid !== true) {
      return res.status(409).json({ error: "payment_not_succeeded", status: payment?.status || null });
    }
    const dedupKey = `yk:${paymentId}`;
    if (await paymentWebhookStore.wasProcessed(dedupKey)) {
      return res.json({ ok: true, duplicate: true });
    }
    const payloadKey = String(payment?.metadata?.payloadKey || "").trim();
    if (!payloadKey) return res.status(400).json({ error: "payloadKey_missing" });
    const payload = parseTelegramPaymentPayload(payloadKey);
    if (!payload) return res.status(400).json({ error: "payment_payload_missing" });
    const amountMinor = Math.floor(Number(payment?.amount?.value || 0) * 100);
    await applySuccessfulBusinessPayload({
      payload,
      paidMinor: amountMinor,
      username: null,
    });
    await paymentWebhookStore.markProcessed(dedupKey, { paymentId, kind: "reconcile" });
    return res.json({ ok: true, applied: true, telegramId: payload.telegramId, amountMinor });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

const bot = new Bot(config.botToken);

async function getTelegramPlanOptions() {
  return [
    { days: 7, code: "vps_7", title: "7 дней", serviceType: "vps" },
    { days: 30, code: "vps_30", title: "30 дней", serviceType: "vps" },
    { days: 90, code: "vps_90", title: "90 дней", serviceType: "vps" },
    { days: 180, code: "vps_180", title: "180 дней", serviceType: "vps" },
  ];
}

function inferServiceTypeFromProductCode(productCode) {
  const code = String(productCode || "").trim().toLowerCase();
  if (code.startsWith("device_")) return "device_slot";
  return code.startsWith("proxy_") ? "proxy" : "vps";
}

function isYookassaEnabled() {
  return Boolean(config.yookassa.shopId && config.yookassa.secretKey);
}

function parseProxyProductCode(productCode) {
  const code = String(productCode || "").trim().toLowerCase();
  const m = /^proxy_([^_]+)_(\d+)$/i.exec(code);
  if (!m) return { serverId: null, days: null };
  return {
    serverId: String(m[1] || "").trim() || null,
    days: Number(m[2] || 0) || null,
  };
}

async function sendTelegramPaymentMenu(ctx) {
  if (!config.payment.telegramProviderToken) {
    await ctx.reply("Платежи не настроены (нет TG_PAYMENT_PROVIDER_TOKEN).");
    return;
  }
  const plans = await getTelegramPlanOptions();
  const kb = new InlineKeyboard();
  for (const p of plans.slice(0, 8)) {
    const amountMinor = resolvePlanPriceMinor({
      productCode: p.code,
      days: p.days,
      serviceType: p.serviceType,
    });
    const amountRub = (Number(amountMinor) / 100).toFixed(0);
    kb.text(`${p.title} · ${amountRub} ₽`, `paymenu:${p.days}:${p.code}`).row();
  }
  await ctx.reply("Выберите тариф для оплаты:", { reply_markup: kb });
}

function buildInvoiceSelection(input = {}) {
  const productCode = String(
    input.productCode || config.payment.defaultProductCode || "vps_30",
  ).trim();
  const fromProxyCode = parseProxyProductCode(productCode);
  const rawServiceType = String(
    input.serviceType || inferServiceTypeFromProductCode(productCode),
  ).trim().toLowerCase();
  const serviceType =
    rawServiceType === "proxy"
      ? "proxy"
      : rawServiceType === "device_slot"
        ? "device_slot"
        : "vps";
  const selectedDays = Number(input.days ?? input.grantDays ?? fromProxyCode.days ?? 0);
  const days = serviceType === "device_slot"
    ? 1
    : Number.isFinite(selectedDays) && selectedDays > 0
      ? Math.floor(selectedDays)
      : Math.max(1, Number(config.payment.telegramTestDays || 30));
  const serverId = String(input.serverId || fromProxyCode.serverId || "").trim() || null;
  return { days, productCode, serviceType, serverId };
}

function buildTelegramInvoiceEnvelope(telegramId, username, selected) {
  const normalized = buildInvoiceSelection(selected);
  const amountMinor = normalized.serviceType === "device_slot"
    ? Math.max(1, Math.floor(Number(config.payment.deviceSlotMinor || 15000)))
    : resolvePlanPriceMinor(normalized);
  const titlePrefix = config.payment.mode === "test"
    ? "VPS Premium — тестовый платёж"
    : "VPS Premium — оплата";
  const title = normalized.serviceType === "device_slot"
    ? "VPS Premium — +1 устройство"
    : `${titlePrefix} · ${normalized.days} дней`;
  const desc = normalized.serviceType === "device_slot"
    ? "Разовое увеличение лимита устройств: +1 слот."
    : normalized.serviceType === "proxy"
    ? `Оплата доступа к прокси\nТариф: ${normalized.days} дней (${normalized.productCode})`
    : `Оплата доступа к VPS Premium\nТариф: ${normalized.days} дней (${normalized.productCode})`;
  const priceLabel = normalized.serviceType === "device_slot"
    ? "+1 устройство"
    : `${envDaysLabel(normalized.days)}`;
  const payloadData = {
    kind: "telegram_payment",
    telegramId,
    username: username || null,
    days: normalized.days,
    productCode: normalized.productCode,
    serviceType: normalized.serviceType,
    serverId: normalized.serverId,
    proxyCredits: normalized.serviceType === "proxy" ? 1 : 0,
    addDeviceSlots: normalized.serviceType === "device_slot" ? 1 : 0,
    at: Date.now(),
  };
  const payload = savePaymentPayload(payloadData);
  return { normalized, title, desc, payload, amountMinor, priceLabel };
}

function envDaysLabel(days) {
  return `${days} дней`;
}

function buildBalanceTopupInvoiceEnvelope(telegramId, username, amountMinor) {
  const tid = Number(telegramId);
  const minMinor = Math.max(100, config.payment.telegramMinInvoiceAmountMajor * 100);
  const minor = Math.max(minMinor, Math.floor(Number(amountMinor) || 0));
  const rub = (minor / 100).toFixed(0);
  const title =
    config.payment.mode === "test"
      ? "Баланс VL — тестовое пополнение"
      : "Пополнение баланса VL";
  const desc = `Зачисление на внутренний баланс: ${rub} RUB. После первого пополнения доступ к VPS списывается почасово.`;
  const payload = savePaymentPayload({
    kind: "balance_topup",
    telegramId: tid,
    username: username || null,
    at: Date.now(),
  });
  return { title, desc, payload, amountMinor: minor };
}

async function createBalanceTopupInvoiceLink({ telegramId, username, amountMinor }) {
  const env = buildBalanceTopupInvoiceEnvelope(telegramId, username, amountMinor);
  const invoiceLink = await createTelegramInvoiceLinkWithRetries(env);
  return { invoiceLink, amountMinor: env.amountMinor };
}

async function applySuccessfulBusinessPayload({ payload, paidMinor = 0, username = null }) {
  if (!payload) throw new Error("payment_payload_missing");
  if (payload.kind === "balance_topup") {
    const minor = Math.max(0, Math.floor(Number(paidMinor || 0)));
    if (minor > 0) {
      await balanceStore.credit(payload.telegramId, minor);
      await maybeAwardReferralBonus({
        inviteeTelegramId: payload.telegramId,
        paidMinor: minor,
      }).catch(() => null);
    }
    await setXuiClientEnabled(payload.telegramId, true).catch(() => {});
    return { serviceType: "balance_topup", grantedDays: 0 };
  }
  if (payload.serviceType === "proxy") {
    const grantDays = Number.isFinite(payload.days) ? payload.days : 30;
    const grantCount = Number.isFinite(payload.proxyCredits) && payload.proxyCredits > 0
      ? payload.proxyCredits
      : 1;
    await proxyStore.grantProxyCredits({
      telegramId: payload.telegramId,
      addCount: grantCount,
      days: grantDays,
    });
    return { serviceType: "proxy", grantedDays: grantDays };
  }
  if (payload.serviceType === "device_slot") {
    const addSlots = Number.isFinite(payload.addDeviceSlots) && payload.addDeviceSlots > 0
      ? Math.floor(payload.addDeviceSlots)
      : 1;
    await xuiProvisionCore(payload.telegramId, { force: true, username });
    await xui.incrementClientLimitIp({
      telegramId: payload.telegramId,
      addSlots,
      minFloor: 2,
    });
    return { serviceType: "device_slot", grantedDays: 0, addDeviceSlots: addSlots };
  }
  await xuiProvisionCore(payload.telegramId, { force: true, username });
  return { serviceType: "vps", grantedDays: Number(payload.days || 0) || 0 };
}

async function sendTelegramInvoiceForSelection({
  chatId,
  telegramId,
  username = null,
  selected,
}) {
  const env = buildTelegramInvoiceEnvelope(telegramId, username, selected);
  await bot.api.sendInvoice(
    chatId,
    env.title,
    env.desc,
    env.payload,
    config.payment.telegramCurrency,
    [{ label: env.priceLabel || `${env.normalized.days} дней`, amount: env.amountMinor }],
    { provider_token: config.payment.telegramProviderToken },
  );
}

function isRetryableInvoiceLinkError(msg) {
  const s = String(msg || "").toUpperCase();
  return (
    s.includes("TIMEOUT") ||
    s.includes("429") ||
    s.includes("502") ||
    s.includes("503") ||
    s.includes("504") ||
    s.includes("TOO_MANY") ||
    s.includes("NETWORK")
  );
}

async function createTelegramInvoiceLinkWithRetries(env) {
  const endpoint = `https://api.telegram.org/bot${config.botToken}/createInvoiceLink`;
  const body = JSON.stringify({
    title: env.title,
    description: env.desc,
    payload: env.payload,
    provider_token: config.payment.telegramProviderToken,
    currency: config.payment.telegramCurrency,
    prices: [{ label: env.priceLabel || `${env.normalized.days} дней`, amount: env.amountMinor }],
  });
  const maxAttempts = Math.max(1, Number(process.env.TG_INVOICE_LINK_RETRIES || 4));
  let lastErr = "unknown";
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      await sleep(600 * Math.min(8, 1 + attempt));
    }
    try {
      const resp = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      const json = await resp.json().catch(() => null);
      if (resp.ok && json?.ok && json?.result) {
        return String(json.result);
      }
      lastErr = json?.description || `telegram_create_invoice_link_failed_${resp.status}`;
      if (!isRetryableInvoiceLinkError(lastErr)) break;
    } catch (e) {
      lastErr = String(e?.message || e);
      if (!isRetryableInvoiceLinkError(lastErr)) break;
    }
  }
  throw new Error(lastErr);
}

async function createTelegramInvoiceLinkForSelection({
  telegramId,
  username = null,
  selected,
}) {
  const env = buildTelegramInvoiceEnvelope(telegramId, username, selected);
  const invoiceLink = await createTelegramInvoiceLinkWithRetries(env);
  return {
    invoiceLink,
    normalized: env.normalized,
  };
}

async function sendTelegramInvoiceFromCtx(ctx, selected = null) {
  if (!config.payment.telegramProviderToken) {
    await ctx.reply("Платежи не настроены (нет TG_PAYMENT_PROVIDER_TOKEN).");
    return;
  }
  const telegramId = Number(ctx.from?.id || 0);
  if (!Number.isFinite(telegramId) || telegramId < 1) {
    await ctx.reply("Не удалось определить Telegram ID.");
    return;
  }
  try {
    await sendTelegramInvoiceForSelection({
      chatId: ctx.chat.id,
      telegramId,
      username: ctx.from?.username || null,
      selected,
    });
  } catch (e) {
    const msg = String(e?.description || e?.message || e);
    await ctx.reply(`Не удалось отправить счёт: ${msg}`);
  }
}

app.post("/api/payments/checkout-link", authMiddleware, async (req, res) => {
  const tid = Number(req.tgSession.sub || req.tgSession.tg);
  const username = req.tgSession?.u ?? null;
  const selected = buildInvoiceSelection(req.body || {});
  try {
    if (isYookassaEnabled()) {
      const amountMinor = selected.serviceType === "device_slot"
        ? Math.max(1, Math.floor(Number(config.payment.deviceSlotMinor || 15000)))
        : resolvePlanPriceMinor(selected);
      if (!Number.isFinite(amountMinor) || amountMinor < 1) {
        return res.status(400).json({ error: "bad_amount" });
      }
      const payloadKey = savePaymentPayload({
        kind: "telegram_payment",
        telegramId: tid,
        username: username || null,
        days: selected.serviceType === "device_slot" ? 0 : selected.days,
        productCode: selected.productCode,
        serviceType: selected.serviceType,
        serverId: selected.serverId,
        proxyCredits: selected.serviceType === "proxy" ? 1 : 0,
        addDeviceSlots: selected.serviceType === "device_slot" ? 1 : 0,
        at: Date.now(),
      });
      const yk = await yookassaApi.createRedirectPayment({
        amountMinor,
        description: selected.serviceType === "device_slot"
          ? "VL +1 устройство"
          : `VL ${selected.serviceType.toUpperCase()} ${selected.days}d`,
        returnUrl: config.yookassa.returnUrl || `${String(config.publicBaseUrl || "").replace(/\/$/, "")}/app/`,
        metadata: { payloadKey, telegramId: String(tid), serviceType: selected.serviceType },
      });
      return res.json({
        ok: true,
        provider: "yookassa",
        invoiceLink: String(yk?.confirmation?.confirmation_url || "").trim(),
        paymentId: String(yk?.id || "").trim(),
      });
    }
    const r = await createTelegramInvoiceLinkForSelection({
      telegramId: tid,
      username,
      selected,
    });
    return res.json({ ok: true, provider: "telegram", invoiceLink: r.invoiceLink, ...r.normalized });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post("/api/payments/yookassa/webhook", async (req, res) => {
  if (!isYookassaEnabled()) return res.status(503).json({ error: "yookassa_disabled" });
  try {
    const event = req.body || {};
    const obj = event?.object || {};
    const paymentId = String(obj?.id || "").trim();
    if (!paymentId) return res.status(400).json({ error: "payment_id_required" });
    const dedupKey = `yk:${paymentId}`;
    if (await paymentWebhookStore.wasProcessed(dedupKey)) {
      return res.json({ ok: true, duplicate: true });
    }
    const payment = await yookassaApi.getPayment(paymentId);
    if (String(payment?.status || "").toLowerCase() !== "succeeded" || payment?.paid !== true) {
      return res.json({ ok: true, skipped: true, status: payment?.status || null });
    }
    const payloadKey = String(payment?.metadata?.payloadKey || "").trim();
    const payload = parseTelegramPaymentPayload(payloadKey);
    if (!payload) return res.status(400).json({ error: "payload_not_found" });
    const paidMinor = Math.floor(Number(payment?.amount?.value || 0) * 100);
    await applySuccessfulBusinessPayload({
      payload,
      paidMinor: Number.isFinite(paidMinor) ? paidMinor : 0,
      username: payload?.username || null,
    });
    await paymentWebhookStore.markProcessed(dedupKey, {
      provider: "yookassa",
      telegramId: String(payload.telegramId || ""),
      payloadKey,
    });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post("/api/payments/telegram/invoice", authMiddleware, async (req, res) => {
  if (!config.payment.telegramProviderToken) {
    return res.status(503).json({ error: "telegram_payments_disabled" });
  }
  const telegramId = Number(req.tgSession.sub || req.tgSession.tg);
  if (!Number.isFinite(telegramId) || telegramId < 1) {
    return res.status(400).json({ error: "bad_telegram_id" });
  }
  try {
    await sendTelegramInvoiceForSelection({
      chatId: telegramId,
      telegramId,
      username: req.tgSession?.u ?? null,
      selected: req.body || {},
    });
    return res.json({ ok: true, sentToChat: true });
  } catch (e) {
    return res.status(500).json({ error: String(e?.description || e?.message || e) });
  }
});

app.post("/api/payments/telegram/invoice-link", authMiddleware, async (req, res) => {
  if (!config.payment.telegramProviderToken) {
    return res.status(503).json({ error: "telegram_payments_disabled" });
  }
  const telegramId = Number(req.tgSession.sub || req.tgSession.tg);
  if (!Number.isFinite(telegramId) || telegramId < 1) {
    return res.status(400).json({ error: "bad_telegram_id" });
  }
  const username = req.tgSession?.u ?? null;
  const selected = req.body || {};
  try {
    const r = await createTelegramInvoiceLinkForSelection({
      telegramId,
      username,
      selected,
    });
    return res.json({
      ok: true,
      invoiceLink: r.invoiceLink,
      selection: r.normalized,
      sentToChat: false,
      fallbackToChat: false,
    });
  } catch (e) {
    const msg = String(e?.message || e);
    console.warn("[payments] createInvoiceLink failed, fallback sendInvoice:", msg);
    try {
      const env = buildTelegramInvoiceEnvelope(telegramId, username, selected);
      await bot.api.sendInvoice(
        telegramId,
        env.title,
        env.desc,
        env.payload,
        config.payment.telegramCurrency,
        [{ label: `${env.normalized.days} дней`, amount: env.amountMinor }],
        { provider_token: config.payment.telegramProviderToken },
      );
      return res.json({
        ok: true,
        invoiceLink: "",
        selection: env.normalized,
        sentToChat: true,
        fallbackToChat: true,
        reason: msg,
      });
    } catch (e2) {
      return res.status(500).json({ error: String(e2?.message || e2 || msg) });
    }
  }
});

app.post("/api/payments/balance/invoice-link", authMiddleware, async (req, res) => {
  if (!config.balance.billingEnabled) {
    return res.status(503).json({ error: "balance_billing_disabled" });
  }
  if (!config.payment.telegramProviderToken) {
    return res.status(503).json({ error: "telegram_payments_disabled" });
  }
  const telegramId = Number(req.tgSession.sub || req.tgSession.tg);
  if (!Number.isFinite(telegramId) || telegramId < 1) {
    return res.status(400).json({ error: "bad_telegram_id" });
  }
  const username = req.tgSession?.u ?? null;
  const amountRub = Math.floor(Number(req.body?.amountRub ?? req.body?.amount ?? 0));
  const minRub = config.payment.telegramMinInvoiceAmountMajor;
  if (!Number.isFinite(amountRub) || amountRub < minRub || amountRub > 500_000) {
    if (Number.isFinite(amountRub) && amountRub >= 1 && amountRub < minRub) {
      return res.status(400).json({
        error: `Минимум ${minRub} ₽ для оплаты через Telegram (лимит платёжного провайдера)`,
      });
    }
    return res.status(400).json({ error: "bad_amount" });
  }
  const amountMinor = amountRub * 100;
  try {
    const r = await createBalanceTopupInvoiceLink({
      telegramId,
      username,
      amountMinor,
    });
    return res.json({
      ok: true,
      invoiceLink: r.invoiceLink,
      amountMinor: r.amountMinor,
      sentToChat: false,
      fallbackToChat: false,
    });
  } catch (e) {
    const msg = String(e?.message || e);
    console.warn("[payments] balance createInvoiceLink failed, fallback sendInvoice:", msg);
    try {
      const env = buildBalanceTopupInvoiceEnvelope(telegramId, username, amountMinor);
      await bot.api.sendInvoice(
        telegramId,
        env.title,
        env.desc,
        env.payload,
        config.payment.telegramCurrency,
        [{ label: "Пополнение баланса", amount: env.amountMinor }],
        { provider_token: config.payment.telegramProviderToken },
      );
      return res.json({
        ok: true,
        invoiceLink: "",
        amountMinor: env.amountMinor,
        sentToChat: true,
        fallbackToChat: true,
        reason: msg,
      });
    } catch (e2) {
      return res.status(500).json({ error: String(e2?.message || e2 || msg) });
    }
  }
});

app.post("/api/payments/balance/checkout-link", authMiddleware, async (req, res) => {
  if (!config.balance.billingEnabled) {
    return res.status(503).json({ error: "balance_billing_disabled" });
  }
  const tid = Number(req.tgSession.sub || req.tgSession.tg);
  const username = req.tgSession?.u ?? null;
  const amountRub = Number(req.body?.amountRub || 0);
  const minRub = Math.max(1, config.payment.telegramMinInvoiceAmountMajor);
  if (!Number.isFinite(amountRub) || amountRub < minRub) {
    return res.status(400).json({ error: "amount_too_small", minRub });
  }
  const amountMinor = Math.floor(amountRub * 100);
  try {
    if (isYookassaEnabled()) {
      const env = buildBalanceTopupInvoiceEnvelope(tid, username, amountMinor);
      const yk = await yookassaApi.createRedirectPayment({
        amountMinor: env.amountMinor,
        description: "Пополнение баланса VL",
        returnUrl: config.yookassa.returnUrl || `${String(config.publicBaseUrl || "").replace(/\/$/, "")}/app/`,
        metadata: { payloadKey: env.payload, telegramId: String(tid), kind: "balance_topup" },
      });
      return res.json({
        ok: true,
        provider: "yookassa",
        invoiceLink: String(yk?.confirmation?.confirmation_url || "").trim(),
        amountMinor: env.amountMinor,
      });
    }
    if (!config.payment.telegramProviderToken) {
      return res.status(503).json({ error: "telegram_payments_disabled" });
    }
    const r = await createBalanceTopupInvoiceLink({
      telegramId: tid,
      username,
      amountMinor,
    });
    return res.json({ ok: true, provider: "telegram", invoiceLink: r.invoiceLink, amountMinor: r.amountMinor });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

bot.command("start", async (ctx) => {
  const payload = extractStartPayload(ctx.message?.text || "");
  const inviterId = parseRefInviterId(payload);
  const inviteeId = Number(ctx.from?.id || 0);
  if (inviterId && inviteeId > 0 && inviterId !== inviteeId) {
    await referralStore
      .bindInviterIfEmpty({ inviteeTelegramId: inviteeId, inviterTelegramId: inviterId })
      .catch(() => null);
  }
  const kb = new InlineKeyboard().webApp("VL — мини‑приложение", config.webAppUrl);
  await ctx.reply(
    "Открой мини-приложение: там статус подписки и доступ к VPS Premium.",
    { reply_markup: kb },
  );
});

bot.command("paytest", async (ctx) => {
  if (config.payment.mode !== "test") {
    await ctx.reply("В боевом режиме используйте /buy.");
    return;
  }
  await sendTelegramPaymentMenu(ctx);
});

bot.command("buy", async (ctx) => {
  await sendTelegramPaymentMenu(ctx);
});

bot.callbackQuery("paymenu_open", async (ctx) => {
  await ctx.answerCallbackQuery();
  await sendTelegramPaymentMenu(ctx);
});

bot.callbackQuery(/^paymenu:(\d+):(.+)$/i, async (ctx) => {
  await ctx.answerCallbackQuery();
  const data = String(ctx.callbackQuery?.data || "");
  const m = /^paymenu:(\d+):(.+)$/i.exec(data);
  const days = Number(m?.[1] || 0);
  const productCode = String(m?.[2] || "").trim() || "vps_30";
  if (!Number.isFinite(days) || days < 1) {
    await ctx.reply("Некорректный тариф. Откройте меню ещё раз: /paytest");
    return;
  }
  await sendTelegramInvoiceFromCtx(ctx, { days, productCode });
});

bot.on("pre_checkout_query", async (ctx) => {
  try {
    const payload = parseTelegramPaymentPayload(ctx.preCheckoutQuery?.invoice_payload);
    if (!payload) {
      await ctx.answerPreCheckoutQuery(false, {
        error_message: "Некорректные параметры платежа. Попробуйте снова.",
      });
      return;
    }
    await ctx.answerPreCheckoutQuery(true);
  } catch {
    await ctx.answerPreCheckoutQuery(false, {
      error_message: "Платёж временно недоступен. Попробуйте позже.",
    });
  }
});

bot.on("message:successful_payment", async (ctx) => {
  const sp = ctx.message?.successful_payment;
  if (!sp) return;
  const dedupKey = makePaymentDedupKey(sp);
  if (dedupKey && processedPayments.has(dedupKey)) return;
  const payload = parseTelegramPaymentPayload(sp.invoice_payload);
  if (!payload) {
    await ctx.reply("Платёж получен, но payload не распознан. Напишите в поддержку.");
    return;
  }
  if (dedupKey) processedPayments.add(dedupKey);
  const username = ctx.from?.username || null;
  try {
    const applied = await applySuccessfulBusinessPayload({
      payload,
      paidMinor: Number(sp.total_amount || 0),
      username,
    });
    if (applied.serviceType === "balance_topup") {
      await ctx.reply(
        `Баланс пополнен на ${(Number(sp.total_amount || 0) / 100).toFixed(0)} руб. Списание за VPS — почасово после активации баланса.`,
      );
      return;
    }
    if (applied.serviceType === "proxy") {
      await ctx.reply(
        `Платёж успешно получен. Квота прокси выдана: +${payload.proxyCredits || 1} на ${payload.days} дней.`,
      );
    } else if (applied.serviceType === "device_slot") {
      await ctx.reply("Платёж успешно получен. Лимит устройств увеличен на +1.");
    } else {
      await ctx.reply(
        `Платёж успешно получен. Доступ к VPS Premium активирован на ${payload.days} дней.`,
      );
    }
  } catch (e) {
    await ctx.reply(
      `Платёж получен, но выдача не завершилась автоматически: ${String(e?.message || e)}.\nНапишите в поддержку, мы уже видим оплату.`,
    );
    if (dedupKey) processedPayments.delete(dedupKey);
  }
});

if (config.publicBaseUrl) {
  app.use(whPath, webhookCallback(bot, "express", { secretToken: config.webhookSecret || undefined }));
}

app.use("/app", express.static(publicDir));
app.get(["/app", "/app/"], (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});
app.get(/^\/app\/.*/, (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.listen(config.port, () => {
  console.log(`http://127.0.0.1:${config.port}`);
  void setupTelegramTransport();
  if (config.notifyExpiring?.enabled) {
    const hourUtc = Number(config.notifyExpiring.hourUtc ?? 9);
    const daysLeftMax = Number(config.notifyExpiring.daysLeftMax ?? 4);
    const daysLeftMin = Number(config.notifyExpiring.daysLeftMin ?? 0);
    const scheduleNext = () => {
      const now = new Date();
      const next = new Date(now);
      next.setUTCMinutes(0, 0, 0);
      next.setUTCHours(hourUtc);
      if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
      const delay = Math.max(5_000, next.getTime() - now.getTime());
      setTimeout(async () => {
        try {
          await runNotifyExpiringJob({ daysLeftMax, daysLeftMin, text: "", dryRun: false });
        } catch (e) {
          console.warn("[notify-expiring] failed:", e?.message || e);
        } finally {
          scheduleNext();
        }
      }, delay);
    };
    scheduleNext();
  }
});