import { getMysqlPool, mysqlPoolReady } from "./pool.js";

/**
 * @param {import('mysql2/promise').Pool} p
 * @param {string} namespace
 */
export async function kvGetJson(p, namespace) {
  const ns = String(namespace || "").trim();
  if (!ns) throw new Error("bad_namespace");
  const [rows] = await p.query("SELECT payload_json FROM app_kv WHERE namespace = ?", [ns]);
  const raw = rows?.[0]?.payload_json;
  if (raw == null) return {};
  try {
    const obj = typeof raw === "string" ? JSON.parse(raw || "{}") : JSON.parse(String(raw || "{}"));
    return obj && typeof obj === "object" ? obj : {};
  } catch {
    return {};
  }
}

/**
 * @param {import('mysql2/promise').Pool} p
 * @param {string} namespace
 * @param {Record<string, unknown>} obj
 */
export async function kvSetJson(p, namespace, obj) {
  const ns = String(namespace || "").trim();
  if (!ns) throw new Error("bad_namespace");
  const json = JSON.stringify(obj && typeof obj === "object" ? obj : {});
  await p.query(
    `INSERT INTO app_kv (namespace, payload_json) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE payload_json = VALUES(payload_json)`,
    [ns, json],
  );
}

export function kvRepoAvailable() {
  return mysqlPoolReady();
}
