import fs from "fs/promises";
import path from "path";

const dataDir = path.join(process.cwd(), "data");
const filePath = path.join(dataDir, "referrals.json");

async function ensureDir() {
  await fs.mkdir(dataDir, { recursive: true });
}

function safeParseDbJson(raw) {
  const src = String(raw || "").trim();
  if (!src) return {};
  try {
    const obj = JSON.parse(src);
    return obj && typeof obj === "object" ? obj : {};
  } catch {
    return {};
  }
}

async function readJson() {
  await ensureDir();
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return safeParseDbJson(raw);
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

export async function bindInviterIfEmpty({ inviteeTelegramId, inviterTelegramId }) {
  const inviteeId = String(inviteeTelegramId || "").trim();
  const inviterId = String(inviterTelegramId || "").trim();
  if (!inviteeId || !inviterId || inviteeId === inviterId) return null;
  const db = await readJson();
  const rec = db[inviteeId] || null;
  if (rec?.inviterTelegramId) return rec;
  const next = {
    inviteeTelegramId: inviteeId,
    inviterTelegramId: inviterId,
    createdAt: new Date().toISOString(),
    qualifiedAt: null,
    rewardedAt: null,
    qualifyingPaymentMinor: 0,
    bonusMinor: 0,
  };
  db[inviteeId] = next;
  await writeJson(db);
  return next;
}

export async function getByInvitee(inviteeTelegramId) {
  const db = await readJson();
  return db[String(inviteeTelegramId || "").trim()] || null;
}

export async function markRewarded({
  inviteeTelegramId,
  qualifyingPaymentMinor,
  bonusMinor,
}) {
  const inviteeId = String(inviteeTelegramId || "").trim();
  if (!inviteeId) return null;
  const db = await readJson();
  const rec = db[inviteeId];
  if (!rec) return null;
  if (rec.rewardedAt) return rec;
  const now = new Date().toISOString();
  const next = {
    ...rec,
    qualifiedAt: rec.qualifiedAt || now,
    rewardedAt: now,
    qualifyingPaymentMinor: Math.max(0, Math.floor(Number(qualifyingPaymentMinor || 0))),
    bonusMinor: Math.max(0, Math.floor(Number(bonusMinor || 0))),
  };
  db[inviteeId] = next;
  await writeJson(db);
  return next;
}

export async function getInviterStats(inviterTelegramId) {
  const inviterId = String(inviterTelegramId || "").trim();
  if (!inviterId) {
    return { invitedTotal: 0, rewardedTotal: 0, rewardMinorTotal: 0 };
  }
  const db = await readJson();
  let invitedTotal = 0;
  let rewardedTotal = 0;
  let rewardMinorTotal = 0;
  for (const rec of Object.values(db)) {
    if (String(rec?.inviterTelegramId || "") !== inviterId) continue;
    invitedTotal++;
    if (rec?.rewardedAt) {
      rewardedTotal++;
      rewardMinorTotal += Math.max(0, Math.floor(Number(rec?.bonusMinor || 0)));
    }
  }
  return { invitedTotal, rewardedTotal, rewardMinorTotal };
}

