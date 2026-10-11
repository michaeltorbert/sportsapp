# Game statistics (issue #115)

Opening a game card loads its stats inside the existing expansion. Before kickoff it shows season averages. Live (including halftime and paused-after-kickoff) and finished games get the team comparison, a Team details disclosure and a Players disclosure; live support is enabled under the gate evidence below. Canceled, postponed, forfeit and no-contest games are status-first and load nothing. The line, upset explanation, situation, delay note and Gamecast link stay where they are. Stats never gate score refresh, line enrichment, halftime timing, ordering, categories, Guide, alerts or board persistence.

## Pieces

| Path | Role |
|---|---|
| `lib/game-stats.ts` | Pure normalizer, public `GameStats` contract and validator, phase rules, tuning constants and enable gates |
| `lib/stats-server.ts` | Per-isolate Worker service: fixed ESPN summary URL, admission, deadline, completed-snapshot LRU cache |
| `app/api/stats/route.ts` | `GET /api/stats?event=<6–12 digits>&phase=pregame\|started\|final&refresh=0\|1`. Anything else gets a 400 before any upstream call. Responses are `no-store` and `nosniff` |
| `lib/stats-client.ts` | Worker-first load inside the absolute deadline, plus the optional direct fallback (same normalizer) |
| `lib/stats-scheduler.ts` | Shared FIFO queue: two active loads, one entry per card, deadline counted from enqueue |
| `lib/use-game-stats.ts` | Card-owned `StatsController` (generation, polling, backoff, cancellation) and the React hook |
| `components/game-stats.tsx` | `GameStatsPanel` (hook wrapper) and the pure `GameStatsView` |

`app/page.tsx` renders `GameStatsPanel` inside `.game-details`, after the delay note and before `.card-bottom`. The panel renders nothing and does no work while its card is collapsed. A native `<details>` keeps its children mounted, so loading is driven by the parent-owned `expanded` prop.

## Contract and semantics

- **Identity.** The header event ID must match the requested ID, with exactly one away and one home team ID. The client then requires `teamIds` to equal the card's away/home IDs. A source date that differs from the card's is recorded but is not a mismatch.
- **Phases.** The scoreboard-expected phase: `other` makes no request (the card is status-first); `final` → final; `live`, or `delayed` once started → started; everything else → pregame. The source phase is reported separately.
  - If the two phases disagree, the card shows **Stats catching up**.
  - A started game whose source still has only season metrics shows "Game stats are not available yet".
  - Season averages are never relabeled as game totals.
- **Team metrics.** Mapped by stable name and team ID, never by array position, and filtered through an own-key allowlist: 15 game metrics or 8 season metrics. Inherited names such as `constructor` or `toString` are unknown fields and are ignored.
  - Each value's `displayValue` must match that metric's expected shape. Anything else, and anything missing, is unavailable (—), never zero.
  - `0-0` conversions, negative yards and penalty/conversion composites are preserved.
  - A mixed metric family, or a team without a trustworthy ID, makes the team section unavailable.
- **Players.** Passing (C/ATT, YDS, TD, INT), rushing (CAR, YDS, TD) and receiving (REC, YDS, TD) only.
  - A column maps only when its key and its confirming label share an index.
  - Descriptions, when present, must match the label count.
  - The only accepted key/label mismatch is the observed trailing `adjQBR` omission. Anything else (a dropped middle value, keys reordered without their labels, extra labels, wrong-length descriptions, duplicate keys) means alignment is unconfirmed: the category keeps every identifiable participant with all values unavailable, is marked `unaligned`, and the card explains that its values could not be matched to columns. Columns are never shifted or guessed.
  - A row with the wrong number of values keeps its identity, with unavailable values.
  - An unidentifiable row makes its category unavailable, so a list is never silently partial.
  - The Players footer claims "All participants supplied … are shown" only when every category for both teams is listed; otherwise it says unavailable categories are not shown.
  - Negative athlete IDs are kept. These are source team-attributed rows, and they keep the source's name ("Team").
- **Bounds.**
  - Text is at most 64 characters. An over-long name is unavailable, never shortened.
  - A category with more than 256 rows is unavailable as a whole.
  - If the normalized snapshot would exceed 64 KB, the whole Players section becomes `too-large` and valid team data is kept.
  - No ranking, truncation or Show all control.
- **Betting.** The contract has no betting fields, and odds, pickcenter, predictor, win probability and ATS are never read. The validator rejects unknown keys. The only line shown is the existing validated `game.pregameLine`.
- **Freshness.** "Stats checked at" is the retrieval time. A Worker cache hit keeps its original `checkedAt`. The source's own status text appears separately as "Source reports …". No provider timestamp is claimed.

## Transport, cache and timing (starting parameters)

- **Deadline.** One absolute 8 s budget starts at enqueue and includes queue time. The Worker attempt gets `min(5 s, remaining)` and the fallback only what then remains. With less than 0.75 s left, the client expires locally instead of dispatching.
  - Queue expiry is a local retry. It does not advance backoff.
  - A client abort does not cancel the Worker's own bounded upstream fetch, which may still complete and cache.
- **Worker.**
  - At most 2 upstream fetches per isolate. Excess requests get `503` with `Retry-After: 5`, never a cached, mismatched snapshot.
  - The upstream fetch and parse share 4 s. An upstream failure returns `502` with `Retry-After: 30`.
  - The cache holds up to 20 completed snapshots (LRU), with a TTL of 15 s for started games and 300 s for pregame and final. Only completed normalized data is shared, never in-flight promises.
  - A phase hint that differs from the cached source phase, or `refresh=1`, bypasses a fresh entry under the same limits.
- **Client generations.** A generation is `eventId|awayId|homeId|date|expectedPhase`.
  - Memory keeps one latest observation per event (up to 20, LRU), bound to exactly one generation. Collapse/reopen and a card remount (for example a section move) reuse it only while the generation is unchanged.
  - Any change for an already-observed event (kickoff, final↔live, date, matchup, or an exceptional-status detour) is a correction: the old snapshot is dropped and never restored on a return (A→B→A starts a new observation), and the next load sends the new phase with `refresh=1` so a warm Worker entry is bypassed. The flag survives a remount until that load succeeds.
  - The observation also keeps the last failure until a successful retrieval or a new generation, so a remount with an unchanged generation (for example live → paused moving the card between sections) keeps the "Stats may be out of date" warning, its backoff and the Retry wait. A remounted card's first paint is seeded from memory, so its stats controls exist immediately.
  - The view renders state only when it belongs to the card's current generation and the snapshot's event and away/home IDs match the card, so a same-phase prop change never shows the preceding snapshot.
  - Late generations are rejected, and snapshots are replaced whole.
  - Memory only: never localStorage, `Game` or `Scoreboard`.
- **Refresh schedule.**

  | Phase | While expanded and visible |
  |---|---|
  | Started | Polls every 30 s |
  | Pregame | Revalidates once at its 5-minute TTL |
  | Final | Reused for 5 minutes, then revalidated on reopen or **Check again** |

  Opening or resuming refreshes once when the applicable TTL has passed.
- **Cancellation.** Collapsing, unmounting, hiding the tab or going offline cancels owned work and removes queued work.
- **Backoff.** Failures back off 60, then 120, then 300 s. `Retry-After` is honored, clamped to 1–300 s. Retry and Check again cannot bypass it: during backoff the control is disabled and reads "Retry in 42s" / "Retry in 5m"; the eligible attempt then runs automatically, or manually when no automatic attempt is due (for example a final whose revalidation failed). Each manual action is one attempt with `refresh=1`, still subject to the queue and deadline.
- **Fallback boundary.** Worker `429`/`503`, `400`, `502` and identity mismatches are authoritative and never fall back. Only an unreachable Worker, a timeout or an invalid contract may fall back, and only when the fallback is enabled.
- **Age and warnings.** The age timer runs independently of score refreshes.
  - Past the applicable TTL, the card shows factual age copy ("Checked 22s ago") with no failure wording.
  - A failed refresh shows "Stats may be out of date" with Retry. Offline shows "Offline · saved stats".
  - Paused-after-kickoff cards say "Play is paused" and "Showing the latest game stats the source provided", with the retrieval age. They make no claim about when the source recorded the totals.
  - A fresh score never clears a stats warning.
  - Only the title and a stable sentence of loading, error and warning notices are polite `role="status"` regions. Retrieval age, countdowns and cell values sit outside them, so timer ticks are never announced.

## Focus across section moves

A state change (live ↔ paused, for example) moves a card to another section, remounting it. `app/page.tsx` records the focused card control (`data-focus-key`: summary, Gamecast, Team details/Players buttons, Retry, Check again, player-table regions). When the same event's card remounts, it puts focus back on the matching control, scrolling only as far as needed, but only if the control was removed with the old card and nothing else has focus. Focus the user moved elsewhere, or a deliberate blur, is never overridden. Inner disclosure and expanded state persist as before.

## Gates

| Constant | Value | Evidence / condition |
|---|---|---|
| `LIVE_STATS_ENABLED` | `true` | Enabled on (1) the genuine IN_PROGRESS capture `espn-summary-live.json` and (2) a coordinator-run actual browser → local workerd → real ESPN probe: `GET /api/stats?event=401856717&phase=started&refresh=1` returned 200 in 162 ms, 3,190 bytes, normalized team and players (2026-10-10T22:52:01Z). That is local workerd, not hosted Cloudflare egress, phone or Safari evidence. Setting it to `false` restores the gated path: started cards (live, halftime, delayed after kickoff) make no request, show no spinner, and show "Live stats are not available yet" with Gamecast. |
| `DIRECT_STATS_FALLBACK` | `false` | An ordinary anonymous browser fetch of the summary endpoint failed (`TypeError: Failed to fetch`, 89.7 ms, desktop Chromium, 2026-10-10). It stays off; there is no retry or bypass of that result. |

Changing any tuning value requires re-review.

## Evidence and limits

- **Fixtures.** `tests/fixtures/espn-summary-{live,final,pregame}.json` are minimized, anonymized genuine public captures from 2026-10-10. `espn-summary-provenance.json` records the original SHA-256 of each.
  - Live is a real IN_PROGRESS 3rd-quarter capture, with passing at 6 keys / 5 labels.
  - Halftime, overtime, delay, suspension, exceptional, correction, malformed and oversized cases are synthetic and labeled in the tests. Halftime behavior is not observed.
- **What the checks cover.** `npm run test:runtime` checks routing only: an invalid stats request returns 400 under workerd with zero external calls. It is not provider or transport evidence.
  - Browser tests serve the real normalizer's output for the saved fixtures through an intercepted same-origin route.
  - `tests/browser/fixtures.mjs` intercepts `/api/stats` by default (simulated 503), so the local Worker never queries ESPN.
- **Not verified.** Worker egress reliability, latency and cache-hit rate are unmeasured. Per-isolate admission and cache limits do not bound the whole deployment, and `refresh=1` is a public amplification surface limited only per isolate.
- **Zoom.** Browser tests apply actual `html { zoom: 2 }` at 393×852 in both mobile-emulated engines, plus 393×852, 440×956, 820×1180, 1180×820 and 1440×1000 unzoomed, and require no page-wide horizontal overflow. That is CSS zoom, as in the reference previews, not OS or pinch zoom.
  - **Existing navigation change.** One rule outside the stats styles was added: `.destination-nav a { min-width: 0; }` for the Scores/Guide links on both the scoreboard and Guide pages.
    - Before it, at 200% zoom the Guide link already extended past its row's content edge even with macOS fonts (hidden by the page's side padding). With Linux WebKit's wider fallback fonts it pushed the page 2px wide, which failed CI.
    - Now, when the links don't fit, they shrink within their row by giving up side padding (about 19px → 13px at 200%). They stay on one row with their text size and 44px height. When they fit, as at normal zoom and the other tested sizes, nothing changes.
  - **Wide-font regressions.** The 200% overflow test and the zoomed keyboard test each have a variant that forces wide fallback fonts (Verdana, else DejaVu Sans) so Linux-like metrics are exercised on every platform. The zoomed cases also check, before any card opens, that the navigation links stay inside their row with 44px targets.
- **Keyboard scrolling.** Tested in desktop (non-touch, desktop user agent) contexts for both engines, at 320×800 and at 393×852 with 200% CSS zoom. Tab alone reaches the player-table region, native arrow keys scroll only that region (the page does not scroll sideways), and ArrowLeft returns it. There is no custom key handling.
  - Chromium scrolls on the first ArrowRight.
  - Playwright desktop WebKit consistently ignored the first arrow press after focus and scrolled smoothly from the second onward. The test allows at most two presses and logs the count. This was observed in Playwright's WebKit build, not Safari.
  - Mobile-emulated WebKit (touch) does not arrow-key scroll overflow regions; touch is its input there.
- **Live coverage.** Browser tests cover live first-tap loading, the separate source status, 30 s polling while open and no polling when collapsed. These run against intercepted responses built from the genuine live capture; the real-ESPN evidence is the coordinator probe above.
- **No device evidence.** No physical device, Safari or Simulator verification has been done.
