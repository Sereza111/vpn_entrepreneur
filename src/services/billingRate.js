/**
 * Почасовая ставка VPS + надстройки — та же модель, что в loadMe (/api/me).
 */
export function computeTotalHourlyRateMinor({
  subscriptionStatus,
  proxyPayload,
  vpsHourlyMinor,
  proxyAddonUnitMinor,
  deviceSlotUnitMinor,
  dedicatedHourlyMinor,
}) {
  const proxyAddons = proxyPayload?.addons || {};
  const proxyItemsCount = Array.isArray(proxyPayload?.items) ? proxyPayload.items.length : 0;
  const addonProxyUnitMinor = Boolean(proxyAddons?.proxyEnabled)
    ? Math.max(0, Math.floor(Number(proxyAddonUnitMinor ?? 0)))
    : 0;
  const addonProxy = addonProxyUnitMinor * Math.max(0, Math.floor(proxyItemsCount || 0));
  const addonIp = Boolean(proxyAddons?.dedicatedIpEnabled)
    ? Math.max(0, Math.floor(Number(dedicatedHourlyMinor ?? 0)))
    : 0;
  const ipLimitNow = Number(subscriptionStatus?.ipLimit ?? 0);
  const extraDeviceSlots =
    Number.isFinite(ipLimitNow) && ipLimitNow > 2 ? Math.floor(ipLimitNow - 2) : 0;
  const addonDeviceSlotUnitMinor = Math.max(0, Math.floor(Number(deviceSlotUnitMinor ?? 0)));
  const addonDeviceSlots = addonDeviceSlotUnitMinor * Math.max(0, extraDeviceSlots);

  const totalRateMinor =
    Math.max(1, Math.floor(Number(vpsHourlyMinor || 1))) +
    Math.max(0, Math.floor(addonProxy || 0)) +
    Math.max(0, Math.floor(addonIp || 0)) +
    Math.max(0, Math.floor(addonDeviceSlots || 0));
  return totalRateMinor;
}

export function shouldApplyHourlyBalanceFromMe(me) {
  if (!me?.balance?.enabled) return false;
  if (!me.balance.billingActive) return false;
  if (Boolean(me.balance?.freeMode)) return false;
  const ss = me.subscriptionStatus || {};
  if (String(ss.source || "") !== "xui") return false;
  if (String(ss.panelStatus || "").toUpperCase() !== "ACTIVE") return false;
  return true;
}
