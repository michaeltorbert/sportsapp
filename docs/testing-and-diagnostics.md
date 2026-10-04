# Regression checks and alert diagnostics

GitHub is the source of truth. Start from current `origin/main` in an isolated worktree and read `AGENTS.md`. Keep existing Sites installations while real-device cutover remains open in [#9](https://github.com/michaeltorbert/sportsapp/issues/9). The shared automated suite is tracked in [#16](https://github.com/michaeltorbert/sportsapp/issues/16); local/cloud access evidence is [#15](https://github.com/michaeltorbert/sportsapp/issues/15). Optional hosted preview is [#11](https://github.com/michaeltorbert/sportsapp/issues/11).

## Local Cloudflare access

Use the pinned local Wrangler and existing login. Do not recreate resources, rotate VAPID keys, apply migrations, or edit cron merely to diagnose access. Set the existing account explicitly because this login can access more than one account.

```sh
export CLOUDFLARE_ACCOUNT_ID=092f7a0a1516725ba2217cfb3760b38f
export WRANGLER_LOG_PATH=.wrangler/diagnostics.log
npx --no-install wrangler --version
npx --no-install wrangler whoami
npx --no-install wrangler d1 execute saturday-signal-alerts \
  --config services/alerts/wrangler.jsonc --remote --json \
  --command "SELECT count(*) AS active_subscriptions FROM subscriptions WHERE active=1; SELECT count(*) AS delivery_attempts FROM deliveries;"
npx --no-install wrangler d1 execute saturday-signal-alerts \
  --config services/alerts/wrangler.jsonc --remote --json \
  --command "SELECT id,value FROM poll_state ORDER BY id; SELECT status,count(*) AS attempts,max(attempted_at) AS latest_attempt_at FROM deliveries GROUP BY status;"
```

Only the shown `SELECT` statements are read-only. Do not replace them with broad table dumps: subscription endpoints, keys, and owner credentials must not appear in issues, review packets or logs. The [D1 command reference](https://developers.cloudflare.com/d1/wrangler-commands/) documents explicit remote execution and JSON output.

Classify failures using the actual layer reached:

| Evidence | Conclusion |
| --- | --- |
| Execution/network approval cancelled before process start | Session approval failed; no Cloudflare HTTP conclusion |
| DNS/network failure, or refresh succeeds only with network permission | Local execution restriction; an apparent expired-token message alone is inconclusive |
| Authentication still fails with network access | Investigate login expiry/revocation; do not print credential files |
| Auth succeeds, scoped API returns permission failure | Account/token authorization issue; retain redacted API code and HTTP status |
| Authenticated Cloudflare API returns another error | Diagnose that specific response, not a generic cloud/local distinction |

The September 7, 2026 local check authenticated with the existing OAuth login after network access was available and completed both count queries. The earlier cloud session's approval-cancellation cause remains unproven; local success does not establish the cloud environment's exact cause. Live counts and outcomes belong in the timestamped issue evidence, not standing assumptions.

Check the website's `/api/health` for exact version and source commit. Check the alerts Worker's `/config` separately with each exact production Origin header; keep its `ready`, `readinessReason`, `lastTickAt`, `lastSuccessfulPollAt`, version and CORS result. Readiness is not proof of phone receipt. `last_tick` indicates scheduler activity, while `last_good_score` indicates a successful poll under the current parser's coverage rules. The poller accepts CDN data only when its selected calendar entry covers both requested Eastern days. Missing, wrong-week, partial-boundary or unreadable CDN data falls back to the date-specific API. If that API also fails (including HTTP 403), the poll fails without advancing the last success; this can happen at the selected calendar entry boundaries. Scheduler freshness alone does not prove full game coverage or phone delivery.

If scheduler evidence needs confirmation, use a bounded `wrangler tail saturday-signal-alerts --config services/alerts/wrangler.jsonc --format json` session, stop it after observing the required ticks, and retain only redacted cron outcome fields. Do not invoke a production poll manually or send a notification just to inspect cron.

## Automated coverage

Run `npm run typecheck` for the standalone TypeScript check, including confirmation that the committed Workers declarations match `wrangler.jsonc`. Run `SOURCE_COMMIT=$(git rev-parse HEAD) npm test` for the build and shared Node suite, then the browser script described in `docs/browser-testing.md`. Run `npm run test:runtime`, `npm run deploy:check`, and `npm run deploy:alerts -- --dry-run` before reviewing deployment-affecting changes. Preview configuration checks require their own rebuild with `CLOUDFLARE_ENV=preview`; rebuild without it before a production deployment.

The push tests use in-memory SQLite, generated temporary cryptographic material and intercepted fetch calls. They never contact a push provider. Service-worker tests execute the actual `public/sw.js`. Mock permission/subscription tests and desktop WebKit with a mobile viewport remain simulations, distinct from installed iPhone Safari verification. Keep [#13](https://github.com/michaeltorbert/sportsapp/issues/13) and [#14](https://github.com/michaeltorbert/sportsapp/issues/14) separate from this coverage change; do not reintroduce older ordering expectations.

## One authorized device test

The proposed `POST /subscriptions/{id}/test` route must be reviewed, merged, released and verified before use. It is absent from production 1.3.0. It uses the existing subscription owner Bearer token, an exact allowed Origin header and JSON `{ "testId": "<UUID v4>" }`. There is no broadcast route or caller-supplied notification text. The tap destination is the root page of that allowed Origin; use the verified installation's origin. The response exposes the test ID, attempt status/time, whether this request claimed the attempt, and `receiptConfirmed: false`.

Use only credentials obtained directly from the intended installed app under an authorized Safari inspection. Confirm the inspected page origin, current version, local PushSubscription and its matching saved owner record. Never paste the owner token, push endpoint or keys into chat, GitHub, command arguments or review packets. A database count or Apple provider hostname cannot identify the phone. If inspection cannot establish ownership, stop for the minimum device assistance rather than choosing an active row.

After identity and the user's readiness are confirmed, close the installed app. Send one request from the local operator environment with the credentials held securely in memory, the verified installation's Origin and a newly generated test ID. Retain that ID and never automatically retry an ambiguous request or switch to a new ID to force a retry. A repeated request with the same ID returns the existing claim/status and cannot send again. Different IDs have an atomic one-minute per-device cooldown; that limit does not authorize additional sends.

The route uses the production `sendPush` function and existing VAPID identity. It writes only a `test:<UUID>` row in the existing delivery ledger; it never creates an `alert_events` row, modifies game history, or injects a football event. Expired 404/410 subscriptions are deactivated consistently with normal delivery. A claim is preserved after a transport, encryption or signing failure. `uncertain` cannot prove whether the provider was contacted. A `claimed` row after interruption must also be treated as possibly attempted, not safe to resend. Provider `accepted` does not establish visible receipt.

`attempted` describes only whether the current request invoked the send operation. `attemptHistory: "attempted"` means that operation is known to have been invoked in this or an earlier request; it does not prove provider contact or receipt. A same-ID replay of a pending or interrupted `claimed` row returns HTTP 202, `attempted: false`, `attemptHistory: "unknown"`, and a `warning` that an earlier request may have attempted the notification and that no other test should be sent. The false value never establishes that an earlier request did not send. `attemptedAt` retains the original claim timestamp, not a confirmed provider-contact time.

A post-attempt database failure returns HTTP 503 with `attempted: true`, `attemptHistory: "attempted"`, `status: "claimed"`, and an explicit instruction not to send another test. The terminal result was not saved; the preserved claim prevents a same-ID resend. Its replay uses the HTTP 202 unknown-history response above because only the claim remains persisted. Do not interpret any HTTP status alone as proof that a notification was or was not delivered. Local concurrency tests exercise request interleaving against one in-memory SQLite connection; they do not prove live D1 concurrency.

Record separately in #9:

1. Verified installed origin/version and active, matching local/server subscription.
2. Actual attempt time, unique test ID and provider outcome. Announce a send only after an actual attempt; distinguish uncertain from accepted.
3. User confirmation that **Saturday Signal: TEST** displayed while the app was closed.
4. User confirmation that tapping opened the expected app/page and current release.
5. Lost-credentials recovery (`Reset alerts` then enable), disable/re-enable, and persistence after reopening. Do not clear a real device's storage without coordinating that device step.

The fixed body is: “This is a test notification, not a game alert. Tap to open Saturday Signal.” Preserve the old installation until replacement delivery and recovery are verified. Neither CI nor the release smoke checks send this test.

## One delayed sample alert (#103)

The same route also accepts exactly `{ "testId": "<UUID v4>", "sample": "one-score" }`. It schedules one synthetic one-score sample (`SAMPLE · One-score game · 4th quarter`, a made-up matchup with made-up ranks and scores) about 10 seconds later, so the user can lock the iPhone first. The contract, ledger statuses and limits are in [the alerts README](../services/alerts/README.md#device-sample-103). Version 1.13.0 released the sample with the location names `Western Kentucky` and `Coastal Carolina`. This change switches to the feed names `Western KY` and `Coastal` but does not deploy them; they reach a device only after a later authorized deployment.

The sample's names match the existing ESPN feed's normalized names for those teams. They do not validate that every team's feed name is recognizable copy, and they do not change the live alert formatter; that criterion stays open in #103.

Procedure, after the release is verified:

1. On the installed iPhone Home Screen app, open Alerts. **Send sample alert** appears only when alerts are on and confirmed for this device, the app is online, notifications are allowed, and this device's current push subscription matches its saved record. Do not use operator credentials or another device.
2. Tap it once. The app shows *Sample scheduled*. Lock the iPhone right away and keep the paired Apple Watch unlocked on the wrist. Watch mirroring is conditional; an iPhone that is unlocked or in use may keep the notification on the phone.
3. After about 10 seconds, note whether the notification appeared on the iPhone lock screen and on the Watch. Record what actually appeared.
4. Reopen the app. It reads the same sample with GET only. *Accepted* means the push provider accepted it, not that it was shown. *Not sent* (late or settings changed) means this sample was not sent. *Not known* or *no result recorded* means neither sending nor not sending is established. *Could not confirm a record yet* after a failed request does not mean a sample cannot still arrive. Tap **I saw it** only if it was actually seen.
5. Do not tap again to retry an unknown result. The button stays disabled for one minute, and a new sample is a new attempt, not a retry.

Device checklist for each sample seen after a later authorized deployment, recorded in #103:

- The exact installed app version (with its release tag or commit when known) and the sample copy actually shown: the location names in 1.13.0, or the feed short names once this change is deployed.
- Which surface showed it (iPhone lock screen, Watch, or both), plus the Watch size and layout.
- The title, both ranks, both scores and both team names exactly as displayed.
- How each line wrapped or was cut off.
- The app attribution shown with the notification.
- Whether tapping it opened the app at its root page (`/`).

So far, one 1.13.0 sample with the location names was reported received natively on the owner's Watch: the away line wrapped so its score moved to the next line, and no clipping was observed. No raw screenshots or photos were reviewed by outside reviewers, and which native platform path displayed it was not instrumented. In source, neither the alert formatter nor the service worker adds the literal text "from Saturday Signal"; the native layer that attributes the notification to the app was not instrumented, and source alone does not show how many notifications the platform displayed. Tapping it has not been tried.

Record separately in #103: the installed version, the sample's displayed status, and the user's own observation of the iPhone and Watch, with screenshots or photos where possible. The sample covers only the one-score format on this iPhone and its paired Watch. It does not validate live one-score or upset-watch alerts, kickoff or final appearance, a tap that opens the actual game, smaller Watch sizes, iPhone, Android or desktop; those stay pending in #103, which stays open as the native acceptance backlog. Automated tests (`tests/sample-notification.test.mjs`, `tests/alert-notification-text.test.mjs`, `tests/browser/alert-sample.spec.mjs`) are simulations with local fixtures and simulated push APIs; they never establish device delivery.
