# Background alerts

Status for v1.1.0: implemented and tested locally; not deployed. The Sites controls available in this session expose no one-minute scheduler. The Cloudflare plugin was declined, so this release does not provision an external account or claim push is active. `public/alerts-config.json` intentionally has a null service URL.

## Deployment after a background host is connected

This directory is an independent Worker, outside the Sites runtime. Use Cloudflare Workers Cron Triggers (`* * * * *`) plus **D1**. D1 replaces the proposed KV store because the alert ledger requires unique, atomic writes. No Apple developer account is needed.

1. Authenticate Wrangler to the intended Cloudflare account. Copy `wrangler.jsonc.example` to `wrangler.jsonc` and create a D1 database named `saturday-signal-alerts`. Replace the database ID with the real returned ID.
2. Apply `migrations/0001_alerts.sql` with `wrangler d1 migrations apply saturday-signal-alerts --remote --config services/alerts/wrangler.jsonc`.
3. Generate one stable P-256 ECDSA VAPID key pair. Keep the uncompressed 65-byte public point as base64url in `VAPID_PUBLIC_KEY`, and the JWK private `d` scalar as base64url in the Worker secret `VAPID_PRIVATE_KEY`. Set both with Wrangler secrets using protected stdin or a protected temporary secrets file. Never commit private keys or paste them into chat. Keep these keys across deployments so existing subscriptions remain valid.
4. Deploy with `wrangler deploy --config services/alerts/wrangler.jsonc`. Confirm the one-minute cron is registered. The cron keeps running when every browser is closed; it skips score fetches outside game windows and checks schedules at most every 15 minutes when idle.
5. Confirm `/config` reports `ready: true` after the cron runs and obtains a valid ESPN scoreboard. Check a real iPhone Home Screen subscription and Android Chrome subscription. Test actual notification delivery before calling push active.
6. Set the exact deployed HTTPS origin in `public/alerts-config.json` as `serviceUrl`, increment the app version, and publish a new Sites version.

The API accepts the configured `SITE_ORIGIN`. Subscription endpoints are limited to Apple, Google FCM, and Mozilla push services, and redirects are rejected. Subscription keys are stored only in the alerts database. Public callers cannot list subscribers. A random device token, stored hashed server-side, is required to edit or disable that device’s subscription. HTTP 404/410 responses deactivate expired subscriptions.

## Trigger semantics

- Fourth-quarter one-score: enters the condition `live && period === 4 && margin <= 8`, including a game already close when the fourth quarter starts.
- Fourth-quarter upset: enters `live && period === 4 && ranked team trails lower-ranked/unranked opponent`.
- Upset final: transitions into a final result where the ranked favorite loses. Final UI category retention does not affect this trigger.
- Optional ACC kickoff: crosses into the ten-minute pre-kickoff window. The reminder can be up to one polling interval late.
- The first observation establishes a baseline. Starting the service during the fourth quarter does not replay an existing condition; previously unseen finals do not send retrospective alerts.
- A unique `(game_id, trigger)` ledger survives restarts, corrections, lead changes, and deployments. Each event/subscription pair is claimed atomically before delivery. Subscriptions created after an event are excluded.
- Delivery is **at most one send attempt**, not guaranteed device delivery. Ambiguous failures and rejected sends are not retried, because a retry could violate “no repeats.” The database records accepted, rejected, and uncertain attempts. A failure after claiming but before sending can miss an alert. This is the intentional no-repeat tradeoff; distributed push cannot promise exactly-once user-visible delivery.
- Keep event and delivery ledgers when redeploying. Do not erase history as part of updates. Replacing the D1 database would lose deduplication history.

## Verification

Run `node --test tests/football.test.mjs tests/alerts.test.mjs` from the repository root. Tests include the RFC 8291 published encryption vector, VAPID signature verification, transition sequences and SQL duplicate claims. These do not substitute for a real device push test after deployment.

## References

- [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [Cloudflare KV consistency limitations](https://developers.cloudflare.com/kv/concepts/how-kv-works/)
- [D1 prepared statements and batch transactions](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- [WebKit iPhone Web Push requirements](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)
- [RFC 8291 message encryption](https://datatracker.ietf.org/doc/html/rfc8291)
- [RFC 8292 VAPID](https://datatracker.ietf.org/doc/html/rfc8292)
