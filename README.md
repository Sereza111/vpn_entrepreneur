# VL VPS Premium Bot + Mini App

Telegram-бот и Web Mini App для VPS Premium/прокси:

- выдача и обновление подписки через 3X-UI/Xray;
- выдача прокси (SOCKS5/HTTP) через SSH/3proxy;
- встроенный каталог тарифов и мини-апп для покупки/продления.

## Что в проекте

- `src/` — API бота, webhook-и, интеграция с 3X-UI и прокси.
- `web/` — фронтенд мини-аппа (Vite), собирается в `public/`.
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
- Прокси: `PROXY_SERVERS_JSON`
- Платежи: `PAYMENT_WEBHOOK_SECRET`, `PAYMENT_CHECKOUT_URL_TEMPLATE`
- Security/ops: `SESSION_JWT_EXPIRES_IN`, `RATE_LIMIT_RPM`

## Маршрутизация и блокировка рекламы в Xray

Подробное руководство: [`docs/XRAY_GEOSITE_ADBLOCK.md`](docs/XRAY_GEOSITE_ADBLOCK.md).

Коротко:

- используется GeoSite-категория `geosite:category-ads-all`;
- источник `geosite.dat`: [runetfreedom/russia-blocked-geosite](https://github.com/runetfreedom/russia-blocked-geosite);
- правило добавляется в 3X-UI/Xray routing и отправляет совпадения в `block/blackhole`.

## Безопасность (минимальный baseline)

1. 3X-UI не держать на открытом HTTP в интернет.
2. Выдавать доступ к админкам через HTTPS + ограничение по IP/Allowlist.
3. API-ключи и `.env` не хранить в Git.
   - если токены/ключи случайно попали в чат/логи — считать скомпрометированными и ротировать.
4. Делать регулярные бэкапы operational stores (`data/`).
5. Перед правками маршрутизации/GeoSite сохранять backup текущего Xray config.

Операционный чеклист: [`docs/RUNBOOK.md`](docs/RUNBOOK.md).
Релизный чеклист: [`docs/RELEASE_CHECKLIST.md`](docs/RELEASE_CHECKLIST.md).

## Мониторинг и эксплуатация

- технический контур: Portainer, логи контейнеров, состояние сервисов, CPU/RAM.

## Команды

- `npm start` — запуск бэкенда
- `npm run dev` — запуск бэкенда в watch режиме
- `npm run build` — сборка mini-app (web → public)
- `npm --prefix web run dev` — локальный dev-сервер Vite

## Примечания

- В репозитории могут лежать локальные/операционные файлы, которые не должны попадать в удалённый origin (`$env`, `Товары.xlsx`, `.cursor/settings.json`).
