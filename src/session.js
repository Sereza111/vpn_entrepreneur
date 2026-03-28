import jwt from "jsonwebtoken";
import { config } from "./config.js";

export function signSession({ telegramId, username }) {
  return jwt.sign(
    { tg: telegramId, u: username || null },
    config.sessionJwtSecret,
    { expiresIn: "7d", subject: String(telegramId) },
  );
}

export function verifySession(token) {
  return jwt.verify(token, config.sessionJwtSecret);
}