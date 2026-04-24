import crypto from "crypto";
import { config } from "./config.js";

function authHeader() {
  const shopId = String(config.yookassa.shopId || "").trim();
  const secretKey = String(config.yookassa.secretKey || "").trim();
  if (!shopId || !secretKey) throw new Error("yookassa_not_configured");
  const token = Buffer.from(`${shopId}:${secretKey}`).toString("base64");
  return `Basic ${token}`;
}

async function ykFetch(path, { method = "GET", body, idemKey } = {}) {
  const url = `${config.yookassa.apiBaseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = {
    Authorization: authHeader(),
    Accept: "application/json",
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (idemKey) headers["Idempotence-Key"] = idemKey;
  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text().catch(() => "");
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    throw new Error(`yookassa_${method.toLowerCase()}_${path}:${res.status}:${text || "failed"}`);
  }
  return json || {};
}

export async function createRedirectPayment({
  amountMinor,
  description,
  returnUrl,
  paymentMethodType = null,
  metadata = {},
}) {
  const value = (Math.max(1, Math.floor(Number(amountMinor) || 0)) / 100).toFixed(2);
  const body = {
    amount: { value, currency: "RUB" },
    confirmation: {
      type: "redirect",
      return_url: String(returnUrl || config.yookassa.returnUrl || "").trim(),
    },
    capture: true,
    description: String(description || "").slice(0, 128),
    metadata: metadata && typeof metadata === "object" ? metadata : {},
  };
  if (paymentMethodType) {
    body.payment_method_data = { type: String(paymentMethodType).trim() };
  }
  const idem = crypto.randomUUID();
  return await ykFetch("/v3/payments", { method: "POST", body, idemKey: idem });
}

export async function getPayment(paymentId) {
  const id = String(paymentId || "").trim();
  if (!id) throw new Error("yookassa_payment_id_required");
  return await ykFetch(`/v3/payments/${encodeURIComponent(id)}`, { method: "GET" });
}

