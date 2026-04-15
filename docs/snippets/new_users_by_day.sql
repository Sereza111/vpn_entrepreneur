-- New/active users by day (based on customers.lastSeenAt).
SELECT
  DATE_TRUNC('day', "lastSeenAt")::date AS "day",
  COUNT(*)::int AS "usersCount"
FROM "customers"
WHERE "lastSeenAt" IS NOT NULL
GROUP BY 1
ORDER BY 1;
