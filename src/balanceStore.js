import fs from "fs/promises";
import path from "path";

const dataDir = path.join(process.cwd(), "data");
const filePath = path.join(dataDir, "balance.json");

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
  };
}

export async function clearSuspendedForBilling(telegramId) {
  const db = await readJson();
  const t = String(telegramId);
  if (!db[t]) return;
  db[t].suspendedForBilling = false;
  await writeJson(db);
}
