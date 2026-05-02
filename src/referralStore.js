import { NS, LEGACY_FILENAME } from "./storage/namespaces.js";
import { readDocument, writeDocument } from "./storage/jsonDocumentBackend.js";

async function readJson() {
  return readDocument(NS.REFERRALS, LEGACY_FILENAME[NS.REFERRALS]);
}

async function writeJson(obj) {
  await writeDocument(NS.REFERRALS, LEGACY_FILENAME[NS.REFERRALS], obj);
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
