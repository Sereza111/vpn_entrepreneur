export function parseInboundIds(value) {
  const ids = String(value || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (ids.some((s) => !/^\d+$/.test(s) || !Number.isSafeInteger(Number(s)) || Number(s) < 1)) {
    throw new Error("xui_invalid_inbound_ids");
  }
  return [...new Set(ids.map(Number))];
}

export function parsePanelObject(value) {
  if (value && typeof value === "object") return value;
  try { return JSON.parse(String(value || "{}")); } catch { return null; }
}

export function selectProvisioningInbounds(rows, ids) {
  if (!ids.length) throw new Error("xui_inbound_id_required");
  return ids.map((id) => {
    const inbound = rows.find((row) => Number(row.id) === id);
    if (!inbound) throw new Error(`xui_inbound_not_found: ${id}`);
    if (inbound.enable === false) throw new Error(`xui_inbound_disabled: ${id}`);
    if (inbound.protocol !== "vless") throw new Error(`xui_inbound_protocol_unsupported: ${id}`);
    return inbound;
  });
}

export function clientFlowForInbounds(inbounds) {
  return inbounds.every((inbound) => {
    const stream = parsePanelObject(inbound.streamSettings);
    return inbound.protocol === "vless" && ["tcp", "raw"].includes(stream?.network) &&
      ["reality", "tls"].includes(stream?.security);
  }) ? "xtls-rprx-vision" : "";
}

export function xuiSubscriptionStatus(client, traffic, now = Date.now()) {
  const up = Math.max(0, Number(traffic?.up) || 0);
  const down = Math.max(0, Number(traffic?.down) || 0);
  // Despite its name, 3X-UI's totalGB field is measured in bytes.
  const limit = Math.max(0, Number(client.totalGB ?? client.totalGb) || 0);
  const expiry = Number(client.expiryTime) || 0;
  const status = client.enable === false ? "DISABLED"
    : expiry > 0 && expiry <= now ? "EXPIRED"
    : limit > 0 && up + down >= limit ? "LIMITED" : "ACTIVE";
  return {
    source: "xui", username: String(client.email || ""), panelStatus: status,
    expireAt: expiry > 0 ? new Date(expiry).toISOString() : null,
    usedTrafficBytes: up + down, trafficLimitBytes: limit,
    ipLimit: Number.isFinite(Number(client.limitIp)) ? Number(client.limitIp) : null,
  };
}
