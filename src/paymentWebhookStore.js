import { NS, LEGACY_FILENAME } from "./storage/namespaces.js";
import { readDocument, writeDocument } from "./storage/jsonDocumentBackend.js";

async function readJson() {
  return readDocument(NS.PAYMENT_WEBHOOK, LEGACY_FILENAME[NS.PAYMENT_WEBHOOK]);
}

async function writeJson(obj) {
  await writeDocument(NS.PAYMENT_WEBHOOK, LEGACY_FILENAME[NS.PAYMENT_WEBHOOK], obj);
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
