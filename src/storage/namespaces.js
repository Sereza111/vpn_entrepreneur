/** Корневые JSON-документы (один объект на файл/неймспейс). Соответствие legacy-именам файлов в ./data */
export const NS = {
  BALANCE: "balance",
  XUI_LINKS: "xui_links",
  PROXY_LINKS: "proxy_links",
  REFERRALS: "referrals",
  PAYMENT_WEBHOOK: "payment_webhook",
  RUNTIME_STATE: "runtime_state",
  ADMIN_CONFIG: "admin_config",
  NOTIFY_EXPIRING: "notify_expiring",
};

export const LEGACY_FILENAME = {
  [NS.BALANCE]: "balance.json",
  [NS.XUI_LINKS]: "xui-links.json",
  [NS.PROXY_LINKS]: "proxy-links.json",
  [NS.REFERRALS]: "referrals.json",
  [NS.PAYMENT_WEBHOOK]: "payment-webhook.json",
  [NS.RUNTIME_STATE]: "runtime-state.json",
  [NS.ADMIN_CONFIG]: "admin-config.json",
  [NS.NOTIFY_EXPIRING]: "notify-expiring.json",
};
