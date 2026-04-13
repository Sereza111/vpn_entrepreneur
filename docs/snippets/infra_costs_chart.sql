-- График «расходы по label» (коллекция infra_costs), источник «Основной», режим SQL.
-- Результат: две колонки — label, amount (сумма).
--
-- ВАЖНО (Chart options): подписи слева должны быть из поля **label**, длина столбца — из **amount**.
-- Если и «Поле Y», и верхний дропдаун стоят на **amount**, на оси будут цифры 350/890 вместо названий — это ошибка маппинга, не SQL.
--
-- Если ошибка: relation "infra_costs" does not exist — имя таблицы в Postgres может отличаться.
-- Выполните в SQL-консоли (или psql):
--   SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename ILIKE '%infra%';
-- Подставьте найденное имя вместо infra_costs ниже.

-- Вариант A: только ₽
SELECT
  "label",
  SUM("amount")::numeric AS "amount"
FROM "infra_costs"
WHERE "currency" = 'RUB'
GROUP BY "label"
ORDER BY SUM("amount") DESC;

-- Вариант B: только USD (отдельный график или смените WHERE)
-- SELECT "label", SUM("amount")::numeric AS "amount"
-- FROM "infra_costs"
-- WHERE "currency" = 'USD'
-- GROUP BY "label"
-- ORDER BY SUM("amount") DESC;

-- Вариант C: все валюты в одной таблице (две колонки сумм — нужен другой тип графика)
-- SELECT "label", "currency", SUM("amount")::numeric AS "amount"
-- FROM "infra_costs"
-- GROUP BY "label", "currency"
-- ORDER BY "label", "currency";
