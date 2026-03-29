import crypto from "crypto";
import { config } from "./config.js";

const MAX_AUTH_AGE_SEC = 86400;

export function validateWebAppInitData(initDataRaw) {
  if (!initDataRaw || typeof initDataRaw !== "string") {
    return { ok: false, error: "no_init_data" };
  }
  const params = new URLSearchParams(initDataRaw);
  const hash = params.get("hash");
  if (!hash) return { ok: false, error: "no_hash" };
  params.delete("hash");

  const pairs = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  const dataCheckString = pairs.map(([k, v]) => `${k}=${v}`).join("\n");

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(config.botToken)
    .digest();

  const calculated = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  if (calculated !== hash) {
    return { ok: false, error: "bad_hash" };
  }

  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate)) {
    return { ok: false, error: "bad_auth_date" };
  }
  const age = Math.floor(Date.now() / 1000) - authDate;
  if (age > MAX_AUTH_AGE_SEC || age < -60) {
    return { ok: false, error: "auth_expired" };
  }

  const userJson = params.get("user");
  let user;
  try {
    user = userJson ? JSON.parse(userJson) : null;
  } catch {
    return { ok: false, error: "bad_user_json" };
  }
  if (!user || typeof user.id !== "number") {
    return { ok: false, error: "no_user" };
  }
  return { ok: true, user };
}
