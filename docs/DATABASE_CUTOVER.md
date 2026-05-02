# Переход данных с `./data/*.json` на MySQL

## Зачем

JSON на диске (`./data`) исчезает при потере тома VPS или ошибочном деплое. Таблица `app_kv` хранит те же монолитные документы атомарно на стороне MySQL.

## Поднять MySQL в docker-compose

1. Задайте переменные (см. корневой `docker-compose.yml`): `MYSQL_ROOT_PASSWORD`, пользователь приложения (`MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`).
2. Пробросьте на контейнер бота: `DB_HOST=mysql`, `DB_PORT=3306`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`. Не ставьте `DB_BACKEND=file`.
3. Первый старт приложения выполнит SQL из `src/db/migrations/` (лог `[db] migrations applied`).
4. Один раз импортируйте имеющиеся JSON (**или** см. ниже импорт готовым `.sql`).

```bash
npm ci
npm run db:import-json
```

С флагом `--merge` уже существующие ключи в KV не будут затёрты, а только добавлены недостающие:

```bash
node src/db/importFromDataFiles.js --merge
```

## Перенос одним файлом SQL (переезд на другой хост / phpMyAdmin)

Из каталога `data/` на машине с бекапом:

```bash
npm run db:export-sql-from-json
# по умолчанию: exports/app_kv_from_json.sql

# свой путь:
node src/db/exportJsonToSql.js --out ~/vpn_bot_app_kv.sql
```

В получившемся файле есть **`CREATE TABLE app_kv`** и **`INSERT ... ON DUPLICATE KEY UPDATE`** по всем неймспейсам. Импорт:

```bash
mysql -h ХОСТ -u ЮЗЕР -p vpn_bot < exports/app_kv_from_json.sql
```

Или загрузкой файла через веб-панель (phpMyAdmin / «Импорт» Cloud DB).

На уже живой базе можно только стянуть таблицу без JSON:

```bash
mysqldump -h ХОСТ -u ЮЗЕР -p --single-transaction vpn_bot app_kv > app_kv_backup.sql
```

Восстановление: `mysql ... < app_kv_backup.sql`

## Ручной дамп перед cutover

```bash
tar czf vpn-data-$(date +%F).tar.gz data/
```

## Откат на файлы

В экстренном случае: `DB_BACKEND=file` в env бота (или убрать `DB_HOST` и `DATABASE_URL`) — приложение вернётся к записи под `./data` (монтируйте тот же volume).

## Чеклист прод

1. Backup JSON и отдельно `mysqldump` после перехода.
2. Следить за размером volume MySQL (`mysql_data`).
3. Не удаляйте volume при обычных редеплоях.
4. После успешной миграции можно оставить volume `./data` только для временных файлов или убрать при полной уверенности.
