-- Revenue by day.
-- Preferred metric: sum(netAmount), fallback to amount if netAmount is null.
-- Use in SQL chart datasource.
SELECT
  DATE_TRUNC('day', "paidAt")::date AS "day",
  SUM(COALESCE("netAmount", "amount", 0))::numeric AS "revenue"
FROM "orders"
WHERE "status" = 'paid'
GROUP BY 1
ORDER BY 1;
