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
  subscriptions: {
    // remnawave | xui
    primary: (process.env.PRIMARY_SUBSCRIPTION_SOURCE || "remnawave").toLowerCase(),
  },
  xui: {
    // Base URL for 3X-UI subscription host (where /sub/<id> is served).
    // Example: https://your-3xui-domain:2096
    baseUrl: (process.env.XUI_BASE_URL || "").replace(/\/$/, ""),
    // Base URL for 3X-UI panel login/api (often same host as baseUrl).
    // Example: https://your-3xui-domain:2096
    panelBaseUrl: (process.env.XUI_PANEL_BASE_URL || "").replace(/\/$/, ""),
    username: process.env.XUI_USERNAME || "",
    password: process.env.XUI_PASSWORD || "",
    inboundId: Number(process.env.XUI_INBOUND_ID || 0),
    insecureTls:
      String(process.env.XUI_INSECURE_TLS || "").toLowerCase() === "1" ||
      String(process.env.XUI_INSECURE_TLS || "").toLowerCase() === "true",
  },
  bypass: {
    // Optional extra subscription (e.g. from 3X-UI) that will be merged into Remnawave subscription.
    subscriptionUrl: process.env.BYPASS_SUBSCRIPTION_URL || "",
    insecureTls:
      String(process.env.BYPASS_INSECURE_TLS || "").toLowerCase() === "1" ||
      String(process.env.BYPASS_INSECURE_TLS || "").toLowerCase() === "true",
  },
  remnawave: {
    baseUrl: process.env.REMNAWAVE_BASE_URL?.replace(/\/$/, "") || "",
    accessToken: process.env.REMNAWAVE_ACCESS_TOKEN || "",
    // В твоём nginx на `panel...:8443` `/api/*` отдаётся только при наличии cookie
    // (см. nginx.conf map $http_cookie $auth_cookie / $authorized).
    // Если nginx не требует маскировку, оставь пустым.
    bypassCookie: process.env.REMNAWAVE_BYPASS_COOKIE || "",
    username: process.env.REMNAWAVE_USERNAME || "",
    password: process.env.REMNAWAVE_PASSWORD || "",
    internalSquadUuids: (process.env.REMNAWAVE_INTERNAL_SQUAD_UUIDS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    defaultTrafficLimitBytes: Number(
      process.env.REMNAWAVE_DEFAULT_TRAFFIC_LIMIT_BYTES ?? "0",
    ),
    defaultHwidDeviceLimit: Number(
      process.env.REMNAWAVE_DEFAULT_HWID_DEVICE_LIMIT ?? "2",
    ),
  },
  paymentWebhookSecret: process.env.PAYMENT_WEBHOOK_SECRET || "",
  corsOrigin: process.env.CORS_ORIGIN || "",
  testGrantEnabled:
    String(process.env.TEST_GRANT_ENABLED || "").toLowerCase() === "1" ||
    String(process.env.TEST_GRANT_ENABLED || "").toLowerCase() === "true",
};

if (!config.remnawave.baseUrl) {
  throw new Error("Missing REMNAWAVE_BASE_URL");
}

const looksLikeJwt = (s) =>
  /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/i.test(String(s).trim());
if (looksLikeJwt(config.remnawave.baseUrl)) {
  throw new Error(
    "REMNAWAVE_BASE_URL похож на JWT, а не на адрес API. Поменяй местами: в REMNAWAVE_BASE_URL укажи https://... (база HTTP API), токен — в REMNAWAVE_ACCESS_TOKEN.",
  );
}
if (!/^https?:\/\//i.test(config.remnawave.baseUrl)) {
  throw new Error(
    "REMNAWAVE_BASE_URL должен быть полным URL (https://host или http://host:port), без пробелов и без токена.",
  );
}

if (
  !config.remnawave.accessToken &&
  (!config.remnawave.username || !config.remnawave.password)
) {
  throw new Error(
    "Set REMNAWAVE_ACCESS_TOKEN or REMNAWAVE_USERNAME + REMNAWAVE_PASSWORD",
  );
}