# FINLAND restoration — 9 November 2026

## Current service

- Website and Mini App: `https://vl.errorclub.club/` and `https://vl.errorclub.club/app/`.
- Telegram bot: `@VL_VPNbot`.
- Host: FINLAND / `vds95645.1cent.network`. SSH address `176.125.254.79`; the same host also owns `64.188.76.78`, used as the Cloudflare origin.
- Working directory: `/root/vpn-bot`.
- Runtime configuration: `/root/vpn-bot/.env` (mode 0600; contains secrets, never commit or print it).
- Compose file: `/root/vpn-bot/docker-compose.yml`.
- Deployed image: `vl-vpn:restore-20261109` (image ID prefix `15e4735ba892`).
- Build sources: `/root/vpn-bot-build/release-20261109`; source archive alongside it.
- Application is bound to `127.0.0.1:3001` behind nginx.
- nginx virtual host: `/etc/nginx/sites-available/vl.errorclub.club`, enabled through `sites-enabled`.
- TLS certificate: `/etc/letsencrypt/live/vl.errorclub.club/fullchain.pem`; private key in the same directory.

The user selected a clean start. `DB_BACKEND=file` persists JSON documents in `/root/vpn-bot/data-clean-20261109`, mounted as `/app/data`. The previous external MySQL database and older backups were not imported. Preserve this directory across deployments; it will contain new balances, payment records and subscription associations.

The former hostname `bot.yozik.ru` and the old external MySQL / remote VPN panel addresses are obsolete. Do not restore those values into an active deployment.

## VPN integration

The application uses the existing local 3X-UI panel, with a dedicated token named `vl-vpn-bot-service-20261109`. Its plaintext is only in the protected runtime `.env` as `XUI_API_TOKEN`. The panel stores the token hash. Existing panel credentials were not reset.

`XUI_API_TOKEN` replaces username/password login. It is used for both reads and mutations; invalid tokens do not fall back to session login. Removing the token from configuration restores the existing username/password flow for installations that use it.

- Panel access inside the container: `http://host.docker.internal:55279`, with the existing secret base path from `.env`.
- Subscription upstream inside the container: `http://host.docker.internal:2096`, with the existing subscription path from `.env`.
- Customer inbound: **3 / CDN-XHTTP** only. `XUI_INBOUND_IDS=3`, `XUI_INBOUND_EXCLUDE_IDS=1`, `XUI_AUTO_DISCOVER_INBOUNDS=0`.
- Returned customer route: **VLESS + XHTTP + TLS, `cdn.errorclub.club:443`**, path `/api/stream`. Its padding and transport settings come from the current panel.
- Inbound **1 / FI / port 2443** remains reserved for the pre-existing controller route. Its public firewall policy was not widened.
- The app relays subscriptions through its public `/sub/xui/<token>` endpoint. Internal panel addresses must not be distributed as customer subscription URLs.
- Stale secondary, tertiary, MTProto and old proxy services are disabled.

Compose defines `host.docker.internal:host-gateway`. UFW allows only the bot bridge `br-dd8bb35b94c8`, subnet `172.19.0.0/16`, to reach host ports 55279 and 2096. **Preserve Compose project name `vpn-bot` and its existing `vpn-bot_default` network.** If the network is recreated or renamed, inspect its bridge/subnet and update these narrow rules before restarting the application. Do not open those management ports to the Internet.

Existing billing and balance reconciliation remain enabled. Expiry notification jobs and test grants are disabled. YooKassa credentials were checked with the read-only `/v3/me` endpoint: account enabled, production mode. No invoice or payment was created during verification.

## Validation performed

- Full automated suite: 17 passing tests. Production build completed.
- Website, Mini App, admin HTML/CSS/JS and emblem assets return HTTP 200 through Cloudflare.
- Anonymous `/api/me` and `/api/admin/config` requests return HTTP 401; an authenticated new-user `/api/me` returns HTTP 200 with an unlinked subscription.
- Telegram webhook is `https://vl.errorclub.club/telegram/webhook`, with zero pending updates and no delivery error. The bot's menu opens `https://vl.errorclub.club/app/`.
- Mini App frame policy permits Telegram Web, while other routes retain the default frame protection.
- Mobile/desktop UI checked at 320–1440 px, including navigation, cold palettes, light theme and reduced motion, with no horizontal overflow or browser script errors.
- Token authentication regression tests cover GET and POST, missing username/password, and rejection without login fallback for HTTP 401/403. The existing cookie and CSRF tests also pass.
- A temporary client was provisioned, queried and updated through the application integration on inbound 3.
- Its subscription returned HTTP 200 and the expected public VLESS/XHTTP/TLS route.
- The host's real Xray binary consumed the returned transport settings in a disposable container. An HTTPS request through that tunnel to Cloudflare's trace endpoint returned HTTP 200 and egress IP `176.125.254.79`.
- The temporary client and validation container were removed; the existing panel still had its original single client. The new application data directory was empty before activation.

`GET /health` is only an application process check. It does not prove database, Telegram, payment or VPN connectivity. Use a temporary provision/subscription/tunnel verification when changing the VPN backend.

The dependency lockfiles were updated within their existing version ranges. The frontend audit is clear; the backend audit retains one moderate `qs` advisory that `npm audit fix` did not resolve. No payment was executed, so payment capture and subsequent balance credit still need a real customer checkout to validate end to end.

## Deploy and inspect

Run commands on FINLAND:

```sh
cd /root/vpn-bot
docker compose config --quiet
docker compose up -d --no-deps bot
docker compose ps
curl -fsS http://127.0.0.1:3001/health
curl -fsSI https://vl.errorclub.club/app/
```

The runtime compose uses `pull_policy: never`; the image selected by `IMAGE` must already exist locally. Build or load the intended application image before deployment. Do not paste unredacted `docker compose config`, `.env`, container environment dumps or token-bearing subscription links into logs or tickets.

## Backups and rollback

- `/root/vpn-bot-backups/restore-20261109`: initial environment, compose and nginx backup prepared before the hostname change.
- `/root/vpn-bot-backups/backend-20261109T132337Z`: environment and compose immediately before clean backend setup, a consistent SQLite backup `x-ui.db`, and prior UFW `user.rules` / `user6.rules`.
- `/root/vpn-bot-backups/payment-fix-20261004T173155Z/app_kv.json`: historical application data from 4 October 2026; intentionally not imported.
- `/root/vl-migration-backup-20261001T/app_kv.sql`: earlier historical application backup.

For a UI/code rollback, first snapshot the current `.env`, compose and **new data directory**, then select a compatible earlier application image while retaining the current domain, clean storage mount and network. Images that predate `XUI_API_TOKEN` support cannot use the new backend configuration; rebuild the earlier frontend with the token-capable backend if necessary.

Do not blindly restore a historical `.env` or compose: that would reintroduce the obsolete hostname, inaccessible MySQL and retired panels. Do not overwrite the live panel database with its snapshot merely to undo the bot integration, since the panel may have acquired unrelated changes. To disconnect the bot, stop its service and revoke only its dedicated API token. Retain its new data and backups for recovery.
