/**
 * Создаёт строки в app_kv с пустыми {} для всех неймспейсов (если ещё нет).
 * Не перетирает уже записанные данные.
 *
 * Usage: npm run db:seed-kv
 * Env: те же DB_* / DATABASE_URL, что у бота.
 */
import "dotenv/config";
import { runMysqlMigrations } from "./migrate.js";
import { getMysqlPool, mysqlPoolReady } from "./pool.js";
import { NS } from "../storage/namespaces.js";

async function main() {
  if (!mysqlPoolReady()) {
    console.error("[seed-kv] MySQL не настроен (нужны DB_HOST + DB_USER + DB_NAME или DATABASE_URL)");
    process.exitCode = 1;
    return;
  }
  await runMysqlMigrations();
  const p = getMysqlPool();
  const list = Object.values(NS);
  const placeholders = list.map(() => "(?, '{}')").join(",\n  ");
  const params = list.flatMap((ns) => [ns]);
  const sql = `INSERT IGNORE INTO app_kv (namespace, payload_json) VALUES\n  ${placeholders}`;
  await p.query(sql, params);
  const [rows] = await p.query("SELECT namespace, LENGTH(payload_json) AS len FROM app_kv ORDER BY namespace");
  console.log("[seed-kv] ok, строк в app_kv:", rows?.length || 0);
  for (const r of rows || []) console.log(`  ${r.namespace} (len=${r.len})`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
