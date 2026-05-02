import fs from "fs/promises";
import path from "path";
import { getMysqlPool } from "../db/pool.js";
import { kvGetJson, kvSetJson, kvRepoAvailable } from "../db/appKvRepo.js";

const dataDir = path.join(process.cwd(), "data");

async function ensureDataDirFs() {
  await fs.mkdir(dataDir, { recursive: true });
}

function safeParseDbJson(raw) {
  const src = String(raw || "").trim();
  if (!src) return {};
  try {
    const obj = JSON.parse(src);
    return obj && typeof obj === "object" ? obj : {};
  } catch {
    if (src[0] !== "{") return {};
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === "\"") inStr = false;
        continue;
      }
      if (ch === "\"") {
        inStr = true;
        continue;
      }
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          try {
            const obj = JSON.parse(src.slice(0, i + 1));
            return obj && typeof obj === "object" ? obj : {};
          } catch {
            return {};
          }
        }
      }
    }
    return {};
  }
}

/**
 * Прочитать целый JSON-документ (как один legacy файл).
 * @param {string} namespace — значение из NS.*
 * @param {string} legacyFilename — например balance.json
 */
export async function readDocument(namespace, legacyFilename) {
  if (kvRepoAvailable()) {
    const p = getMysqlPool();
    return kvGetJson(p, namespace);
  }
  await ensureDataDirFs();
  const fp = path.join(dataDir, legacyFilename);
  try {
    const raw = await fs.readFile(fp, "utf8");
    return safeParseDbJson(raw);
  } catch (e) {
    if (e && e.code === "ENOENT") return {};
    throw e;
  }
}

/**
 * Записать документ атомарно (tmp → rename или одна строка KV).
 */
export async function writeDocument(namespace, legacyFilename, obj) {
  const next = obj && typeof obj === "object" ? obj : {};
  if (kvRepoAvailable()) {
    const p = getMysqlPool();
    await kvSetJson(p, namespace, next);
    return;
  }
  await ensureDataDirFs();
  const fp = path.join(dataDir, legacyFilename);
  const tmp = `${fp}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(next, null, 2), "utf8");
  await fs.rename(tmp, fp);
}
