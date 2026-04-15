-- Income vs costs by serverId.
-- Requires infra_costs collection with serverId, amount.
WITH revenue AS (
  SELECT
    COALESCE(NULLIF("serverId", ''), 'unknown') AS "serverId",
    SUM(COALESCE("netAmount", "amount", 0))::numeric AS "income"
  FROM "orders"
  WHERE "status" = 'paid'
  GROUP BY 1
),
costs AS (
  SELECT
    COALESCE(NULLIF("serverId", ''), 'unknown') AS "serverId",
    SUM(COALESCE("amount", 0))::numeric AS "cost"
  FROM "infra_costs"
  GROUP BY 1
)
SELECT
  COALESCE(r."serverId", c."serverId") AS "serverId",
  COALESCE(r."income", 0)::numeric AS "income",
  COALESCE(c."cost", 0)::numeric AS "cost",
  (COALESCE(r."income", 0) - COALESCE(c."cost", 0))::numeric AS "margin"
FROM revenue r
FULL OUTER JOIN costs c ON c."serverId" = r."serverId"
ORDER BY "margin" DESC;
