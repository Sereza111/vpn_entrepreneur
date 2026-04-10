import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { Bot, InlineKeyboard, webhookCallback } from "grammy";
import { Agent } from "undici";
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
} from "./proxyProvision.js";
import * as nocobase from "./nocobase.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "..", "public");
const whPath = "/telegram/webhook";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
app.use(express.json({ limit: "1mb" }));

if (config.corsOrigin) {
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", config.corsOrigin);
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

app.get("/health", (_req, res) => res.json({ ok: true }));

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

// Public 3X-UI subscription proxy by token (token is generated by the bot on link).
app.get("/sub/xui/:token", async (req, res) => {
  const token = String(req.params.token || "").trim();
  if (!token) return res.status(400).send("token_required");
  try {
    const link = await xuiStore.getXuiLinkByPublicToken(token);
    if (!link) return res.status(404).send("not_found");
    const targetUrl = resolveXuiUrlFromLink(link);
    if (!targetUrl) return res.status(503).send("xui_base_url_required");
    const body = await fetchText(targetUrl, { insecureTls: config.xui.insecureTls });
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.status(200).send(body);
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

async function loadMe(telegramId) {
  const base = String(config.publicBaseUrl || "").replace(/\/$/, "");
  const xuiLink = await xuiStore.getXuiLinkByTelegramId(telegramId);
  const xuiPublicUrl =
    base && xuiLink?.publicToken ? `${base}/sub/xui/${xuiLink.publicToken}` : null;

  const primary = xuiPublicUrl || null;
  const subscriptionPrimarySource = "xui";

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

  const xuiPayload = xuiLink
    ? { linked: true, subscriptionUrl: xuiPublicUrl }
    : { linked: false };

  const proxyServers = parseProxyServers(config.proxy.serversJson);
  const proxyRec = await proxyStore.getProxyByTelegramId(telegramId);
  const remaining = proxyStore.computeProxyRemaining(proxyRec);
  const proxyItems = Array.isArray(proxyRec?.items) ? proxyRec.items : [];
  const proxyPayload = {
    remaining,
    total: Number(proxyRec?.credits?.total || 0),
    used: Number(proxyRec?.credits?.used || 0),
    creditExpiresAt: proxyRec?.creditExpiresAt || null,
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

  let catalog = { source: "fallback", products: [] };
  if (nocobase.nocobaseEnabled()) {
    try {
      const products = await nocobase.fetchCatalogProducts();
      if (Array.isArray(products) && products.length) {
        catalog = { source: "nocobase", products };
      }
    } catch {
      // не ломаем /api/me
    }
  }

  return {
    remnawaveUser: null,
    subscriptionUrl: primary,
    subscriptionPrimarySource,
    xui: xuiPayload,
    subscriptionStatus,
    proxy: proxyPayload,
    proxyServers: proxyServers.map((s) => ({ id: s.id, country: s.country })),
    catalog,
  };
}

function calcNewDeviceLimit(currentLimit, addSlots) {
  const base = Number.isFinite(Number(currentLimit)) && Number(currentLimit) > 0
    ? Number(currentLimit)
    : 1;
  return Math.max(1, base + Number(addSlots || 0));
}

/**
 * Создаёт клиента в 3X-UI (если нет) и привязывает subId в боте.
 * @returns {"already_linked"|"reused"|"created"}
 */
async function xuiProvisionCore(telegramId, { force }) {
  const tid = Number(telegramId);
  if (!config.xui.panelBaseUrl || !config.xui.username || !config.xui.password) {
    throw new Error("xui_not_configured");
  }
  if (!config.xui.inboundId) {
    throw new Error("xui_inbound_id_required");
  }
  const existing = await xuiStore.getXuiLinkByTelegramId(tid);
  if (existing && !force) {
    return "already_linked";
  }

  const found = await xui
    .findClientInInbound({
      inboundId: config.xui.inboundId,
      telegramId: tid,
    })
    .catch(() => null);
  if (found?.client) {
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
      });
      return "reused";
    }
  }

  const created = await xui.addClientToInbound({
    inboundId: config.xui.inboundId,
    telegramId: tid,
  });

  await xuiStore.linkXuiSubscription({
    telegramId: tid,
    xuiUrlOrToken: created.creds.subIdEffective || created.creds.subId,
  });
  return "created";
}

app.get("/api/me", authMiddleware, async (req, res) => {
  try {
    const tid = Number(req.tgSession.sub || req.tgSession.tg);
    const data = await loadMe(tid);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/subscription", authMiddleware, async (req, res) => {
  try {
    const tid = Number(req.tgSession.sub || req.tgSession.tg);
    const data = await loadMe(tid);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Link 3X-UI subscription to this Telegram user.
// Body: { subscriptionUrlOrToken: "https://.../sub/xxxx" } OR { subscriptionUrlOrToken: "xxxx" }
app.post("/api/link-xui", authMiddleware, async (req, res) => {
  const raw = String(req.body?.subscriptionUrlOrToken || "").trim();
  if (!raw) return res.status(400).json({ error: "subscriptionUrlOrToken_required" });
  try {
    const tid = Number(req.tgSession.sub || req.tgSession.tg);
    await xuiStore.linkXuiSubscription({ telegramId: tid, xuiUrlOrToken: raw });
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
    const r = await xuiProvisionCore(tid, { force });
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
    if (remaining < 1) {
      return res.status(402).json({ error: "proxy_quota_exhausted" });
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
    void nocobase.syncProxyInstanceIssued({
      telegramId: tid,
      serverId,
      country: server.country || "",
      username: creds.username,
    });
    const data = await loadMe(tid);
    return res.json({ ok: true, created: true, ...data });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

// Test/admin: grant proxy quota
app.post("/api/test/proxy/grant", authMiddleware, async (req, res) => {
  if (!config.testGrantEnabled) {
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
    amount,
    currency,
    externalPaymentId,
    paymentId,
    productCode,
    username,
  } = req.body || {};
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
    if (days < 1 && slots < 1) {
      return res.status(400).json({ error: "nothing_to_apply" });
    }
    await xuiProvisionCore(tid, { force: true });
    void nocobase.syncPaymentOrder({
      telegramId: tid,
      extendDays: days,
      addDeviceSlots: slots,
      amount,
      currency,
      externalPaymentId: externalPaymentId ?? paymentId,
      productCode,
      username,
      source: "payment_webhook",
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/test/grant", authMiddleware, async (req, res) => {
  if (!config.testGrantEnabled) {
    return res.status(403).json({ error: "test_grant_disabled" });
  }
  const days = Number(req.body?.days || 30);
  if (!Number.isFinite(days) || days < 1) {
    return res.status(400).json({ error: "bad_days" });
  }
  try {
    const tid = Number(req.tgSession.sub || req.tgSession.tg);
    await xuiProvisionCore(tid, { force: true });
    const data = await loadMe(tid);
    return res.json({ ok: true, ...data });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.post("/api/test/add-device-slot", authMiddleware, async (req, res) => {
  if (!config.testGrantEnabled) {
    return res.status(403).json({ error: "test_grant_disabled" });
  }
  const slots = Number(req.body?.slots || 1);
  if (!Number.isFinite(slots) || slots < 1) {
    return res.status(400).json({ error: "bad_slots" });
  }
  try {
    // Ensure client exists / link is present, then bump limitIp.
    await xuiProvisionCore(Number(req.tgSession.sub || req.tgSession.tg), { force: true });
    const tid = Number(req.tgSession.sub || req.tgSession.tg);
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

const bot = new Bot(config.botToken);

bot.command("start", async (ctx) => {
  const kb = new InlineKeyboard().webApp("VL — мини‑приложение", config.webAppUrl);
  await ctx.reply(
    "Открой мини-приложение: там статус подписки и подключение VPN.",
    { reply_markup: kb },
  );
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
});