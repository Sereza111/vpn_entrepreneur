import fs from "fs/promises";
import path from "path";

const dataDir = path.join(process.cwd(), "data");
const filePath = path.join(dataDir, "proxy-links.json");

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

export async function getProxyByTelegramId(telegramId) {
  const db = await readJson();
  return db[String(telegramId)] || null;
}

export async function setProxyForTelegramId(telegramId, payload) {
  const db = await readJson();
  db[String(telegramId)] = {
    telegramId: String(telegramId),
    ...payload,
    updatedAt: new Date().toISOString(),
  };
  await writeJson(db);
  return db[String(telegramId)];
}

