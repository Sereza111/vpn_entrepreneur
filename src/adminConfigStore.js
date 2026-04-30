import fs from "fs/promises";
import path from "path";

const dataDir = path.join(process.cwd(), "data");
const filePath = path.join(dataDir, "admin-config.json");

async function ensureDir() {
  await fs.mkdir(dataDir, { recursive: true });
}

function safeParseDbJson(raw) {
  const src = String(raw || "").trim();
  if (!src) return {};
  try {
    const obj = JSON.parse(src);
    return obj && typeof obj === "object" ? obj : {};
  } catch {
    return {};
  }
}

function normalizeServer(input = {}) {
  const s = input && typeof input === "object" ? input : {};
  return {
    id: String(s.id || "").trim(),
    country: String(s.country || "").trim(),
    label: String(s.label || s.name || "").trim(),
    host: String(s.host || "").trim(),
    timewebServerId: String(s.timewebServerId || s?.timeweb?.serverId || "").trim(),
    socksPort: Number(s.socksPort ?? 1080),
    httpPort: Number(s.httpPort ?? 3128),
    mtprotoPort: Number(s.mtprotoPort ?? s?.mtproto?.port ?? 0),
    mtprotoSecret: String(s.mtprotoSecret || s?.mtproto?.secret || "").trim(),
    ssh: {
      host: String(s?.ssh?.host || s.host || "").trim(),
      port: Number(s?.ssh?.port ?? 22),
      user: String(s?.ssh?.user || "").trim(),
      privateKeyB64: String(s?.ssh?.privateKeyB64 || "").trim(),
    },
    containerName: String(s.containerName || "3proxy").trim(),
    configPath: String(s.configPath || "/opt/3proxy/3proxy.cfg").trim(),
  };
}

function normalizeConfig(raw = {}) {
  const obj = raw && typeof raw === "object" ? raw : {};
  const admins = Array.isArray(obj.admins) ? obj.admins : [];
  const proxyServers = Array.isArray(obj.proxyServers) ? obj.proxyServers : [];
  return {
    version: 1,
    admins: [...new Set(
      admins
        .map((x) => Number(x))
        .filter((n) => Number.isFinite(n) && n > 0),
    )],
    proxyServers: proxyServers
      .map((s) => normalizeServer(s))
      .filter((s) => s.id && s.host && s.ssh.host),
    updatedAt: obj.updatedAt || null,
  };
}

async function readJson() {
  await ensureDir();
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return normalizeConfig(safeParseDbJson(raw));
  } catch (e) {
    if (e && e.code === "ENOENT") return normalizeConfig({});
    throw e;
  }
}

async function writeJson(obj) {
  await ensureDir();
  const next = normalizeConfig({
    ...(obj || {}),
    updatedAt: new Date().toISOString(),
  });
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(next, null, 2), "utf8");
  await fs.rename(tmp, filePath);
  return next;
}

export async function getConfig() {
  return await readJson();
}

export async function setAdmins(adminTelegramIds) {
  const cur = await readJson();
  return await writeJson({ ...cur, admins: Array.isArray(adminTelegramIds) ? adminTelegramIds : [] });
}

export async function setProxyServers(servers) {
  const cur = await readJson();
  return await writeJson({ ...cur, proxyServers: Array.isArray(servers) ? servers : [] });
}

export async function upsertProxyServer(server) {
  const cur = await readJson();
  const normalized = normalizeServer(server);
  if (!normalized.id || !normalized.host || !normalized.ssh.host) {
    throw new Error("bad_server_payload");
  }
  const nextServers = (cur.proxyServers || []).filter((s) => s.id !== normalized.id);
  nextServers.push(normalized);
  return await writeJson({ ...cur, proxyServers: nextServers });
}

export async function deleteProxyServer(serverId) {
  const id = String(serverId || "").trim();
  if (!id) throw new Error("server_id_required");
  const cur = await readJson();
  const nextServers = (cur.proxyServers || []).filter((s) => s.id !== id);
  return await writeJson({ ...cur, proxyServers: nextServers });
}
