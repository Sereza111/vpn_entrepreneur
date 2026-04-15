import "dotenv/config";

const baseUrl = String(process.env.NOCOBASE_BASE_URL || "").replace(/\/$/, "");
const token = String(process.env.NOCOBASE_API_TOKEN || "").trim();

if (!baseUrl || !token) {
  console.error("NOCOBASE_BASE_URL/NOCOBASE_API_TOKEN are required.");
  process.exit(2);
}

const required = {
  customers: ["telegramId", "username", "segment", "lastSeenAt"],
  orders: [
    "telegramId",
    "status",
    "extendDays",
    "amount",
    "feeAmount",
    "netAmount",
    "serverId",
    "productCode",
    "paidAt",
  ],
  proxy_instances: ["telegramId", "serverId", "country", "username", "issuedAt"],
  infra_costs: ["role", "serverId", "currency", "amount", "period", "effectiveFrom"],
};

async function nb(path, body = null) {
  const url = `${baseUrl}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(`${path} -> ${res.status}`);
    err.payload = json;
    throw err;
  }
  return json;
}

function rowsFrom(json) {
  if (Array.isArray(json?.data)) return json.data;
  if (Array.isArray(json?.data?.data)) return json.data.data;
  if (Array.isArray(json?.records)) return json.records;
  return [];
}

let hardFail = false;
for (const [collection, fields] of Object.entries(required)) {
  try {
    const json = await nb(`/api/${collection}:list`, { page: 1, pageSize: 200 });
    const rows = rowsFrom(json);
    if (!rows.length) {
      console.log(`WARN ${collection}: no rows yet; cannot validate field presence from data sample.`);
      continue;
    }

    const known = new Set();
    for (const row of rows) {
      Object.keys(row || {}).forEach((k) => known.add(String(k)));
    }

    const missing = fields.filter((f) => !known.has(f));
    if (missing.length) {
      hardFail = true;
      console.log(`FAIL ${collection}: missing fields in sampled data -> ${missing.join(", ")}`);
    } else {
      console.log(`OK   ${collection}: fields look good.`);
    }
  } catch (e) {
    hardFail = true;
    const details = JSON.stringify(e?.payload || e?.message || e).slice(0, 400);
    console.log(`FAIL ${collection}: ${details}`);
  }
}

if (hardFail) {
  console.error("Analytics schema check failed.");
  process.exit(1);
}

console.log("Analytics schema check passed.");
