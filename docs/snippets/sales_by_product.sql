-- Sales by SKU.
-- Shows number of paid orders and revenue by productCode.
SELECT
  COALESCE(NULLIF("productCode", ''), 'unknown') AS "productCode",
  COUNT(*)::int AS "ordersCount",
  SUM(COALESCE("netAmount", "amount", 0))::numeric AS "revenue"
FROM "orders"
WHERE "status" = 'paid'
GROUP BY 1
ORDER BY "revenue" DESC, "ordersCount" DESC;
