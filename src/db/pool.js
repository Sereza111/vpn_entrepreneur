import mysql from "mysql2/promise";
import { getMysqlPoolConfig, isMysqlConfigured } from "./mysqlConfig.js";

let pool = null;

export function mysqlPoolReady() {
  return isMysqlConfigured();
}

/** @returns {import('mysql2/promise').Pool|null} */
export function getMysqlPool() {
  if (!isMysqlConfigured()) return null;
  if (pool) return pool;
  const cfg = getMysqlPoolConfig();
  if ("uri" in cfg && cfg.uri) {
    pool = mysql.createPool(cfg.uri);
  } else {
    pool = mysql.createPool({
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      password: cfg.password,
      database: cfg.database,
      waitForConnections: true,
      connectionLimit: Math.max(
        2,
        Math.min(24, Number(process.env.DB_POOL_LIMIT || 10)),
      ),
      namedPlaceholders: true,
      enableKeepAlive: true,
    });
  }
  return pool;
}

export async function closeMysqlPoolGracefully() {
  if (!pool) return;
  try {
    await pool.end();
  } finally {
    pool = null;
  }
}
