import { parsePanelObject } from "./xuiClients.js";

// Explicitly selected shared access only. Never expose other panel clients.
export function sharedMtprotoFromInbounds(inbounds, settings, now = Date.now()) {
  const inbound = inbounds.find((row) => Number(row.id) === settings.inboundId);
  if (!inbound || inbound.protocol !== "mtproto" || inbound.enable === false) return null;
  const client = parsePanelObject(inbound.settings)?.clients?.find((row) => row.email === settings.email);
  if (!client || client.enable === false || (Number(client.expiryTime) > 0 && Number(client.expiryTime) <= now)) return null;
  const secret = String(client.secret || "").trim();
  const port = Number(inbound.port);
  if (!/^ee[0-9a-f]{34,}$/i.test(secret) || secret.length % 2 || !settings.host || port < 1 || port > 65535) return null;
  return { host: settings.host, port, secret };
}
