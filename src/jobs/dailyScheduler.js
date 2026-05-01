export function startDailyUtcJob({ hourUtc, label = "daily-job", job }) {
  const hour = Math.max(0, Math.min(23, Number(hourUtc) || 0));
  const run = async () => {
    try {
      await job();
    } catch (e) {
      console.warn(`[${label}] failed:`, String(e?.message || e));
    } finally {
      scheduleNext();
    }
  };
  const scheduleNext = () => {
    const now = new Date();
    const next = new Date(now);
    next.setUTCMinutes(0, 0, 0);
    next.setUTCHours(hour);
    if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
    const delay = Math.max(5_000, next.getTime() - now.getTime());
    setTimeout(run, delay).unref?.();
  };
  scheduleNext();
}
