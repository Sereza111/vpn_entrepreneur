-- График «расходы по label» (коллекция infra_costs), источник «Основной», режим SQL.
-- Результат: две колонки — label, amount (сумма). В Chart options: ось категорий = label, значение = amount.
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
