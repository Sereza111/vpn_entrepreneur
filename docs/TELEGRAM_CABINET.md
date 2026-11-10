# Telegram cabinet

The bot's private `/start` and `/cabinet` commands show a personal HTML widget.
`/menu` and the widget's “Текстовое меню” button provide the same core actions
using ordinary messages and inline buttons. Unsupported Telegram clients can
read the caption and use these buttons. If the Bot API rejects widget support,
the bot falls back to text for five minutes before trying again.

## Data and behavior

- The widget contains access status, expiry, balance, primary-inbound traffic,
  and a snapshot timestamp. `ACTIVE` means access is permitted, not that a
  device currently has a VPN connection. No speed or ping is inferred.
- The backend builds an explicit allowlist from `loadMe`. Subscription tokens,
  proxy credentials and account identifiers are absent from widget HTML and
  state. An unavailable panel is `UNKNOWN`, not an absent account.
- State is private `chat_data`; shared/public widgets are not used. Queries
  are accepted only from the private chat owner for a recorded widget message.
  The only widget query is `refresh`; it performs no provisioning or billing.
- Requests are acknowledged before panel reads; snapshots have an eight-second
  response budget and five-second cache. There is no continuous background poll.
- Confirmed payments trigger a fresh card read. A Telegram update failure cannot
  undo a payment or cause a second credit. Latest three cabinet messages per user
  are retained in `telegram-cabinets.json` (or the matching MySQL KV namespace),
  preserving automatic updates across restarts. Older cards can be replaced with
  `/cabinet`. No proactive broadcast or test payment is needed for deployment.
- The existing library routes `widget_query` through generic middleware and uses
  raw Bot API methods. Webhook and polling subscriptions explicitly include this
  update type along with existing messages, callbacks and checkout updates.

## Connection guide

`WEB_APP_URL?view=connect&device=android|ios|windows` and main Mini App
`startapp=connect_android|connect_ios|connect_windows` open the appropriate guide
after normal signed Telegram authentication. `view=balance` / `startapp=balance`
open existing billing. These navigation parameters never identify the user or
authorize a mutation.

The guide uses Happ on Android/iOS and v2rayN on Windows for the deployed XHTTP
route. Subscription copy has a manual selection fallback. Happ import uses a
user-initiated `happ://add/` link; the subscription is never passed to a third-party
redirect service. Telegram/OS may prevent opening the custom scheme, so manual
import remains available. Installation, import and connection are separate steps;
no step pretends to detect that the client has connected.

## Operations and validation

Set `TELEGRAM_WIDGETS_ENABLED=0` to keep text menus while retaining the new guide.
The main Mini App must be configured on the bot (the deployment already has it).
Support links pointing back to the bot itself are suppressed in the widget.

Run `npm test` and `npm run build` before deploying. Unit tests cover size limits,
bridge behavior, query ownership, credential exclusion, timeouts, fallback,
post-payment updates and compatibility with the installed Telegram library.
Browser checks cover navigation after asynchronous authentication, manual copy,
device steps, narrow viewports and no provisioning/payment calls on navigation.
Browser emulation does not validate Telegram's native widget renderer: confirm
`/start`, Refresh and Mini App navigation in an updated Telegram client after
deployment. No real payment is executed by the test suite.

Official references:
- https://core.telegram.org/bots/api#november-9-2026
- https://core.telegram.org/bots/widgets
- https://core.telegram.org/bots/api#sendwidget
- https://core.telegram.org/bots/api#answerwidgetquery
