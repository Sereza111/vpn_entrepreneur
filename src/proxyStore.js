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
  const rec = db[String(telegramId)] || null;
  if (!rec) return null;
  // Backward compat: migrate single proxy fields to list.
  if (rec.username && rec.password && rec.serverId && !Array.isArray(rec.items)) {
    return {
      telegramId: String(telegramId),
      credits: { total: 1, used: 1 },
      items: [
        {
          id: `p_${Date.now()}`,
          serverId: rec.serverId,
          country: rec.country || "",
          username: rec.username,
          password: rec.password,
          createdAt: rec.createdAt || rec.updatedAt || new Date().toISOString(),
          expiresAt: null,
        },
      ],
      updatedAt: rec.updatedAt || new Date().toISOString(),
    };
  }
  return rec;
}

function normalizeAddons(obj) {
  const a = obj && typeof obj === "object" ? obj : {};
  return {
    proxyEnabled: Boolean(a.proxyEnabled),
    dedicatedIpEnabled: Boolean(a.dedicatedIpEnabled),
  };
}

export async function setProxyForTelegramId(telegramId, payload) {
  const db = await readJson();
  const addons = normalizeAddons(payload?.addons || payload?.addOns || payload?.addon);
  db[String(telegramId)] = {
    telegramId: String(telegramId),
    ...payload,
    addons,
    updatedAt: new Date().toISOString(),
  };
  await writeJson(db);
  return db[String(telegramId)];
}

export async function grantProxyCredits({ telegramId, addCount, days }) {
  const rec = (await getProxyByTelegramId(telegramId)) || {
    telegramId: String(telegramId),
    credits: { total: 0, used: 0 },
    items: [],
  };
  const n = Number(addCount || 0);
  if (!Number.isFinite(n) || n < 1) throw new Error("bad_count");
  const d = Number(days || 0);
  const expiresAt = d > 0 ? new Date(Date.now() + d * 86400_000).toISOString() : null;
  rec.credits = rec.credits || { total: 0, used: 0 };
  rec.credits.total = Number(rec.credits.total || 0) + n;
  rec.creditExpiresAt = expiresAt;
  return await setProxyForTelegramId(telegramId, rec);
}

export function computeProxyRemaining(rec) {
  if (!rec?.credits) return 0;
  const total = Number(rec.credits.total || 0);
  const used = Number(rec.credits.used || 0);
  return Math.max(0, total - used);
}

export async function addProxyItem({ telegramId, item }) {
  const rec = (await getProxyByTelegramId(telegramId)) || {
    telegramId: String(telegramId),
    credits: { total: 0, used: 0 },
    items: [],
  };
  rec.items = Array.isArray(rec.items) ? rec.items : [];
  rec.credits = rec.credits || { total: 0, used: 0 };
  rec.items.push(item);
  rec.credits.used = Number(rec.credits.used || 0) + 1;
  return await setProxyForTelegramId(telegramId, rec);
}

export async function removeProxyItem({ telegramId, itemId, itemIndex }) {
  const rec = (await getProxyByTelegramId(telegramId)) || {
    telegramId: String(telegramId),
    credits: { total: 0, used: 0 },
    items: [],
  };
  const items = Array.isArray(rec.items) ? rec.items : [];
  if (!items.length) throw new Error("proxy_item_not_found");

  let idx = -1;
  if (itemId) {
    idx = items.findIndex((x) => String(x?.id || "") === String(itemId));
  }
  if (idx < 0 && Number.isFinite(Number(itemIndex))) {
    const n = Number(itemIndex);
    if (n >= 0 && n < items.length) idx = n;
  }
  if (idx < 0) throw new Error("proxy_item_not_found");

  const removed = items[idx];
  rec.items = items.filter((_, i) => i !== idx);
  // Keep used in sync with actual amount of issued proxy entries.
  rec.credits = rec.credits || { total: 0, used: 0 };
  rec.credits.used = rec.items.length;
  const saved = await setProxyForTelegramId(telegramId, rec);
  return { rec: saved, removed };
}

export async function setProxyAddons({ telegramId, proxyEnabled, dedicatedIpEnabled }) {
  const rec = (await getProxyByTelegramId(telegramId)) || {
    telegramId: String(telegramId),
    credits: { total: 0, used: 0 },
    items: [],
  };
  rec.addons = normalizeAddons({
    proxyEnabled: proxyEnabled ?? rec.addons?.proxyEnabled,
    dedicatedIpEnabled: dedicatedIpEnabled ?? rec.addons?.dedicatedIpEnabled,
  });
  return await setProxyForTelegramId(telegramId, rec);
}

