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
  sessionJwtExpiresIn: String(process.env.SESSION_JWT_EXPIRES_IN || "7d").trim() || "7d",
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
    // Optional extra subscription hosts used when link is stored as token (subId).
    // Comma-separated URLs, example: "https://ru.example.com:2096,https://nl.example.com:2096"
    extraBaseUrls: String(process.env.XUI_EXTRA_BASE_URLS || "")
      .split(",")
      .map((s) => s.trim().replace(/\/$/, ""))
      .filter(Boolean),
    insecureTls:
      String(process.env.XUI_INSECURE_TLS || "").toLowerCase() === "1" ||
      String(process.env.XUI_INSECURE_TLS || "").toLowerCase() === "true",
    /** Шаблон имени узла в клиенте подписки (фрагмент после # в VLESS). Плейсхолдеры: {subscriptionTitle} {telegramId} {username} */
    clientRemarkTemplate: (process.env.XUI_CLIENT_REMARK_TEMPLATE || "").trim(),
    /** В некоторых клиентах имя узла = remark-email. Здесь можно задать красивый суффикс (например 🇷🇺). */
    clientDisplaySuffix: String(process.env.XUI_CLIENT_DISPLAY_SUFFIX || "🌐").trim(),
  },
  xuiSecondary: {
    enabled:
      String(process.env.XUI_SECONDARY_ENABLED || "").toLowerCase() === "1" ||
      String(process.env.XUI_SECONDARY_ENABLED || "").toLowerCase() === "true",
    panelBaseUrl: (process.env.XUI_SECONDARY_PANEL_BASE_URL || "").replace(/\/$/, ""),
    webBasePath: String(process.env.XUI_SECONDARY_WEB_BASE_PATH || "").trim(),
    username: process.env.XUI_SECONDARY_USERNAME || "",
    password: process.env.XUI_SECONDARY_PASSWORD || "",
    inboundId: Number(process.env.XUI_SECONDARY_INBOUND_ID || 0),
    remarkPrefix: String(process.env.XUI_SECONDARY_REMARK_PREFIX || "🇳🇱 ").trim(),
    insecureTls:
      String(process.env.XUI_SECONDARY_INSECURE_TLS || "").toLowerCase() === "1" ||
      String(process.env.XUI_SECONDARY_INSECURE_TLS || "").toLowerCase() === "true",
  },
  proxy: {
    serversJson: process.env.PROXY_SERVERS_JSON || "[]",
  },
  paymentWebhookSecret: process.env.PAYMENT_WEBHOOK_SECRET || "",
  /**
   * Внутренний баланс + почасовое списание за VPN (после первого пополнения).
   * Ставка по умолчанию: цена vps_7 за неделю / (7*24) в копейках/час.
   */
  balance: {
    billingEnabled:
      String(process.env.BALANCE_BILLING_ENABLED || "").toLowerCase() === "1" ||
      String(process.env.BALANCE_BILLING_ENABLED || "").toLowerCase() === "true",
    hourlyRateMinor: Math.max(
      1,
      Number(
        process.env.BALANCE_VPS_HOURLY_MINOR ||
          Math.ceil(2500 / (7 * 24)),
      ),
    ),
  },
  /** Шаблон URL оплаты для мини-аппа: плейсхолдеры {telegramId} {productCode} {grantDays} {username} */
  payment: {
    mode: (process.env.TG_PAYMENT_MODE || "prod").trim().toLowerCase() === "test"
      ? "test"
      : "prod",
    checkoutUrlTemplate: (process.env.PAYMENT_CHECKOUT_URL_TEMPLATE || "").trim(),
    defaultProductCode: (process.env.PAYMENT_DEFAULT_PRODUCT_CODE || "vps_30").trim(),
    telegramProviderToken: (process.env.TG_PAYMENT_PROVIDER_TOKEN || "").trim(),
    telegramCurrency: (process.env.TG_PAYMENT_CURRENCY || "RUB").trim().toUpperCase(),
    telegramTestPriceMinor: Math.max(1, Number(process.env.TG_PAYMENT_TEST_PRICE_MINOR || 9900)),
    telegramTestDays: Math.max(1, Number(process.env.TG_PAYMENT_TEST_DAYS || 30)),
    telegramTestProductCode: (process.env.TG_PAYMENT_TEST_PRODUCT_CODE || "vps_30").trim(),
    telegramTestTitle: (process.env.TG_PAYMENT_TEST_TITLE || "VPS Premium — тестовый платёж").trim(),
    telegramTestDescription: (
      process.env.TG_PAYMENT_TEST_DESCRIPTION ||
      "Тестовая оплата доступа к VPS Premium через Telegram Payments"
    ).trim(),
    priceMapJson: String(process.env.TG_PAYMENT_PRICE_MAP_JSON || "").trim(),
    /**
     * Минимальная сумма одного счёта Telegram Payments в **основных единицах валюты** (для RUB — рубли).
     * У ЮKassa/Telegram для RUB часто ~60 ₽; иначе sendInvoice даёт CURRENCY_TOTAL_AMOUNT_INVALID.
     * Переопределение: TG_PAYMENT_MIN_INVOICE_AMOUNT=60
     */
    telegramMinInvoiceAmountMajor: Math.max(
      1,
      Math.floor(
        Number(
          process.env.TG_PAYMENT_MIN_INVOICE_AMOUNT ??
            (String(process.env.TG_PAYMENT_CURRENCY || "RUB").trim().toUpperCase() === "RUB"
              ? 60
              : 1),
        ) || 1,
      ),
    ),
  },
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
      subscriptionBranding:
        process.env.NOCOBASE_COLLECTION_SUBSCRIPTION_BRANDING ||
        "subscription_branding",
    },
  },
};