import { NS, LEGACY_FILENAME } from "./storage/namespaces.js";
import { readDocument, writeDocument } from "./storage/jsonDocumentBackend.js";

async function readJson() {
  return readDocument(NS.BALANCE, LEGACY_FILENAME[NS.BALANCE]);
}

async function writeJson(obj) {
  await writeDocument(NS.BALANCE, LEGACY_FILENAME[NS.BALANCE], obj);
}

/**
 * Почасовое списание с баланса начинается только после первого пополнения
 * (ставится billingStartedAt), чтобы не «обнулить» уже подключённых пользователей.
 */
export async function applyHourlyDeduction(telegramId, hourlyRateMinor) {
  const tid = String(telegramId);
  const rate = Math.max(1, Math.floor(Number(hourlyRateMinor) || 1));
  const db = await readJson();
  const rec = db[tid];
  if (!rec?.billingStartedAt) {
    return {
      billingActive: false,
      balanceMinor: Number(rec?.balanceMinor || 0),
      hourlyRateMinor: rate,
      depleted: false,
      justDepleted: false,
    };
  }

  // Dev override: do not charge while freeMode is enabled.
  if (rec?.freeMode === true) {
    const bal = Number(rec?.balanceMinor || 0);
    return {
      billingActive: true,
      balanceMinor: bal,
      hourlyRateMinor: rate,
      depleted: bal <= 0,
      justDepleted: false,
      freeMode: true,
    };
  }

  const now = Date.now();
  const last = Number(rec.lastAccruedMs || rec.billingStartedAt);
  const elapsedMs = Math.max(0, now - last);
  const hours = elapsedMs / 3_600_000;
  const charge = Math.floor(hours * rate);
  const prevBal = Number(rec.balanceMinor || 0);

  if (charge <= 0) {
    return {
      billingActive: true,
      balanceMinor: prevBal,
      hourlyRateMinor: rate,
      depleted: prevBal <= 0,
      justDepleted: false,
    };
  }

  const newBal = Math.max(0, prevBal - charge);
  rec.balanceMinor = newBal;
  rec.lastAccruedMs = now;
  if (newBal <= 0) {
    rec.suspendedForBilling = true;
  }
  db[tid] = rec;
  await writeJson(db);

  return {
    billingActive: true,
    balanceMinor: newBal,
    hourlyRateMinor: rate,
    depleted: newBal <= 0,
    justDepleted: prevBal > 0 && newBal <= 0,
  };
}

export async function credit(telegramId, amountMinor) {
  const tid = String(telegramId);
  const add = Math.max(0, Math.floor(Number(amountMinor) || 0));
  const db = await readJson();
  const now = Date.now();
  const rec = db[tid] || { balanceMinor: 0 };
  if (!rec.billingStartedAt) {
    rec.billingStartedAt = now;
    rec.lastAccruedMs = now;
  }
  rec.balanceMinor = Number(rec.balanceMinor || 0) + add;
  if (rec.balanceMinor > 0) {
    rec.suspendedForBilling = false;
  }
  db[tid] = rec;
  await writeJson(db);
  return rec;
}

export async function getRecord(telegramId) {
  const db = await readJson();
  return db[String(telegramId)] || null;
}

/** Снимок без списания (клиент не ACTIVE или биллинг выключен). */
export async function getDisplaySnapshot(telegramId, hourlyRateMinor) {
  const db = await readJson();
  const rec = db[String(telegramId)];
  const rate = Math.max(1, Math.floor(Number(hourlyRateMinor) || 1));
  const bal = Number(rec?.balanceMinor || 0);
  return {
    billingActive: Boolean(rec?.billingStartedAt),
    balanceMinor: bal,
    hourlyRateMinor: rate,
    depleted: bal <= 0 && Boolean(rec?.billingStartedAt),
    justDepleted: false,
    freeMode: rec?.freeMode === true,
  };
}

export async function clearSuspendedForBilling(telegramId) {
  const db = await readJson();
  const t = String(telegramId);
  if (!db[t]) return;
  db[t].suspendedForBilling = false;
  await writeJson(db);
}

export async function setFreeMode(telegramId, enabled) {
  const db = await readJson();
  const t = String(telegramId);
  const rec = db[t] || { balanceMinor: 0 };
  rec.freeMode = Boolean(enabled);
  db[t] = rec;
  await writeJson(db);
  return rec;
}

/** Все Telegram ID из балансового хранилища (для джоб / свипов). */
export async function listTelegramIds() {
  const db = await readJson();
  const out = [];
  for (const k of Object.keys(db || {})) {
    const n = Number(k);
    if (Number.isFinite(n) && n > 0) out.push(n);
  }
  return out.sort((a, b) => a - b);
}
