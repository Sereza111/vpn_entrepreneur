import { NS, LEGACY_FILENAME } from "./storage/namespaces.js";
import { readDocument, writeDocument } from "./storage/jsonDocumentBackend.js";

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

async function rawReadParsed() {
  const doc = await readDocument(NS.ADMIN_CONFIG, LEGACY_FILENAME[NS.ADMIN_CONFIG]);
  const src = JSON.stringify(doc);
  return safeParseDbJson(src);
}

async function writeJson(normalizedDoc) {
  await writeDocument(NS.ADMIN_CONFIG, LEGACY_FILENAME[NS.ADMIN_CONFIG], normalizedDoc);
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
      password: String(s?.ssh?.password || "").trim(),
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
  return normalizeConfig(await rawReadParsed());
}

export async function getConfig() {
  return await readJson();
}

export async function setAdmins(adminTelegramIds) {
  const cur = await readJson();
  return await writeNormalized({ ...cur, admins: Array.isArray(adminTelegramIds) ? adminTelegramIds : [] });
}

export async function setProxyServers(servers) {
  const cur = await readJson();
  return await writeNormalized({ ...cur, proxyServers: Array.isArray(servers) ? servers : [] });
}

async function writeNormalized(candidate) {
  const next = normalizeConfig({
    ...(candidate || {}),
    updatedAt: new Date().toISOString(),
  });
  await writeJson(next);
  return next;
}

export async function upsertProxyServer(server) {
  const cur = await readJson();
  const normalized = normalizeServer(server);
  if (!normalized.id || !normalized.host || !normalized.ssh.host) {
    throw new Error("bad_server_payload");
  }
  const nextServers = (cur.proxyServers || []).filter((s) => s.id !== normalized.id);
  nextServers.push(normalized);
  return await writeNormalized({ ...cur, proxyServers: nextServers });
}

export async function deleteProxyServer(serverId) {
  const id = String(serverId || "").trim();
  if (!id) throw new Error("server_id_required");
  const cur = await readJson();
  const nextServers = (cur.proxyServers || []).filter((s) => s.id !== id);
  return await writeNormalized({ ...cur, proxyServers: nextServers });
}
