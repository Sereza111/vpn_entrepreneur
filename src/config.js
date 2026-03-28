import "dotenv/config";

function req(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || "development",
  botToken: req("BOT_TOKEN"),
  webAppUrl: req("WEB_APP_URL"),
  publicBaseUrl: process.env.PUBLIC_BASE_URL || "",
  webhookSecret: process.env.WEBHOOK_SECRET || "",
  sessionJwtSecret: req("SESSION_JWT_SECRET"),
  remnawave: {
    baseUrl: process.env.REMNAWAVE_BASE_URL?.replace(/\/$/, "") || "",
    accessToken: process.env.REMNAWAVE_ACCESS_TOKEN || "",
    username: process.env.REMNAWAVE_USERNAME || "",
    password: process.env.REMNAWAVE_PASSWORD || "",
    internalSquadUuids: (process.env.REMNAWAVE_INTERNAL_SQUAD_UUIDS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    defaultTrafficLimitBytes: Number(
      process.env.REMNAWAVE_DEFAULT_TRAFFIC_LIMIT_BYTES ?? "0",
    ),
  },
  paymentWebhookSecret: process.env.PAYMENT_WEBHOOK_SECRET || "",
  corsOrigin: process.env.CORS_ORIGIN || "",
};

if (!config.remnawave.baseUrl) {
  throw new Error("Missing REMNAWAVE_BASE_URL");
}

if (
  !config.remnawave.accessToken &&
  (!config.remnawave.username || !config.remnawave.password)
) {
  throw new Error(
    "Set REMNAWAVE_ACCESS_TOKEN or REMNAWAVE_USERNAME + REMNAWAVE_PASSWORD",
  );
}