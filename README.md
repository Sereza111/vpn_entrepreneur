# VL VPS Premium Bot + Mini App

Telegram-бот и Web Mini App для VPS Premium/прокси:

- выдача и обновление подписки через 3X-UI/Xray;
- каталог тарифов и операционные данные через NocoBase;
- выдача прокси (SOCKS5/HTTP) через SSH/3proxy;
- дашборды по расходам/доходам в NocoBase.

## Что в проекте

- `src/` — API бота, webhook-и, интеграция с 3X-UI, NocoBase, прокси.
- `web/` — фронтенд мини-аппа (Vite), собирается в `public/`.
- `import/` — шаблоны и скрипты для импорта в NocoBase.
- `docs/` — эксплуатация, аналитика, маршрутизация и безопасность.

## Быстрый старт

1. Установить зависимости:
   - `npm install`
   - `npm --prefix web install`
2. Скопировать `.env.example` в `.env` и заполнить минимум:
   - `BOT_TOKEN`
   - `WEB_APP_URL`
   - `PUBLIC_BASE_URL`
   - `SESSION_JWT_SECRET`
   - `XUI_*` (для 3X-UI)
3. Собрать мини-апп:
   - `npm run build`
4. Запустить:
   - `npm start`

Полный деплой через Portainer/Git: [`DEPLOY.md`](DEPLOY.md).

## Переменные окружения

Эталонный список: [`.env.example`](.env.example).

Ключевые группы:

- Telegram: `BOT_TOKEN`, `WEBHOOK_SECRET`, `PUBLIC_BASE_URL`
- 3X-UI: `XUI_PANEL_BASE_URL`, `XUI_WEB_BASE_PATH`, `XUI_USERNAME`, `XUI_PASSWORD`, `XUI_INBOUND_ID`
- NocoBase: `NOCOBASE_BASE_URL`, `NOCOBASE_API_TOKEN`, `NOCOBASE_COLLECTION_*`
- Прокси: `PROXY_SERVERS_JSON`
- Платежи: `PAYMENT_WEBHOOK_SECRET`, `PAYMENT_CHECKOUT_URL_TEMPLATE`

## NocoBase: данные и аналитика

Основная инструкция: [`docs/NOCOBASE.md`](docs/NOCOBASE.md).

Что уже подготовлено в репозитории:

- импорт тарифов и branding из `Товары.xlsx`:
  - `import/xlsx_to_products_csv.py`
  - `import/regenerate-products-csv.bat`
- примеры для ручного/исторического заполнения:
  - [`import/infra_costs.example.csv`](import/infra_costs.example.csv)
  - [`import/orders.example.csv`](import/orders.example.csv)
  - [`import/infra_costs-import-template.xlsx`](import/infra_costs-import-template.xlsx)
- SQL-сниппет для графика расходов:
  - [`docs/snippets/infra_costs_chart.sql`](docs/snippets/infra_costs_chart.sql)

## Маршрутизация и блокировка рекламы в Xray

Подробное руководство: [`docs/XRAY_GEOSITE_ADBLOCK.md`](docs/XRAY_GEOSITE_ADBLOCK.md).

Коротко:

- используется GeoSite-категория `geosite:category-ads-all`;
- источник `geosite.dat`: [runetfreedom/russia-blocked-geosite](https://github.com/runetfreedom/russia-blocked-geosite);
- правило добавляется в 3X-UI/Xray routing и отправляет совпадения в `block/blackhole`.

## Безопасность (минимальный baseline)

1. NocoBase и 3X-UI не держать на открытом HTTP в интернет.
2. Выдавать доступ к админкам через HTTPS + ограничение по IP/Allowlist.
3. API-ключи и `.env` не хранить в Git.
4. Делать регулярные бэкапы Postgres (NocoBase) и operational stores (`data/`).
5. Перед правками маршрутизации/GeoSite сохранять backup текущего Xray config.

Операционный чеклист: [`docs/RUNBOOK.md`](docs/RUNBOOK.md).

## Мониторинг и эксплуатация

- технический контур: Portainer, логи контейнеров, состояние сервисов, CPU/RAM;
- бизнес-контур: графики в NocoBase (`orders`, `infra_costs`, `proxy_instances`).

См. подробно:

- [`docs/RUNBOOK.md`](docs/RUNBOOK.md)
- [`docs/NOCOBASE.md`](docs/NOCOBASE.md)

## Команды

- `npm start` — запуск бэкенда
- `npm run dev` — запуск бэкенда в watch режиме
- `npm run build` — сборка mini-app (web → public)
- `npm --prefix web run dev` — локальный dev-сервер Vite

## Примечания

- В репозитории могут лежать локальные/операционные файлы, которые не должны попадать в удалённый origin (`$env`, `Товары.xlsx`, `.cursor/settings.json`).
- Если после импорта NocoBase пишет про «заголовки не найдены», берите первую строку из **Экспорт → Excel** именно той коллекции и соблюдайте порядок колонок.
