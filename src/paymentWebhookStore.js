import fs from "fs/promises";
import path from "path";

const dataDir = path.join(process.cwd(), "data");
const filePath = path.join(dataDir, "payment-webhook.json");

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

function normalizeKey(raw) {
  const k = String(raw || "").trim();
  if (!k) return "";
  return k.slice(0, 256);
}

export async function wasProcessed(externalKey) {
  const key = normalizeKey(externalKey);
  if (!key) return false;
  const db = await readJson();
  return Boolean(db[key]);
}

export async function markProcessed(externalKey, meta = {}) {
  const key = normalizeKey(externalKey);
  if (!key) return;
  const db = await readJson();
  db[key] = {
    at: new Date().toISOString(),
    ...meta,
  };
  // small cap: keep last ~5000 keys
  const keys = Object.keys(db);
  if (keys.length > 5200) {
    keys
      .sort((a, b) => String(db[a]?.at || "").localeCompare(String(db[b]?.at || "")))
      .slice(0, Math.max(0, keys.length - 5000))
      .forEach((k) => delete db[k]);
  }
  await writeJson(db);
}

