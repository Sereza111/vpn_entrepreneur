import { NS, LEGACY_FILENAME } from "./storage/namespaces.js";
import { readDocument, writeDocument } from "./storage/jsonDocumentBackend.js";

const MAX_PAYLOADS = 3000;
const MAX_DEDUP = 8000;
const PAYLOAD_TTL_MS = 24 * 60 * 60 * 1000;
const DEDUP_TTL_MS = 3 * 24 * 60 * 60 * 1000;

async function readJson() {
  return readDocument(NS.RUNTIME_STATE, LEGACY_FILENAME[NS.RUNTIME_STATE]);
}

async function writeJson(obj) {
  await writeDocument(NS.RUNTIME_STATE, LEGACY_FILENAME[NS.RUNTIME_STATE], obj);
}

function nowIso() {
  return new Date().toISOString();
}

function keepNewestEntries(mapObj, maxEntries) {
  const entries = Object.entries(mapObj || {});
  if (entries.length <= maxEntries) return mapObj || {};
  entries.sort((a, b) => String(a[1]?.at || "").localeCompare(String(b[1]?.at || "")));
  const drop = entries.length - maxEntries;
  const out = { ...(mapObj || {}) };
  for (const [k] of entries.slice(0, drop)) delete out[k];
  return out;
}

export async function savePaymentPayload(data) {
  const db = await readJson();
  const payloads = db.payloads && typeof db.payloads === "object" ? db.payloads : {};
  const id = `p:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  payloads[id] = { at: nowIso(), data };
  db.payloads = keepNewestEntries(payloads, MAX_PAYLOADS);
  await writeJson(db);
  return id;
}

export async function getPaymentPayload(id) {
  const key = String(id || "").trim();
  if (!key) return null;
  const db = await readJson();
  const payloads = db.payloads && typeof db.payloads === "object" ? db.payloads : {};
  const row = payloads[key];
  if (!row || typeof row !== "object") return null;
  const atMs = Date.parse(String(row.at || ""));
  if (Number.isFinite(atMs) && Date.now() - atMs > PAYLOAD_TTL_MS) {
    delete payloads[key];
    db.payloads = payloads;
    await writeJson(db);
    return null;
  }
  return row.data && typeof row.data === "object" ? row.data : null;
}

export async function wasPaymentDedupProcessed(keyRaw) {
  const key = String(keyRaw || "").trim();
  if (!key) return false;
  const db = await readJson();
  const dedup = db.paymentDedup && typeof db.paymentDedup === "object" ? db.paymentDedup : {};
  const row = dedup[key];
  if (!row || typeof row !== "object") return false;
  const atMs = Date.parse(String(row.at || ""));
  if (Number.isFinite(atMs) && Date.now() - atMs > DEDUP_TTL_MS) return false;
  return true;
}

export async function markPaymentDedupProcessed(keyRaw, meta = {}) {
  const key = String(keyRaw || "").trim();
  if (!key) return;
  const db = await readJson();
  const dedup = db.paymentDedup && typeof db.paymentDedup === "object" ? db.paymentDedup : {};
  dedup[key] = { at: nowIso(), ...meta };
  db.paymentDedup = keepNewestEntries(dedup, MAX_DEDUP);
  await writeJson(db);
}

export async function clearPaymentDedup(keyRaw) {
  const key = String(keyRaw || "").trim();
  if (!key) return;
  const db = await readJson();
  const dedup = db.paymentDedup && typeof db.paymentDedup === "object" ? db.paymentDedup : {};
  if (Object.prototype.hasOwnProperty.call(dedup, key)) {
    delete dedup[key];
    db.paymentDedup = dedup;
    await writeJson(db);
  }
}
