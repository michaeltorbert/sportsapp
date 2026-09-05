# Saturday Signal releases

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

Every published change gets a new semantic version, changelog entry, source commit, immutable Git tag, and saved Sites version. Never move an existing release tag. Deployments use the exact pushed source commit. To roll back, deploy an earlier saved Sites version; preserve the newer source and history.
