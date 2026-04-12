# Runbook: инфраструктура VL (VPN + бот + NocoBase)

Краткий чеклист эксплуатации и аудита. Детали NocoBase: [NOCOBASE.md](./NOCOBASE.md). Деплой: [DEPLOY.md](../DEPLOY.md).

## Роли серверов

| Роль | Что проверить |
|------|----------------|
| **Обход** (Xray/3X-UI, вход пользователей) | HTTPS панели при доступе извне; CPU/RAM в пик; версия Xray/3X-UI |
| **Выход** (транзит трафика) | Лимиты трафика/канала у провайдера VPS; CPU при нагрузке |
| **Прокси** (3proxy и т.п.) | SSH-ключи, доступность портов, логи контейнера |
| **Бот** (Node, Docker) | `PUBLIC_BASE_URL`, `WEB_APP_URL`, health, логи webhook |
| **NocoBase** | HTTPS, бэкапы Postgres, ротация API-ключа |

## Доступ и сеть

- [ ] Админ-панели (3X-UI, NocoBase) не на «голом» HTTP в проде без осознанного решения; предпочтительно **HTTPS** и ограничение по IP/VPN.
- [ ] **SSH**: ключи, отключить пароль root при возможности; при необходимости fail2ban.
- [ ] Фаервол: открыты только нужные порты (443, 22 с ограничением и т.д.).

## 3X-UI / Xray

- [ ] Резервная копия конфигурации / экспорт из панели по расписанию.
- [ ] Лимиты клиента (**IP limit**, трафик) согласованы с продуктом и мини-приложением.
- [ ] После роста нагрузки: замер **CPU** и **сети** на обходе и выходе в вечерний пик; порог «пора масштабировать» (ориентир: **CPU > 70%** устойчиво 15+ минут).
- [ ] Опционально: блокировка рекламы через GeoSite **`geosite:category-ads-all`** и файл **`geosite.dat`** — пошаговая памятка: [XRAY_GEOSITE_ADBLOCK.md](./XRAY_GEOSITE_ADBLOCK.md) (источник списков: [runetfreedom/russia-blocked-geosite](https://github.com/runetfreedom/russia-blocked-geosite)).

## Бэкапы

- [ ] **NocoBase**: дамп PostgreSQL (`pg_dump`) на расписании, копия вне сервера.
- [ ] Данные бота: файлы stores (`data/`), `.env` в секрет-хранилище, не в Git.

## Наблюдаемость

- [ ] Логи контейнера бота: ошибки `nocobase`, `xui`, webhook оплаты.
- [ ] `/health` на сервисе бота для внешнего пинга.

## Portainer и стек (после `git pull`)

- [ ] Стек **обновился** (redeploy / pull образа по политике) — проверить, что контейнер бота в статусе **running**, не **restarting**.
- [ ] **Логи** стека в Portainer: нет бесконечных ошибок при старте (БД, `NOCOBASE_BASE_URL`, токен).
- [ ] **Stats** контейнера: память и CPU в норме после деплоя.
- [ ] **Бизнес-метрики** (выручка, расходы): не в Portainer — в NocoBase, см. [NOCOBASE.md](./NOCOBASE.md) (коллекции `infra_costs`, `orders`, §5 дашборды).

## Падение ноды

1. Проверить статус VPS у провайдера и сеть.
2. Поднять сервис по [DEPLOY.md](../DEPLOY.md); восстановить последний бэкап NocoBase при необходимости.
3. Уведомить пользователей (канал/бот), если простой затяжной.

## Проверка оплаты (интеграция)

Провайдер после успешной оплаты должен вызвать:

`POST {PUBLIC_BASE_URL}/api/webhooks/payment`  
Заголовок: `x-webhook-secret: <PAYMENT_WEBHOOK_SECRET>`  
Тело JSON: минимум `telegramId`, `extendDays` или `planDays`, опционально `addDeviceSlots`, `amount`, `currency`, `paymentId`/`externalPaymentId`, `productCode`, `username`, опционально `feeAmount`, `netAmount`, `serverId` (см. [NOCOBASE.md](./NOCOBASE.md)).

Пример `curl` (подставьте URL и секрет):

```bash
curl -sS -X POST "https://your-bot-host/api/webhooks/payment" \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: YOUR_SECRET" \
  -d '{"telegramId":123456789,"extendDays":30,"amount":299,"currency":"RUB","feeAmount":9,"paymentId":"test-1","productCode":"vpn_30","serverId":"nl1"}'
```

Ожидание: HTTP 200, `{"ok":true}`; в NocoBase появляется заказ (если NocoBase включён).
