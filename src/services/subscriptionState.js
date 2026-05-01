export function isActiveSubscriptionProfile(me) {
  const st = me?.subscriptionStatus || null;
  if (!st || typeof st !== "object") return false;
  const panelStatus = String(st.panelStatus || "").toUpperCase();
  if (panelStatus !== "ACTIVE") return false;
  const expMs = st.expireAt ? Date.parse(st.expireAt) : NaN;
  if (!Number.isFinite(expMs)) return true;
  return expMs > Date.now();
}

export function resolveSubscriptionExpiryMs(me) {
  const expMs = me?.subscriptionStatus?.expireAt
    ? Date.parse(me.subscriptionStatus.expireAt)
    : NaN;
  return Number.isFinite(expMs) && expMs > 0 ? expMs : null;
}
