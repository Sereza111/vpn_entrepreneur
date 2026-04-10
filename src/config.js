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
    primary: "xui",
  },
  xui: {
    // Base URL for 3X-UI subscription host (where /sub/<id> is served).
    // Example: https://your-3xui-domain:2096
    baseUrl: (process.env.XUI_BASE_URL || "").replace(/\/$/, ""),
    // Base URL for 3X-UI panel login/api (often same host as baseUrl).
    // Example: https://your-3xui-domain:2096
    panelBaseUrl: (process.env.XUI_PANEL_BASE_URL || "").replace(/\/$/, ""),
    // 3X-UI "Web Base Path" из настроек (например /8dFlsHsLZMTgKsrUhd/).
    // Если задан — к POST /login и /panel/api идём с XUI_PANEL_BASE_URL только как origin (https://ip:порт).
    webBasePath: String(process.env.XUI_WEB_BASE_PATH || "").trim(),
    username: process.env.XUI_USERNAME || "",
    password: process.env.XUI_PASSWORD || "",
    inboundId: Number(process.env.XUI_INBOUND_ID || 0),
    // Subscription path root on subscription host.
    // Usually "/sub" (or custom if you changed "Корневой путь URL-адреса подписки" in 3X-UI).
    subPath: process.env.XUI_SUB_PATH || "/sub",
    insecureTls:
      String(process.env.XUI_INSECURE_TLS || "").toLowerCase() === "1" ||
      String(process.env.XUI_INSECURE_TLS || "").toLowerCase() === "true",
  },
  proxy: {
    serversJson: process.env.PROXY_SERVERS_JSON || "[]",
  },
  paymentWebhookSecret: process.env.PAYMENT_WEBHOOK_SECRET || "",
  corsOrigin: process.env.CORS_ORIGIN || "",
  testGrantEnabled:
    String(process.env.TEST_GRANT_ENABLED || "").toLowerCase() === "1" ||
    String(process.env.TEST_GRANT_ENABLED || "").toLowerCase() === "true",
  nocobase: {
    baseUrl: (process.env.NOCOBASE_BASE_URL || "").replace(/\/$/, ""),
    apiToken: (process.env.NOCOBASE_API_TOKEN || "").trim(),
    account: (process.env.NOCOBASE_ACCOUNT || "").trim(),
    password: (process.env.NOCOBASE_PASSWORD || "").trim(),
    collections: {
      customers: process.env.NOCOBASE_COLLECTION_CUSTOMERS || "customers",
      orders: process.env.NOCOBASE_COLLECTION_ORDERS || "orders",
      products: process.env.NOCOBASE_COLLECTION_PRODUCTS || "products",
      proxyInstances:
        process.env.NOCOBASE_COLLECTION_PROXY_INSTANCES || "proxy_instances",
    },
  },
};