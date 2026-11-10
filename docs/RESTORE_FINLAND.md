# FINLAND restoration — 9 November 2026

## Current service

- Website and Mini App: `https://vl.errorclub.club/` and `https://vl.errorclub.club/app/`.
- Telegram bot: `@VL_VPNbot`.
- Host: FINLAND / `vds95645.1cent.network`. SSH address `176.125.254.79`; the same host also owns `64.188.76.78`, used as the Cloudflare origin.
- Working directory: `/root/vpn-bot`.
- Runtime configuration: `/root/vpn-bot/.env` (mode 0600; contains secrets, never commit or print it).
- Compose file: `/root/vpn-bot/docker-compose.yml`.
- Deployed image: `vl-vpn:cabinet-5c0f90f` (image ID prefix `ba171f5e875b`; updated 10 November 2026).
- Build sources: `/root/vpn-bot-build/release-cabinet-5c0f90f`; source archive `/root/vpn-bot-build/cabinet-5c0f90f.tar.gz`.
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

## Telegram cabinet deployment — 10 November 2026

Source commit `5c0f90fcf21f6d2719a8dbb712b0ddb9b68f1898` adds the private-chat HTML Widget cabinet, text fallback and device connection instructions. The widget is generated from `src/bot/widget.source.html` during the Docker build; the deployed result is 9,456 raw bytes / 4,042 zlib bytes.

- All 35 automated tests and the production build passed before deployment. An isolated candidate with separate empty data, no network and background jobs disabled passed process health, Mini App HTML and anonymous API checks.
- Backup: `/root/vpn-bot-backups/cabinet-5c0f90f-20261110T202040Z`, containing the current protected `.env`, compose, data snapshot and container/network baseline. `data-before-switch` is an additional snapshot taken immediately before replacement.
- Only `IMAGE` changed in the runtime `.env`; `docker compose up -d --no-deps bot` replaced the bot container. Its existing data mount and Compose network were retained. All other container IDs and start times remained unchanged.
- Public `/health` and `/app/` return HTTP 200. `/app/assets/index-D7_MflUp.js` and `/app/assets/index-DFRHBVvU.css` return HTTP 200. Anonymous `/api/me` and `/api/admin/config` return HTTP 401. The Mini App still permits framing by Telegram Web.
- Telegram confirms `allowed_updates`: `message`, `callback_query`, `pre_checkout_query`, `widget_query`; zero pending updates and no delivery error at verification.
- A `sendWidget` preflight used nonexistent `chat_id=0` and returned HTTP 400 `chat not found`, confirming that the endpoint recognizes the method. No message was sent to a real chat. Native Telegram rendering and a real user's widget refresh remain unverified; no payment or customer provisioning was performed during this deployment.
- Existing subscription associations were unchanged. Balance records retained their accounts and continued the already-enabled billing accrual; runtime data was not replaced with a backup.

The preceding image `vl-vpn:restore-20261109` (ID prefix `15e4735ba892`) and its sources `/root/vpn-bot-build/release-20261109` remain available. To roll back application code, snapshot current runtime files again, select that image via `IMAGE`, and run `docker compose up -d --no-deps bot`. Preserve the current `.env` settings, live data and network; do not restore older balances merely to revert the UI.

## Restoration validation — 9 November 2026

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
