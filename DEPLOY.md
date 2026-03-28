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

## 3. Стек в Portainer

1. **Stacks** → **Add stack**
2. **Repository** → URL репозитория, ветка `main`, путь к compose: `docker-compose.yml`
3. Или **Web editor** — вставь содержимое `docker-compose.yml`
4. Добавь переменные из `.env.example` (реальные значения — в Environment)
5. **Deploy**

Образ собирается **в Docker** (`Dockerfile` сам делает `vite build`), папка `public/` в Git не нужна.
