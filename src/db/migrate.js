import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { getMysqlPool, mysqlPoolReady } from "./pool.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function readMigrationFiles(dir) {
  let names = [];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  return names
    .filter((n) => n.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));
}

function stripSqlComments(sql) {
  return sql
    .split(/\r?\n/)
    .map((line) => (line.trim().startsWith("--") ? "" : line))
    .join("\n")
    .trim();
}

/**
 * Applies *.sql migrations from src/db/migrations in lexicographic order.
 */
export async function runMysqlMigrations() {
  if (!mysqlPoolReady()) {
    console.log("[db] migrations skip: MySQL not configured (file backend)");
    return { applied: [], skipped: true };
  }
  const pool = getMysqlPool();
  const migDir = path.join(__dirname, "migrations");
  const files = await readMigrationFiles(migDir);
  const conn = await pool.getConnection();
  const applied = [];
  try {
    for (const f of files) {
      const fp = path.join(migDir, f);
      const raw = await fs.readFile(fp, "utf8");
      const sql = stripSqlComments(raw);
      if (sql) await conn.query(sql);
      applied.push(f);
    }
  } finally {
    conn.release();
  }
  console.log("[db] migrations applied:", applied.length ? applied.join(", ") : "(none)");
  return { applied, skipped: false };
}
