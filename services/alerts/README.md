# Background alerts

Status for v1.1.4: the existing Worker is deployed and healthy. Authenticated Wrangler access confirmed the claimed Scythe Wildflower account, the existing D1 database and VAPID secrets, and the one-minute cron. Live logs identified the old failure as ESPN site API HTTP 403 from Cloudflare's network. The Worker now uses ESPN's CDN scoreboard feed first and retains the site API as a fallback. `/config` reported `ready: true`; D1 contained fresh tick/success timestamps and all 76 Friday/Saturday games. See `deployment.json` for nonsecret resource identifiers.

The app has the service URL configured and rechecks readiness every 30 seconds while visible. Background polling is verified. No active device subscriptions existed at the v1.1.4 verification point, so real-device delivery is still untested and must not be marked complete until an iPhone Home Screen installation successfully subscribes and receives a legitimate test or game alert.

Next verification: reopen the iPhone Home Screen app and tap Enable alerts after its readiness refresh. Confirm a new active subscription in D1, then verify one real device notification without notifying unrelated subscribers. Do not add a duplicate cron, recreate the database, rotate VAPID keys, or erase event history.

Future deployments require an authenticated connection to the claimed account. Reuse the existing Worker, D1 database, and VAPID identity. Never recreate the database or rotate keys as a way to restore management access. Temporary claim links and credentials have been removed.

## Prepared v1.2.0 migration

The versioned `wrangler.jsonc` adds `ADDITIONAL_SITE_ORIGINS` for the exact new production website while retaining `SITE_ORIGIN` for the existing Sites publication. No wildcard or preview origin is allowed. The release workflow deploys this existing Worker before the website. This is prepared source; `deployment.json` continues to describe the last verified live v1.1.4 deployment until a migration deployment is checked. See [the release guide](../../docs/releases.md).

## Update this existing deployment

1. Authenticate to the claimed account using a supported secure connection or local Wrangler login. Do not paste API tokens or private keys into chat.
2. Use the versioned `services/alerts/wrangler.jsonc` with the **existing** account and database IDs in `deployment.json`. Preserve the Worker name, `DB` binding, both production origins, VAPID secrets, observability, and `triggers.crons: ["* * * * *"]`. There is no database migration in v1.2.0.
3. Deploy with `wrangler deploy --config services/alerts/wrangler.jsonc`. Verify `/config` reports the intended version, the existing cron is present, and the next scheduled invocation succeeds. `wrangler tail --config services/alerts/wrangler.jsonc --format json` can inspect new invocations while connected.
4. Reopen the iPhone Home Screen app and enable alerts only after readiness becomes true. Verify a real device notification before marking delivery tested. Saving or publishing the separate Sites frontend does **not** deploy this external Worker.

## Deployment after a background host is connected

The steps in this section are for a new installation only, not the already-claimed deployment above.

This directory is an independent Worker, outside the Sites runtime. Use Cloudflare Workers Cron Triggers (`* * * * *`) plus **D1**. D1 replaces the proposed KV store because the alert ledger requires unique, atomic writes. No Apple developer account is needed.

1. Authenticate Wrangler to the intended Cloudflare account. Copy `wrangler.jsonc.example` to `wrangler.jsonc` and create a D1 database named `saturday-signal-alerts`. Replace the database ID with the real returned ID.
2. Apply `migrations/0001_alerts.sql` with `wrangler d1 migrations apply saturday-signal-alerts --remote --config services/alerts/wrangler.jsonc`.
3. Generate one stable P-256 ECDSA VAPID key pair. Keep the uncompressed 65-byte public point as base64url in `VAPID_PUBLIC_KEY`, and the JWK private `d` scalar as base64url in the Worker secret `VAPID_PRIVATE_KEY`. Set both with Wrangler secrets using protected stdin or a protected temporary secrets file. Never commit private keys or paste them into chat. Keep these keys across deployments so existing subscriptions remain valid.
4. Deploy with `wrangler deploy --config services/alerts/wrangler.jsonc`. Confirm the one-minute cron is registered. The cron keeps running when every browser is closed; it skips score fetches outside game windows and checks schedules at most every 15 minutes when idle.
5. Confirm `/config` reports `ready: true` after the cron runs and obtains a valid ESPN scoreboard. Check a real iPhone Home Screen subscription and Android Chrome subscription. Test actual notification delivery before calling push active.
6. The deployed origin is already configured in `public/alerts-config.json`. Preserve the readiness gate and publish any further changes under a new version.

The API accepts the configured `SITE_ORIGIN`. Subscription endpoints are limited to Apple, Google FCM, and Mozilla push services, and redirects are rejected. Subscription keys are stored only in the alerts database. Public callers cannot list subscribers. A random device token, stored hashed server-side, is required to edit or disable that device’s subscription. HTTP 404/410 responses deactivate expired subscriptions.

## Trigger semantics

- Fourth-quarter/overtime one-score: enters `live && period >= 4 && margin <= 8`, including ties and a game already close when the fourth quarter starts.
- Fourth-quarter/overtime upset: enters `live && period >= 4 && ranked team trails lower-ranked/unranked opponent`. A tie is not an upset.
- Upset final: transitions into a final result where the ranked favorite loses. Final UI category retention does not affect this trigger.
- Optional ACC kickoff: crosses into the ten-minute pre-kickoff window. The reminder can be up to one polling interval late.
- First observation catches up qualifying live Q4/overtime games. Previously unseen finals and upcoming games establish a baseline, so startup does not replay finished upsets. Previously observed games keep their D1 snapshots across restarts and gaps.
- Existing trigger IDs `one-score-fourth` and `ranked-trailing-fourth` intentionally cover both Q4 and overtime. Do not rename them or clear their history on upgrade.
- A unique `(game_id, trigger)` ledger survives restarts, corrections, lead changes, and deployments. Each event/subscription pair is claimed atomically before delivery. Subscriptions created after an event are excluded.
- Delivery is **at most one send attempt**, not guaranteed device delivery. Ambiguous failures and rejected sends are not retried, because a retry could violate “no repeats.” The database records accepted, rejected, and uncertain attempts. A failure after claiming but before sending can miss an alert. This is the intentional no-repeat tradeoff; distributed push cannot promise exactly-once user-visible delivery.
- Keep event and delivery ledgers when redeploying. Do not erase history as part of updates. Replacing the D1 database would lose deduplication history.

## Score-feed coverage

Each poll needs yesterday and today in Eastern time. ESPN's CDN feed ignores requested dates and serves its currently selected football week. The shared `completeCdnRange` helper first accepts a single week only when `normalizeCdnRange` proves full coverage. At an overnight week boundary, it explicitly requests the adjacent weeks using year, season type, and week. Every response must match the requested identity and calendar dates. Their calendars must form a continuous range covering both complete Eastern days; ESPN's end timestamps name the final inclusive minute. Missing weeks, calendar gaps, identity changes, and unreadable games fail closed. Only the fully validated union can supply an empty successful poll. The union supports weeks within the selected season type only; regular-season/postseason transitions remain unsupported by this CDN fallback. If CDN coverage remains unproven, the poller tries the date-specific site API. The initial CDN request and all adjacent-week requests share one fifteen-second deadline; the site API has its own fifteen-second attempt.

If both sources fail, including a rejected CDN board plus a site API error, the poll fails: game states, alert history, deliveries, `last_good_score`, and `next_poll` are untouched, `last_tick` advances, the lock is released, and `/config` reports `stale-score-feed` once the last success is at least twenty minutes old, provided the earlier VAPID configuration, scheduler tick, and prior-success checks pass. Readiness is never manufactured from an unproven board. This conservative failure is deliberate; a game on a partially covered boundary day with the site API blocked receives no alert, and the readiness gate makes that visible.

## Verification

Run `npm test` from the repository root for the complete application regression suite, including feed coverage, delivery/transport, and notification-route checks. For focused football rules and poller checks only, run `node --test tests/football.test.mjs tests/alerts.test.mjs`. The full suite includes the RFC 8291 encryption vector, VAPID signature verification, transition sequences, and SQL duplicate claims. Network sends are intercepted and databases are local test fixtures; these checks do not establish real-device delivery.

Run `NODE_USE_ENV_PROXY=1 node scripts/check-alerts-poll.mjs` to execute the current poller against ESPN using an empty in-memory subscription database. Only the ESPN scoreboard request is permitted; no pushes or external database writes occur. On September 5 at 23:46 UTC the patched query read 76 games (8 Friday, 68 Saturday), generated two qualifying one-score candidate events, and scheduled the next poll one minute later. This is a local diagnostic, not evidence of Cloudflare execution or notification delivery.

The endpoint's date-range upper bound is exclusive. `scoreboardUrl` converts the app's inclusive end day into the following date; normalization still filters out games outside the requested Eastern-date window. The old range incorrectly omitted Saturday and falsely selected the idle polling interval. That omission does not by itself explain v1.1.1's `ready:false`, because even a valid all-final board updates the successful-poll timestamp.

## References

- [Cloudflare temporary accounts and claiming](https://developers.cloudflare.com/workers/platform/claim-deployments/)
- [D1 platform limits](https://developers.cloudflare.com/d1/platform/limits/)
- [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [Cloudflare KV consistency limitations](https://developers.cloudflare.com/kv/concepts/how-kv-works/)
- [D1 prepared statements and batch transactions](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- [WebKit iPhone Web Push requirements](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)
- [RFC 8291 message encryption](https://datatracker.ietf.org/doc/html/rfc8291)
- [RFC 8292 VAPID](https://datatracker.ietf.org/doc/html/rfc8292)
