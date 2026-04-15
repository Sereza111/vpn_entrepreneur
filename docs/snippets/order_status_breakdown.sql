-- Subscription/order status breakdown.
SELECT
  COALESCE(NULLIF("status", ''), 'unknown') AS "status",
  COUNT(*)::int AS "ordersCount"
FROM "orders"
GROUP BY 1
ORDER BY "ordersCount" DESC;
