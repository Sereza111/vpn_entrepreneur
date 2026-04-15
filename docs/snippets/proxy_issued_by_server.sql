-- Issued proxy accounts by server.
SELECT
  COALESCE(NULLIF("serverId", ''), 'unknown') AS "serverId",
  COUNT(*)::int AS "issuedCount"
FROM "proxy_instances"
GROUP BY 1
ORDER BY "issuedCount" DESC;
