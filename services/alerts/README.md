# Background alerts

## Game notification eligibility (#101)

Game pushes are ineligible when both teams are confirmed unranked and both have Group-of-Six conference IDs (151/12/15/17/9/37, including Pac-12). This applies to every current and future game trigger, including fourth-quarter/overtime close games, upset watches, finals and kickoff reminders, regardless of other live games. ESPN rank 99 means known unranked; missing rank or conference evidence does not confirm this exclusion. Independents and FCS are not Group of Six. Conference membership alone never establishes a favorite or upset. Scoreboard categories, visibility and ordering stay separate from phone-alert eligibility. This supersedes #82's competition-dependent close-game delivery gate.

The shared trigger conditions prevent new excluded events. Delivery rechecks those conditions before any recipient claim. When an event was created while evidence was unknown, a later accepted poll that confirms exclusion adds a terminal `rule_baselines` row for that existing game/trigger event in the same batch as its new game state. This prevents the queued event from being claimed even if evidence later becomes unknown or another game leaves the slate. It keeps the original event ID, timestamp and delivery history, creates no recipient claim, and consumes no sibling live-alert allowance. No baseline is added where no event exists: a genuine rank or conference correction can create a first eligible event, and missing evidence is not itself proof of exclusion. An already-sent push cannot be recalled.

Trigger IDs, ranked-upset/final/kickoff definitions, recipient claims, deduplication, subscriptions, history, origins and VAPID remain unchanged. Duke notifications remain hard-off. Regression coverage: `tests/alert-competition.test.mjs` plus the existing preferences, claim, activation and transport suites. These tests do not prove phone delivery.

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

The API accepts the configured `SITE_ORIGIN`. Subscription endpoints are limited to Apple, Google FCM, and Mozilla push services. Push requests use Workers-compatible manual redirect handling: redirects are never followed and their 3xx status is recorded as a rejected attempt. Subscription keys are stored only in the alerts database. Public callers cannot list subscribers. A random device token, stored hashed server-side, is required to edit or disable that device’s subscription. HTTP 404/410 responses deactivate expired subscriptions.

## Notification text (#103)

Game alert titles are unchanged: `One-score game · 4th quarter`/`· Overtime`, `Upset watch · 4th quarter`/`· Overtime`, `Upset final`, and `ACC kickoff in 10 minutes`. The body is the away team on the first line and the home team on the second, separated by `\n`. Only kickoff reminders may add a third line. It has no trailing empty line:

```
#5 Clemson 21
#20 Virginia Tech 24
```

- A valid 1–25 rank (`teamRank`) appears as `#N` before the name. Unknown, unranked or out-of-range ranks add nothing.
- Live and final alerts end each team line with its score (`–` if missing). Kickoff reminders show no score.
- Kickoff reminders add the broadcast line only when one is known. One-score, upset watch and upset final alerts add no third line; the scores already show the margin or tie.
- Names use the normalized `team.name`, which falls back from ESPN `shortDisplayName` to location, display name, then abbreviation. Names are not truncated. The system decides how a long line wraps or is cut off.

Event IDs, game days, URLs, trigger conditions, delivery, and `public/sw.js` display and tap handling are unchanged. The service worker passes the body string to `showNotification` as is. The web app manifest and app identity are unchanged. The game payload never includes the literal text "from Saturday Signal". Apple documentation suggests the system attributes a web app notification to the app name. How a notification mirrored from an iPhone appears on Apple Watch has not been verified. Tests in `tests/alert-notification-text.test.mjs` and `tests/push-delivery.test.mjs` check the exact payload and service-worker pass-through only. Before issue #103 is accepted, it still needs visual evidence from a real small Apple Watch showing line breaks, long-name wrapping, ranks, scores, the title and the app attribution, plus a working tap.

### Device sample (#103)

`alertText(game, trigger)` in `rules.ts` is the one pure title/body formatter; `transitions` uses it, so real payloads and the sample always share one format. `sample.ts` builds a single static sample through the same formatter from a synthetic game. It is not a live game; the matchup, ranks and scores are made up and do not come from any fixture game:

```
SAMPLE · One-score game · 4th quarter
#21 Western KY 24
#4 Coastal 27
```

The team names are the ones a real alert shows for these teams: the saved ESPN feed `tests/fixtures/guide-2026-09-12.json` normalizes team IDs 98 and 324 to `Western KY` and `Coastal`. `tests/alert-notification-text.test.mjs` binds the sample to those names and checks that a missing or empty short name falls back to the location, display name, then abbreviation. The sample therefore matches the existing feed. It does not show that every team's feed name is recognizable copy (team 193, for example, is `Miami OH`, or `Miami (OH)` by location), and it does not change the live formatter or the feed parser; that criterion stays open in #103. Matching the feed was chosen over the more familiar `Coastal Carolina`.

Its `eventId` is `test:<UUID>` and its tap URL is the allowed Origin's root (`/`). There is no game ID, event row, game link, caller-supplied text or recipient.

- **Request.** `POST /subscriptions/{id}/test` with exactly `{"testId":"<UUID v4>","sample":"one-score"}`, the owner Bearer token and an exact allowed Origin. If `sample` is present, any other value or any extra key returns 400 before a claim. Without `sample`, the existing synchronous generic test is unchanged.
- **Claim.** The sample shares the `test:<UUID>` ledger key, permanent UUID deduplication and the atomic one-minute per-device cooldown with the generic test. Its kind is stored as a `sample:*` status prefix in the existing `deliveries.status` column; there is no migration. Reusing one UUID across kinds returns 409 `test-kind-conflict` and never sends the other payload, both on the initial read and after a lost concurrent claim. A same-kind replay only reads the stored status.
- **Scheduling.** The request requires an active subscription with its settings row (`INNER JOIN subscription_settings`; a missing row fails closed), VAPID configuration and `ExecutionContext.waitUntil`. It captures the endpoint, both keys, the owner token hash and the settings `revision`. It writes `sample:scheduled` before scheduling one `waitUntil` task, then returns 202 with `status: "scheduled"`, `attempted: false`, `attemptHistory: "none"` and `receiptConfirmed: false`. There is no queue, cron or retry.
- **Delayed send.** The task waits about 10 seconds. If more than 15 seconds elapsed on the task's clock, it conditionally marks `sample:late` and sends nothing. Otherwise one guarded `UPDATE` changes `sample:scheduled` to `sample:sending` only while the subscription is active with the same token hash, endpoint, `p256dh`, `auth` and settings revision. Registration can rewrite keys without changing the revision, so the keys are compared directly. Only `meta.changes === 1` authorizes transport; missing, malformed or other metadata, or an error, never sends and never infers success from a reread. A failed guard conditionally marks `sample:suppressed`. `sendPush` then runs at most once with the captured endpoint and keys and records `sample:accepted`, `sample:http-N` or `sample:uncertain`. A failed result write leaves `sample:sending`, which reads as unknown; nothing is resent. A 404/410 deactivates the subscription only if the captured endpoint, keys, token hash and settings revision still match, so a later re-registration or settings change stays active.
- **Known race.** The guard runs immediately before transport, but a settings change or opt-out committed in the short gap after the guard can still race the send. A sample is not guaranteed to be cancelled by a concurrent change.
- **Status read.** `GET /subscriptions/{id}/test/{UUID}` requires the owner token and an exact allowed Origin. It never claims, sends or writes. A missing row is 404: *not recorded yet*, not proof that no sample will ever exist, since a delayed POST can still arrive. A generic-test UUID returns 409. Bare `GET /test` stays 404. `scheduled`/`sending` return 202 with `overdue: true` after about 30 seconds plus a warning that no result was recorded; that does not show whether the sample was or was not sent. `late` and `suppressed` mean this sample was not sent. `accepted` is provider acceptance only. `uncertain` means the result is not known. No status proves device receipt (`receiptConfirmed` is always false).
- **Readiness.** `/config` adds `sampleVersion: 1`. The app shows the control only when the service reports it, so an older Worker can never receive a sample request it would treat as a generic test.

The app's **Send sample alert** control appears only for this installed device. Alerts must be active and owner readback confirmed, the browser online, Notification permission granted, and the current local PushSubscription endpoint's base64url SHA-256 must equal the saved subscription ID. All of these are checked again immediately before the one POST. The browser keeps the owner token in its existing storage, sends with `credentials: "omit"`, and saves only the nonsecret `{testId, at, subscriptionId}` before posting. A reload, visibility change, timeout or network failure reads that same UUID with GET and never repeats the POST. The control stays disabled while unresolved and for 60 seconds after the last attempt. Its short help says the alert is made up and labeled SAMPLE, and asks the user to lock the iPhone and keep the Watch unlocked on the wrist. If the GET finds no row, the app says it could not confirm a record yet, that a delayed request could still deliver it, and that it will not be resent; the same 404 also covers failed ownership, which the app does not distinguish. A user-tapped "I saw it" is kept only in memory and is the only receipt signal.

This sample targets the user's iPhone and paired Apple Watch for the one-score format only. It does not by itself validate kickoff or final appearance, tap-to-game navigation, Android or desktop, or Watch rendering of other alerts. Tests are simulations, not device delivery: `tests/sample-notification.test.mjs` (local SQLite, intercepted transport), `tests/alert-notification-text.test.mjs` (feed names and fallbacks) and `tests/browser/alert-sample.spec.mjs` (simulated push APIs and service). None sends a real notification.

Device evidence so far: version 1.13.0 released the sample with the location names `Western Kentucky` and `Coastal Carolina`. The owner reported one native Watch receipt of it: the away line wrapped so its score moved to the next line, and no clipping was observed. That is the owner's report only; no raw screenshots or photos were reviewed by outside reviewers, and which native platform path displayed it was not instrumented. The app source shows the sample once and adds no duplicate notification. Tapping it has not been tried. This change does not deploy the shorter feed names; they can reach a device only after a later authorized deployment, which should be checked with the device checklist in [testing and diagnostics](../../docs/testing-and-diagnostics.md#one-delayed-sample-alert-103). Live one-score and upset-watch alerts, finals, kickoff reminders, a tap that opens the actual game, smaller Watch sizes, iPhone, Android and desktop remain pending in #103, which stays open as the native acceptance backlog.

## Trigger semantics

- Fourth-quarter/overtime one-score: enters `live && period >= 4 && margin <= 8`, including ties and a game already close when the fourth quarter starts.
- Fourth-quarter/overtime upset: enters `live && period >= 4 && ranked team trails lower-ranked/unranked opponent`. A tie is not an upset.
- Upset final: transitions into a final result where the ranked favorite loses. Final UI category retention does not affect this trigger.
- Optional ACC kickoff: crosses into the ten-minute pre-kickoff window. The reminder can be up to one polling interval late.
- First observation catches up qualifying live Q4/overtime games. Previously unseen finals and upcoming games establish a baseline, so startup does not replay finished upsets. Previously observed games keep their D1 snapshots across restarts and gaps.
- Existing trigger IDs `one-score-fourth` and `ranked-trailing-fourth` intentionally cover both Q4 and overtime. Do not rename them or clear their history on upgrade.
- A unique `(game_id, trigger)` ledger survives restarts, corrections, lead changes, and deployments. Each event/subscription pair is claimed atomically before delivery. Subscriptions created after an event are excluded.
- Delivery is **at most one send attempt**, not guaranteed device delivery. Ambiguous failures and rejected sends are not retried, because a retry could violate “no repeats.” The database records accepted, rejected, and uncertain attempts. A failure after claiming but before sending can miss an alert. This is the intentional no-repeat tradeoff; distributed push cannot promise exactly-once user-visible delivery.
- Sender exceptions remain `uncertain` in the existing ledger. Structured `push_send_failed` logs identify only the stage (`serialize`, `encrypt`, `vapid`, or `transport`), without exception details, endpoints, payloads, or keys. A transport-stage failure does not establish whether the provider received the request. If response-body cleanup fails after an HTTP response, `push_response_cleanup_failed` records only its status; the received status still determines the ledger result. None of these diagnostics authorizes another attempt or establishes visible phone delivery.
- Keep event and delivery ledgers when redeploying. Do not erase history as part of updates. Replacing the D1 database would lose deduplication history.

## Score-feed coverage

Each poll needs yesterday and today in Eastern time. ESPN's CDN feed ignores requested dates and serves its currently selected football week. The shared `completeCdnRange` helper first accepts a single week only when `normalizeCdnRange` proves full coverage. At an overnight week boundary, it explicitly requests the adjacent weeks using year, season type, and week. Every response must match the requested identity and calendar dates. Their calendars must form a continuous range covering both complete Eastern days; ESPN's end timestamps name the final inclusive minute. Missing weeks, calendar gaps, identity changes, and unreadable games fail closed. Only the fully validated union can supply an empty successful poll. The union supports weeks within the selected season type only; regular-season/postseason transitions remain unsupported by this CDN fallback. If CDN coverage remains unproven, the poller tries the date-specific site API. The initial CDN request and all adjacent-week requests share one fifteen-second deadline; the site API has its own fifteen-second attempt.

If both sources fail, including a rejected CDN board plus a site API error, the poll fails: game states, alert history, deliveries, `last_good_score`, and `next_poll` are untouched, `last_tick` advances, the lock is released, and `/config` reports `stale-score-feed` once the last success is at least twenty minutes old, provided the earlier VAPID configuration, scheduler tick, and prior-success checks pass. Readiness is never manufactured from an unproven board. This conservative failure is deliberate; a game on a partially covered boundary day with the site API blocked receives no alert, and the readiness gate makes that visible.

## Verification

Run `npm test` from the repository root for the complete application regression suite, including feed coverage, delivery/transport, and notification-route checks. For focused football rules and poller checks only, run `node --test tests/football.test.mjs tests/alerts.test.mjs`. The full suite includes the RFC 8291 encryption vector, VAPID signature verification, transition sequences, and SQL duplicate claims. Network sends are intercepted and databases are local test fixtures; these checks do not establish real-device delivery.

Run `NODE_USE_ENV_PROXY=1 node scripts/check-alerts-poll.mjs` only when an opt-in live ESPN diagnostic is needed. It runs the current poller with an empty in-memory subscription database and throwaway VAPID keys. Its fetch guard permits only the exact HTTPS college-football scoreboard GETs used by the poller: the initial CDN request, at most three explicitly identified adjacent-week CDN requests, and the yesterday-through-today date-API fallback. It rejects other hosts, paths, queries, methods, headers, excess requests, and push destinations before network access; redirects are not followed. No external database writes or real notification sends occur.

The JSON output lists each permitted `attempt` with its source and HTTP status or local network error. `acceptedSource` identifies the feed the poller accepted; `cdnFallback: response-rejected` means the CDN answered successfully at HTTP level but its board did not pass the poller's validation. `redirect-not-followed` means the CDN returned HTTP 3xx; the diagnostic deliberately stops there, while production fetch may follow the redirect. A forbidden request makes the run fail with `attribution: diagnostic-allowlist`, even if the poller caught that error and continued to another feed. `score-feed-attempts` reports failures of the allowed local feed attempts with the poller's separate `cdn:` and `site-api:` reasons; `local-poller` identifies a later failure such as an in-memory database error. The tests deliberately seed a local subscription to prove the guard blocks push transport; the resulting `uncertain` row is local test state and no provider is contacted. These are local observations, not evidence of a production feed failure, Cloudflare execution, or phone delivery. The September 5 at 23:46 UTC sample (76 games, 8 Friday and 68 Saturday, two candidate alerts) is historical and does not establish present feed health.

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
