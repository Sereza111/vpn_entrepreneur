import { NS, LEGACY_FILENAME } from "../storage/namespaces.js";
import { readDocument } from "../storage/jsonDocumentBackend.js";

const ACCUM_NAMESPACES = [
  NS.BALANCE,
  NS.XUI_LINKS,
  NS.PROXY_LINKS,
  NS.REFERRALS,
];

/**
 * Собирает числовые Telegram ID из ключей основных JSON-документов (исключая payment-webhook,
 * там могут быть не-ID ключи).
 */
export async function collectKnownTelegramIds() {
  const ids = new Set();
  for (const ns of ACCUM_NAMESPACES) {
    const db = await readDocument(ns, LEGACY_FILENAME[ns]).catch(() => ({}));
    for (const k of Object.keys(db || {})) {
      const n = Number(k);
      if (Number.isFinite(n) && n > 0) ids.add(n);
    }
  }
  try {
    const pay = await readDocument(NS.PAYMENT_WEBHOOK, LEGACY_FILENAME[NS.PAYMENT_WEBHOOK]).catch(() => ({}));
    for (const k of Object.keys(pay || {})) {
      const n = Number(k);
      if (Number.isFinite(n) && n > 0) ids.add(n);
    }
  } catch {
    // ignore non-numeric payment keys
  }
  return [...ids].sort((a, b) => a - b);
}
