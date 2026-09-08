# Saturday Signal releases

## 1.3.4 · 2026-09-07

- Resolve repository lint errors with hydration-safe browser state and framework home navigation that restores Today (#1).
- Distinguish current device-test attempts from uncertain prior claims, explicitly warn against resending, and cover replay safety (#20).
- Preserve alert authorization, exact origins, UUID deduplication, cooldown, subscriptions, VAPID keys, and delivery history.

## 1.3.3 · 2026-09-07

- Restore the required TypeScript/declaration check to pull-request CI.
- Preserve unique feed-boundary, saved-history, and intercepted-notification regression checks from superseded PRs.
- Document conservative alert-feed failures and paused-game history, and correct the full alert regression command (#24).
- Preserve existing alert behavior, ownership, subscriptions, VAPID keys, trigger IDs, and delivery deduplication.

## 1.3.2 · 2026-09-07

- Reject alert feeds that cannot prove complete date coverage, retaining the verified fallback and existing alert ownership, trigger IDs, deduplication, subscriptions, and delivery history (#18).
- Preserve one-score game history through delays and reloads without changing live phone-alert conditions (#13).
- Restore the standalone TypeScript check with Wrangler-generated Workers runtime and binding declarations that match the website's configuration, and add `npm run typecheck` (#6).

## 1.3.1 · 2026-09-06

- Add an authenticated single-device TEST notification route using the existing push sender and VAPID identity, with permanent request deduplication and an atomic per-device cooldown. Test deliveries remain separate from football events.
- Add regression coverage for encrypted push outcomes, eligibility, polling failure and locking, and actual service-worker display/click behavior.
- Run one deterministic mobile Chromium/WebKit suite in existing CI, covering tabs, scopes, saved preferences, failed refreshes, midnight rollover and simulated alert recovery.
- Document reproducible local Cloudflare diagnostics and the separate real-iPhone verification procedure. Provider acceptance and automated simulations do not establish visible phone delivery.

## 1.3.0 · 2026-09-06

- Combine team relevance, live drama, and upset significance into one shared ordering rule. Keep early ties low in urgency and ranked blowouts below close finishes.
- Add validated pregame favorite evidence and clearly labeled unranked ACC/SEC conference watches. Preserve existing ranking-only phone triggers and explain their differences from watchlist badges.
- Improve favorite lookup fairness and failure backoff, retain known lines through feed omissions, and keep started-delay upset watches through comeback finals.
- Add scenario and rendered regression coverage. Track nonblocking continuity and refinement work separately in issues #13 and #14.

## 1.2.0 · 2026-09-06 · prepared, not deployed

- Prepare the website for Cloudflare Workers at its provider address, with GitHub PR tests, optional preview deployment, and a tagged-release production workflow.
- Verify each deployed website against its exact source commit and version, static assets, score API, and alert readiness. Preserve the existing alert Worker, database, cron and VAPID identity; allow both old and new production origins during migration.
- Add a guarded current-week CDN fallback for the server score API when Cloudflare cannot reach ESPN’s date-specific endpoint. Reject unproven date coverage rather than show the wrong week.
- Include the previously merged weekly Top 25 schedule change, including future ACC and non-ACC ranked matchups.

## 1.1.5 · 2026-09-06

- Keep daily and weekly ACC scoreboards available together so tab counts do not disappear when switching views. Each count follows its destination tab and the Hide finals setting.
- Refresh both scopes independently, preserve successful scores when the other feed fails, and exclude cached boards from the wrong day or week.
- Keep weekly category history through the end of the ACC range when clearing old device data, so weekend reloads do not discard it.
- Clarify that one-score and upset views include retained finals. Show the overnight Today notice only on daily views; preserve the existing overnight rollover rules.
- Add regression checks for tab switching, date changes, independent refresh failures, overnight reuse, and final visibility.

## 1.1.4 · 2026-09-06

- Fix hosted background polling after live Worker logs proved ESPN's site API returns HTTP 403 from Cloudflare's network.
- Use ESPN's public CDN scoreboard envelope as the primary Worker feed. Request singular `group=80`, which returns the complete FBS week; plural `groups=80` silently returns the default 25-game board.
- Preserve the site API as a fallback and keep normalization's Eastern-date filter. A Cloudflare remote preview returned 99 weekly FBS games, including the same 8 Friday and 68 Saturday games verified by the local v1.1.3 diagnostic.
- Add regression coverage for the CDN envelope, complete-feed parameter, fallback path, and local workspace paths containing spaces. Replace the Linux-only build timeout with a Node-based bounded runner so the verified build works on macOS too. No database migration, key rotation, subscription reset, or trigger-ID change is required.
- Deployed the existing Worker in place. Cloudflare confirmed the one-minute schedule; `/config` reported `ready: true` on v1.1.4, and D1 contained fresh tick/success timestamps plus all 76 games. No active device subscriptions existed at verification time, so real iPhone delivery remains untested.

## 1.1.3 · 2026-09-05 · prepared, not deployed

- Include overtime (`live && period >= 4`) in the one-score and ranked-trailing alert conditions. Ties qualify for one-score alerts, not upset alerts. Overtime notifications use accurate titles.
- Alert on the first observation of a qualifying live game. Keep first-seen finals and upcoming kickoffs baseline-only, and preserve transition handling for games already stored in D1.
- Preserve existing trigger IDs and unique event/delivery ledgers, so moving from Q4 into overtime or redeploying cannot reset duplicate protection. No migration or key rotation is required.
- Correct ESPN date ranges: the feed treats the range end as exclusive, while app windows are inclusive. A live diagnostic found the old Friday-to-Saturday query returned only 8 Friday games. Including Sunday as the exclusive endpoint returned 8 Friday and 68 Saturday games. This also includes Monday correctly in the ACC window.
- Add safe `/config` readiness reasons and last-tick/last-success timestamps. Presence of a public key alone still does not prove the service is ready.
- Add regression tests for overtime, initial live catch-up, first-seen final suppression, feed date boundaries, polling persistence, and readiness diagnostics. Add a local read-only ESPN poll diagnostic with no subscribers or push requests.
- The owner reports the cron was added, but its registration and execution are unverified. The last deployed external Worker is still v1.1.1. Claimed-account management access is unavailable; these source changes do not update that Worker or establish phone delivery.

## 1.1.2 · 2026-09-05

- Owner reported the Cloudflare deployment claimed. Temporary management access now returns HTTP 401; scheduled polling still requires an authenticated account action.
- Set the alert-service URL. The existing readiness gate still prevents enabling notifications until the service records successful background polling.
- Recheck alert availability every 30 seconds while visible and when returning to the app, with bounded request timeouts. Notification permission remains requested only from the Enable alerts tap.
- Public endpoint verification from the agent environment returned Cloudflare HTTP 403 / 1010. Cron execution and real device delivery remain unverified.

## 1.1.1 · 2026-09-05

- Deployed the alert Worker and D1 schema through Cloudflare’s preview-and-claim API. The owner must claim the account before cron can be registered; temporary accounts returned a limit of zero cron triggers. The app remains disconnected until polling is verified.
- Bulk-read and write game state within D1’s query and parameter limits. Skip unchanged game writes while preserving time-based kickoff transitions and atomic event history.
- Added a 200-game regression test for query limits, unchanged-score writes, and kickoff transition persistence.

## 1.1.0 · 2026-09-05

- Added Top 25 classification and tab; Watchlist combines ACC, Top 25, one-score, and upset games.
- Live one-score games include ties and margins up to 8, in any quarter. Upset watch uses ESPN curated rankings 1–25.
- Live sorting: ACC, Top 25, then remaining games; quarter descending, margin ascending, clock ascending. Finals appear last and dimmed.
- Finals retain their last observed live category plus categories matching the final score. Categories are saved on the device for the game day; a new device derives categories from the final score.
- Added persistent Hide finals, weekly Thursday–Monday ACC schedule, and explicit dates on weekly cards.
- Today stays on the previous Eastern date while its games are unfinished. Manual date selection remains fixed. Incomplete or failed updates cannot release a previously held game day.
- Added version history in Help and this changelog. Preserved both earlier releases with Git tags.
- Added `/sw.js`, user-initiated notification permission, iPhone Home Screen instructions, and optional ACC kickoff preference.
- Prepared a standalone Cloudflare Worker with one-minute cron, D1 subscriptions/state/event history, VAPID Web Push, and atomic duplicate protection. **Background service is not deployed or connected. Alerts are visibly pending, not enabled.**
- Added regression coverage for rankings, sort order, final retention, weekly boundaries, midnight rollover, transition triggers, encrypted push payloads, subscription ownership, and delivery uniqueness.

## 1.0.1 · 2026-09-05

Source: `e0a2abb0ba57ee1cc2d2a931e923e67322769532`. Sites saved version 2.

- Read ESPN directly from the browser with a same-origin server fallback.
- Use `groups=80&limit=200` for the complete FBS slate.
- Preserve cancellation and stale-score handling; fix mobile tab sizing.

## 1.0.0 · 2026-09-05

Source: `2f64d4e68ef099685648573828fd272b4e9555ca`. Sites saved version 1.

- First public iPhone-friendly scoreboard with ACC, one-score games, upset watch, date selection, and 30-second refresh.

## Release policy

Every published change gets a new semantic version, changelog entry, source commit, immutable Git tag, and GitHub release. Never move an existing release tag. Starting with v1.2.0, the GitHub release workflow deploys the exact tagged source to Cloudflare and verifies the deployed version and commit. See `docs/releases.md` for setup and rollback. Existing Sites publications remain available during migration; new releases do not require a Sites source push or saved version.
