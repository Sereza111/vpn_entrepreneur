# NocoBase + бот VL: внедрение

Интеграция в коде: [src/nocobase.js](../src/nocobase.js), вызовы из [src/index.js](../src/index.js) (webhook оплаты, выдача прокси, каталог в `/api/me`).

## 1. Безопасность инстанса (обязательно до продакшена)

Текущий доступ по `http://IP:10200/` без TLS — **не годится** для админки и API-ключей.

- **Домен + HTTPS**: поставьте reverse-proxy (Caddy или Nginx + Let’s Encrypt) на 443, бэкенд NocoBase оставьте на localhost.
- **Firewall**: снаружи открыть только `80/443`; порт NocoBase не публиковать в интернет, если прокси на той же машине.
- **Доступ админов**: по возможности allowlist IP / VPN; сильные пароли, отдельный пользователь для API.
- **Плагин API Keys** в NocoBase: отдельная роль с минимальными правами только на нужные коллекции ([документация NocoBase по API keys](https://docs.nocobase.com/integration/api-keys/usage)).
- **Бэкапы Postgres**: ежедневный дамп БД NocoBase (pg_dump) + хранение вне сервера.

После этого в `.env` бота укажите **`NOCOBASE_BASE_URL=https://ваш-домен`** (без завершающего `/`).

## 2. Переменные окружения бота

| Переменная | Назначение |
|------------|------------|
| `NOCOBASE_BASE_URL` | URL NocoBase (https://...) |
| `NOCOBASE_API_TOKEN` | Bearer-токен (рекомендуется, из API Keys) |
| `NOCOBASE_ACCOUNT` / `NOCOBASE_PASSWORD` | Альтернатива: логин через `auth:signIn` (менее предпочтительно для продакшена) |
| `NOCOBASE_COLLECTION_*` | Переименование коллекций, если у вас другие имена в UI |

См. также [.env.example](../.env.example).

## 3. Коллекции и поля (создайте в NocoBase)

Имена по умолчанию: `customers`, `orders`, `products`, `proxy_instances`.  
Типы полей подберите в UI (строка / число / дата / булево).

### customers

| Поле | Тип | Примечание |
|------|-----|------------|
| telegramId | Число (integer) | Уникальный идентификатор, индекс |
| username | Строка | @username, может быть пусто |
| segment | Строка | free / paid / unknown |
| lastSeenAt | Дата-время | Обновляется при событиях |

### orders

| Поле | Тип | Примечание |
|------|-----|------------|
| telegramId | Число | |
| status | Строка | paid / created / … |
| extendDays | Число | дней VPN из webhook |
| addDeviceSlots | Число | слотов устройств из webhook |
| amount | Число | nullable |
| currency | Строка | nullable |
| externalPaymentId | Строка | id платежа у провайдера |
| productCode | Строка | nullable |
| paidAt | Дата-время | |
| source | Строка | например `payment_webhook` |

### products (каталог для мини-аппа, фаза B)

| Поле | Тип | Примечание |
|------|-----|------------|
| code | Строка | Уникальный код SKU |
| title | Строка | Подпись на кнопке |
| grantDays | Число | Для тест-кнопки «продление» в мини-аппе |
| productType | Строка | Для VPN-кнопок: `vpn_extend` |
| sortOrder | Число | Порядок сортировки |
| active | Булево | Скрыть — не показывать в мини-аппе |

Бот отдаёт в `/api/me` поле `catalog`: при наличии активных строк с `productType=vpn_extend` и `grantDays>0` кнопки «Продление» строятся из NocoBase; иначе — запасной вариант 30/90/180 дней.

### proxy_instances

| Поле | Тип | Примечание |
|------|-----|------------|
| telegramId | Число | |
| serverId | Строка | id из PROXY_SERVERS_JSON |
| country | Строка | |
| username | Строка | логин 3proxy |
| passwordInNocobase | Булево | всегда `false` — пароль **не** храним |
| issuedAt | Дата-время | |

### Опционально (позже)

- **subscriptions** — срок VPN, связь с XUI email (без секретов).
- **proxy_entitlements** — история начислений квоты.
- **support_tickets**, **audit_log** — саппорт и аудит ручных действий.

## 4. Поведение бота (фаза A)

После успешного **`POST /api/webhooks/payment`** (секрет `PAYMENT_WEBHOOK_SECRET`):

1. Выполняется `xuiProvisionCore` (как раньше).
2. Асинхронно создаётся/обновляется **customer** и запись **order** (поля из тела webhook).

Дополнительные поля тела webhook (опционально): `amount`, `currency`, `externalPaymentId` или `paymentId`, `productCode`, `username`.

После **`POST /api/proxy/provision`** в NocoBase пишется строка **proxy_instances** (без пароля).

Ошибки NocoBase **не роняют** выдачу VPN/прокси — только логируются в консоль.

## 5. Дашборды в NocoBase

В разделе визуализации (charts / dashboards) добавьте блоки на основе коллекций:

- **Выручка**: сумма `orders.amount` по `paidAt` (фильтр `status=paid`), группировка по дню.
- **Новые клиенты**: число записей `customers` по `lastSeenAt` или дате создания.
- **Заказы**: количество `orders` по дням, разрез по `productCode`.
- **Прокси**: количество `proxy_instances` по `country` / `serverId`.

Точные шаги зависят от версии NocoBase и включённых плагинов визуализации — используйте встроенный конструктор к вашим коллекциям.

## 6. Политика секретов

- **Не хранить** в NocoBase: пароли прокси, приватные SSH-ключи, `subId`/полные subscription URL с секретами, JWT-секреты бота.
- В **proxy_instances** допускается только **username** + метаданные; пароль остаётся в `data/proxy-links.json` на сервере бота (или будущем секрет-хранилище).
- Роли NocoBase: саппорт без экспорта чувствительных полей; API-ключ бота — только create/list на нужных таблицах.

## 7. Проверка

1. Создать коллекции и поля, выдать API key, прописать `NOCOBASE_*` в окружении бота.
2. Перезапустить бот, открыть мини-апп: при заполненных `products` должны смениться кнопки продления.
3. Смоделировать webhook оплаты с заголовком `x-webhook-secret` — в NocoBase появляются `orders` и обновляется `customers`.
4. Создать прокси — появляется строка в `proxy_instances` без пароля.

Официальный сайт NocoBase: [nocobase.com](https://www.nocobase.com/).
