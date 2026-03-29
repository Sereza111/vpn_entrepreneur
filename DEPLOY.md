# Деплой: Portainer + Git

## 1. Подключить новый Docker-сервер к Portainer

Предположение: **Portainer уже открыт в браузере** (на старом сервере или где он у тебя установлен), а **новый** VPS — только Docker-хост.

### На новом сервере (SSH под `root`)

1. Убедись, что Docker работает: `docker version`
2. Открой порт **9001/tcp** в фаерволе **только для IP сервера, где крутится Portainer** (или временно для своего IP для проверки).
3. Запусти **Portainer Agent** (версию подставь как у твоего Portainer, лучше совпадение мажорной, например `2.21.5`):

```bash
docker run -d \
  -p 9001:9001 \
  --name portainer_agent \
  --restart=always \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /var/lib/docker/volumes:/var/lib/docker/volumes \
  portainer/agent:2.21.5
```

4. Проверка: с сервера Portainer (или с ноута): `curl -sI http://НОВЫЙ_IP:9001` — не должно быть «connection refused».

### В веб-интерфейсе Portainer

1. **Environments** → **Add environment**
2. Тип: **Docker Standalone** → **Portainer Agent**
3. В поле адреса укажи: `НОВЫЙ_IP:9001` (как в подсказке Portainer, часто формат `85.198.x.x:9001`)
4. Сохрани и выбери это окружение при создании стека.

Если хостинг даёт кнопку **«Информация о Portainer»** — открой её: там часто готовая команда агента под их шаблон.

---

## 2. Репозиторий и push на GitHub

Локально (в папке проекта):

```bash
git init
git add .
git commit -m "Initial commit: Telegram VPN mini-app + Remnawave"
```

На GitHub создай **пустой** репозиторий (без README), затем:

```bash
git remote add origin https://github.com/USER/REPO.git
git branch -M main
git push -u origin main
```

Секреты (**`.env`**) в Git не клади — в Portainer задашь их в **Environment variables** стека или через **Secrets**.

---

## 3. Сборка образа на GitHub (без build в Portainer)

1. В репозитории на GitHub: **Settings** → **Actions** → **General** → разреши *Workflow permissions* с правом **Read and write** (или оставь по умолчанию для `GITHUB_TOKEN` публикации в Packages — обычно уже ок).
2. Сделай `git push` в `main`. Открой вкладку **Actions** — workflow **Docker publish** должен собрать образ и отправить в **GitHub Container Registry**.
3. Открой **Packages** у своего пользователя/организации — пакет будет `ghcr.io/<логин>/<репозиторий>`. Тег **`latest`** и хеш коммита.
4. Если пакет **приватный**: в Portainer добавь **Registries** → **Docker Hub / Custom registry**: URL `ghcr.io`, логин — твой GitHub username, пароль — **Personal Access Token** с правом `read:packages`.

---

## 4. Стек в Portainer (только pull образа)

1. **Stacks** → **Add stack** → **Repository** → URL репо, ветка `main`, compose: `docker-compose.yml`
2. В **Environment variables** (**Advanced mode**) добавь обязательно:
   - **`IMAGE`** — полный путь образа, например `ghcr.io/твой_логин/имя_репо:latest` (строчными буквами, как в URL пакета на GitHub).
   - остальные переменные из [`.env.example`](.env.example) (`BOT_TOKEN`, `REMNAWAVE_*`, …).
3. **Deploy** — Portainer скачает готовый образ, **сборки на сервере не будет** (нет ошибок BuildKit / http2).

Локальная сборка с нуля: `docker compose -f docker-compose.local.yml --env-file .env up --build`
