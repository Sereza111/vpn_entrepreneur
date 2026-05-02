/**
 * Одноразовый импорт legacy JSON из ./data в app_kv при включённом MySQL.
 */
import fs from "fs/promises";
import path from "path";
import "dotenv/config";
import { NS, LEGACY_FILENAME } from "../storage/namespaces.js";
import { runMysqlMigrations } from "./migrate.js";
import { getMysqlPool, mysqlPoolReady } from "./pool.js";
import { kvRepoAvailable, kvGetJson, kvSetJson } from "./appKvRepo.js";

const dataDir = path.join(process.cwd(), "data");

function safeParse(text) {
  try {
    const o = JSON.parse(String(text || "{}"));
    return o && typeof o === "object" ? o : {};
  } catch {
    return {};
  }
}

async function fsReadFallback(file) {
  const fp = path.join(dataDir, file);
  try {
    return safeParse(await fs.readFile(fp, "utf8"));
  } catch (e) {
    if (e && e.code === "ENOENT") return {};
    throw e;
  }
}

async function main() {
  if (!kvRepoAvailable()) {
    console.error("MySQL не настроен — задайте DB_HOST DB_USER DB_PASSWORD DB_NAME (или DATABASE_URL) и не ставьте DB_BACKEND=file.");
    process.exitCode = 1;
    return;
  }
  await runMysqlMigrations();
  const p = getMysqlPool();

  const pairs = Object.values(NS).map((ns) => [ns, LEGACY_FILENAME[ns]]);
  for (const [ns, fname] of pairs) {
    const merged = await fsReadFallback(fname);
    const kvCur = await kvGetJson(getMysqlPool(), ns);
    const existingKeys = Object.keys(kvCur || {});
    console.log(`[import] ${ns} (${fname}): file keys=${Object.keys(merged).length}, existingKvKeys=${existingKeys.length}`);
    if (existingKeys.length > 0 && process.argv.includes("--merge")) {
      const cur = { ...(kvCur && typeof kvCur === "object" ? kvCur : {}) };
      for (const [k, v] of Object.entries(merged)) {
        if (cur[k] == null) cur[k] = v;
      }
      await kvSetJson(p, ns, cur);
      console.log(`[import] merged ${ns} → ${Object.keys(cur).length} keys`);
    } else {
      await kvSetJson(p, ns, merged);
      console.log(`[import] wrote ${ns} → ${Object.keys(merged).length} keys`);
    }
  }
  console.log("[import] done");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
