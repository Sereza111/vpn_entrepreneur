# Отдельный стек для сайта

Для лендинга есть отдельный compose-файл: `docker-compose.site.yml`.
Сборка делается в GitHub Actions, в Portainer идёт только `docker pull` готового образа из GHCR.

## Portainer (Git stack)

1. Создай новый Stack (например `vpn_site`).
2. Repository URL: этот же репозиторий.
3. Compose path: `docker-compose.site.yml`.
4. При необходимости задай переменные:
   - `SITE_PORT` (по умолчанию `8080`)
   - `SITE_IMAGE` (опционально, по умолчанию `ghcr.io/sereza111/vpn_entrepreneur-site:latest`)
5. Deploy.

После деплоя сайт будет доступен на `http://<host>:SITE_PORT`.

