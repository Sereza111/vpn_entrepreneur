# Отдельный стек для сайта

Для лендинга есть отдельный compose-файл: `docker-compose.site.yml`.

## Portainer (Git stack)

1. Создай новый Stack (например `vpn_site`).
2. Repository URL: этот же репозиторий.
3. Compose path: `docker-compose.site.yml`.
4. При необходимости задай переменные:
   - `SITE_PORT` (по умолчанию `8080`)
   - `SITE_IMAGE` (опционально)
5. Deploy.

После деплоя сайт будет доступен на `http://<host>:SITE_PORT`.

