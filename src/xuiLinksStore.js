import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

const dataDir = path.join(process.cwd(), "data");
const filePath = path.join(dataDir, "xui-links.json");

async function ensureDir() {
  await fs.mkdir(dataDir, { recursive: true });
}

async function readJson() {
  await ensureDir();
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const obj = JSON.parse(raw || "{}");
    if (!obj || typeof obj !== "object") return {};
    return obj;
  } catch (e) {
    if (e && e.code === "ENOENT") return {};
    throw e;
  }
}

async function writeJson(obj) {
  await ensureDir();
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(obj, null, 2), "utf8");
  await fs.rename(tmp, filePath);
}

function normalizeUrlOrToken(input) {
  const raw = String(input || "").trim();
  if (!raw) return { ok: false, error: "empty" };

  // Accept full URL from 3X-UI (preferred)
  if (/^https?:\/\//i.test(raw)) {
    return { ok: true, kind: "url", value: raw };
  }

  // Accept raw token (sub id). We don't know the host here, so store as token.
  // Later it can be resolved if XUI_BASE_URL is set.
  if (/^[A-Za-z0-9_-]{6,}$/i.test(raw)) {
    return { ok: true, kind: "token", value: raw };
  }

  // Accept ".../sub/<id>" pasted without protocol
  const m = raw.match(/\/sub\/([^/?#]+)/i);
  if (m?.[1]) return { ok: true, kind: "token", value: m[1] };

  return { ok: false, error: "bad_format" };
}

function newPublicToken() {
  return crypto.randomBytes(16).toString("hex");
}

export async function linkXuiSubscription({ telegramId, xuiUrlOrToken }) {
  const v = normalizeUrlOrToken(xuiUrlOrToken);
  if (!v.ok) throw new Error(v.error);

  const db = await readJson();
  const tid = String(telegramId);
  const existing = db[tid] || null;
  const publicToken = existing?.publicToken || newPublicToken();

  db[tid] = {
    telegramId: tid,
    publicToken,
    kind: v.kind,
    value: v.value,
    updatedAt: new Date().toISOString(),
  };
  await writeJson(db);
  return db[tid];
}

export async function unlinkXuiSubscription({ telegramId }) {
  const db = await readJson();
  const tid = String(telegramId);
  const existed = Boolean(db[tid]);
  if (existed) {
    delete db[tid];
    await writeJson(db);
  }
  return { existed };
}

export async function getXuiLinkByTelegramId(telegramId) {
  const db = await readJson();
  return db[String(telegramId)] || null;
}

export async function getXuiLinkByPublicToken(publicToken) {
  const db = await readJson();
  const token = String(publicToken || "").trim();
  if (!token) return null;
  for (const tid of Object.keys(db)) {
    if (db[tid]?.publicToken === token) return db[tid];
  }
  return null;
}

