import "dotenv/config";
import fs from "fs/promises";
import path from "path";

const baseUrl = String(process.env.NOCOBASE_BASE_URL || "").replace(/\/$/, "");
const token = String(process.env.NOCOBASE_API_TOKEN || "").trim();
const cwd = process.cwd();
const dataDir = path.join(cwd, "data");

if (!baseUrl || !token) {
  console.error("NOCOBASE_BASE_URL/NOCOBASE_API_TOKEN are required.");
  process.exit(2);
}

const dryRun = process.argv.includes("--dry-run");
const withDemoOrders = process.argv.includes("--with-demo-orders");

const demoDayOffsets = [90, 60, 30, 14, 7];
const demoSku = ["vpn_90", "vpn_30", "vpn_7", "proxy_nl1_30", "proxy_nl1_7"];

async function readJson(fileName) {
  try {
    const raw = await fs.readFile(path.join(dataDir, fileName), "utf8");
    const obj = JSON.parse(raw || "{}");
    return obj && typeof obj === "object" ? obj : {};
  } catch {
    return {};
  }
}

async function nb(pathName, body = null) {
  const url = `${baseUrl}${pathName}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new Error(`${pathName} -> ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
  }
  return json;
}

function rowsFrom(json) {
  if (Array.isArray(json?.data)) return json.data;
  if (Array.isArray(json?.data?.data)) return json.data.data;
  if (Array.isArray(json?.records)) return json.records;
  return [];
}

async function upsertCustomer({ telegramId, username = "" }) {
  const tid = Number(telegramId);
  if (!Number.isFinite(tid)) return false;

  const found = rowsFrom(
    await nb("/api/customers:list", { page: 1, pageSize: 5, filter: { telegramId: tid } }),
  );
  const existing = found.find((r) => Number(r.telegramId) === tid || String(r.telegramId) === String(tid));
  const values = {
    telegramId: tid,
    username: String(username || ""),
    segment: "unknown",
    lastSeenAt: new Date().toISOString(),
  };
  if (dryRun) return !existing;
  if (existing?.id != null) {
    await nb("/api/customers:update", { filterByTk: existing.id, values });
    return false;
  }
  await nb("/api/customers:create", { values });
  return true;
}

async function insertProxyItem({ telegramId, item }) {
  if (dryRun) return;
  await nb("/api/proxy_instances:create", {
    values: {
      telegramId: Number(telegramId),
      serverId: String(item.serverId || ""),
      country: String(item.country || ""),
      username: String(item.username || ""),
      passwordInNocobase: false,
      issuedAt: item.createdAt || item.updatedAt || new Date().toISOString(),
    },
  });
}

async function maybeInsertDemoOrders(telegramIds) {
  if (!withDemoOrders) return 0;
  let created = 0;
  for (const tid of telegramIds.slice(0, 12)) {
    for (let i = 0; i < demoDayOffsets.length; i += 1) {
      const daysAgo = demoDayOffsets[i];
      const paidAt = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
      const amount = i % 2 === 0 ? 299 : 499;
      const feeAmount = 9;
      const netAmount = amount - feeAmount;
      const externalPaymentId = `backfill-demo-${tid}-${daysAgo}`;
      if (!dryRun) {
        await nb("/api/orders:create", {
          values: {
            telegramId: Number(tid),
            status: "paid",
            extendDays: daysAgo >= 30 ? 30 : 7,
            addDeviceSlots: 0,
            amount,
            feeAmount,
            netAmount,
            currency: "RUB",
            productCode: demoSku[i] || "vpn_30",
            paidAt,
            source: "backfill_local_demo",
            externalPaymentId,
          },
        });
      }
      created += 1;
    }
  }
  return created;
}

const xui = await readJson("xui-links.json");
const proxy = await readJson("proxy-links.json");
const ids = new Set([...Object.keys(xui || {}), ...Object.keys(proxy || {})].map((v) => String(v).trim()).filter(Boolean));

let createdCustomers = 0;
for (const tid of ids) {
  const rec = proxy?.[tid] || xui?.[tid] || {};
  const username = rec?.username || "";
  const isNew = await upsertCustomer({ telegramId: tid, username });
  if (isNew) createdCustomers += 1;
}

let createdProxyRows = 0;
for (const [tid, rec] of Object.entries(proxy || {})) {
  const items = Array.isArray(rec?.items) ? rec.items : [];
  for (const item of items) {
    await insertProxyItem({ telegramId: tid, item });
    createdProxyRows += 1;
  }
}

const demoOrders = await maybeInsertDemoOrders([...ids]);
console.log(
  JSON.stringify(
    {
      ok: true,
      dryRun,
      withDemoOrders,
      distinctUsers: ids.size,
      createdCustomers,
      createdProxyRows,
      createdDemoOrders: demoOrders,
    },
    null,
    2,
  ),
);
