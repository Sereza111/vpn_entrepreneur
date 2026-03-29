import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { Bot, InlineKeyboard, webhookCallback } from "grammy";
import { config } from "./config.js";
import { validateWebAppInitData } from "./telegramWebApp.js";
import { signSession, verifySession } from "./session.js";
import * as rw from "./remnawave.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "..", "public");
const whPath = "/telegram/webhook";

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
  const users = await rw.getUsersByTelegramId(telegramId);
  const pick = users[0] || null;
  if (!pick) return { remnawaveUser: null };
  return {
    remnawaveUser: {
      uuid: pick.uuid,
      username: pick.username,
      shortUuid: pick.shortUuid,
      status: pick.status,
      expireAt: pick.expireAt,
      subscriptionUrl: pick.subscriptionUrl,
      trafficLimitBytes: pick.trafficLimitBytes,
    },
  };
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

app.post("/api/webhooks/payment", async (req, res) => {
  if (!config.paymentWebhookSecret) {
    return res.status(503).json({ error: "webhook_disabled" });
  }
  const sec = req.headers["x-webhook-secret"];
  if (sec !== config.paymentWebhookSecret) {
    return res.status(403).json({ error: "forbidden" });
  }
  const { telegramId, extendDays, planDays } = req.body || {};
  const days = Number(extendDays || planDays || 0);
  if (!telegramId || !Number.isFinite(days) || days < 1) {
    return res.status(400).json({ error: "bad_body" });
  }
  try {
    const tid = Number(telegramId);
    const users = await rw.getUsersByTelegramId(tid);
    const squads = config.remnawave.internalSquadUuids;
    if (!users.length) {
      const uname = rw.defaultUsernameFromTelegramId(tid);
      const expireAt = rw.addDaysIso(days);
      await rw.createUser({
        username: uname,
        expireAtIso: expireAt,
        telegramId: tid,
        activeInternalSquads: squads,
      });
    } else {
      await rw.bulkExtendExpiration([users[0].uuid], days);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const bot = new Bot(config.botToken);

bot.command("start", async (ctx) => {
  const kb = new InlineKeyboard().webApp("Р СџР С•Р Т‘Р С—Р С‘РЎРѓР С”Р В° VPN", config.webAppUrl);
  await ctx.reply("Р С›РЎвЂљР С”РЎР‚Р С•Р в„– Р СР С‘Р Р…Р С‘-Р С—РЎР‚Р С‘Р В»Р С•Р В¶Р ВµР Р…Р С‘Р Вµ: РЎвЂљР В°Р С РЎРѓРЎРѓРЎвЂ№Р В»Р С”Р В° Р Т‘Р В»РЎРЏ Happ/Р С”Р В»Р С‘Р ВµР Р…РЎвЂљР В° Р С‘ РЎРѓРЎвЂљР В°РЎвЂљРЎС“РЎРѓ Р С‘Р В· Remnawave.",
    { reply_markup: kb },
  );
});
app.use(whPath, webhookCallback(bot, "express", { secretToken: config.webhookSecret || undefined }));

app.use("/app", express.static(publicDir));
app.get(["/app", "/app/"], (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});
app.get(/^\/app\/.*/, (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.listen(config.port, async () => {
  console.log(`http://127.0.0.1:${config.port}`);
  const base = config.publicBaseUrl?.replace(/\/$/, "");
  if (base) {
    const url = `${base}${whPath}`;
    const extra = config.webhookSecret ? { secret_token: config.webhookSecret } : {};
    await bot.api.setWebhook(url, extra);
    console.log("Telegram webhook ->", url);
  } else {
    console.log("PUBLIC_BASE_URL not set, using long polling");
    await bot.api.deleteWebhook({ drop_pending_updates: true });
    bot.start();
  }
});