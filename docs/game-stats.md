# Game statistics (issue #115)

Selecting a scoreboard game opens its dedicated game screen (user-approved r1 design, 2026-10-13; it replaced the inline expansion). The screen shows the score masthead, then **Team stats** by default and **Player stats** as the second section. Before kickoff Team stats shows season averages per game. Live (including halftime and paused-after-kickoff) and finished games show all 15 game metrics in one mirrored comparison, and Player stats lists every supplied passing, rushing and receiving participant as one continuous document. Live support is enabled under the gate evidence below. Canceled, postponed, forfeit and no-contest games are status-first and load nothing. The validated line, upset explanation, situation, delay note, halftime status, badges and Gamecast link moved with the game to its screen. Stats never gate score refresh, line enrichment, halftime timing, ordering, categories, Guide, alerts or board persistence.

## Pieces

| Path | Role |
|---|---|
| `lib/game-stats.ts` | Pure normalizer, public `GameStats` contract and validator, phase rules, tuning constants and enable gates |
| `lib/stats-server.ts` | Per-isolate Worker service: fixed ESPN summary URL, admission, deadline, completed-snapshot LRU cache |
| `app/api/stats/route.ts` | `GET /api/stats?event=<6–12 digits>&phase=pregame\|started\|final&refresh=0\|1`. Anything else gets a 400 before any upstream call. Responses are `no-store` and `nosniff` |
| `lib/stats-client.ts` | Worker-first load inside the absolute deadline, plus the optional direct fallback (same normalizer) |
| `lib/stats-scheduler.ts` | Shared FIFO queue: two active loads, one entry per card, deadline counted from enqueue |
| `lib/use-game-stats.ts` | `StatsController` (generation, polling, backoff, cancellation) and the React hook, owned by the open game screen |
| `components/game-stats.tsx` | `GameStatsScreen` (hook wrapper) and the pure `GameStatsView`: section navigation, Team stats and Player stats |
| `components/game-screen.tsx` | The game screen: slim bar, masthead, context row and the stats view |
| `lib/game-route.ts` | Same-root URL (`/?event=<id>[&section=players]`), validated history records and the owned-history controller |

`app/page.tsx` keeps the scoreboard mounted (one score poller, its state and DOM) inside a hidden wrapper while a game is open, and renders `GameScreen` beside it. Only the open, eligible game mounts `GameStatsScreen`, so the scoreboard itself never does stats work and at most one controller is active.

## Navigation

- **Destination.** `/?event=<id>`, plus the scoreboard's own `date` (only when not following Today), `cats` and `period`, so the view the scoreboard derives from the URL is unchanged. Player stats adds `section=players`; switching sections replaces the entry, so Back returns straight to the scoreboard. Unrelated parameters survive; a legacy `#game-` hash does not. The static homepage serves this URL like any other root query.
- **History records.** Entries carry a versioned `ss` record merged into the framework's state: a scoreboard snapshot (date or Today, categories, Day/Week, Hide finals, absolute scroll, origin game ID) or a game entry (ID, section, whether our scoreboard entry is directly behind it). UI state and IDs only, never game content. Anything that fails validation is not ours.
- **Opening.** The current entry is replaced with the scoreboard snapshot, then the game entry is pushed, so Back always has a safe scoreboard behind it.
- **Back.** On-screen Back uses `history.back()` when our scoreboard entry is behind; otherwise (a direct link, an update reload) it replaces the entry with the scoreboard for the carried view and focuses the game's card, never leaving the app.
- **Owned traversals.** One capture-phase `popstate` listener on `window` runs before the framework's listeners. In browser runs a capture listener added after hydration did not keep the framework from handling owned traversals in Chromium (WebKit was fine); that is consistent with Chromium running window-targeted listeners in registration order, but it was inferred from outcomes, not observed directly. The mitigation does not depend on the cause: the root layout registers the listener with a small inline script at the start of the body on every route, so it is in place before the framework's entry script whether the document was first opened on Scores or the Guide. It is inert by itself and forwards only to the handler the mounted Scores page installs. Tests cover Scores-first and Guide-first documents; the built HTML order is checked in the game-screen browser spec. It handles a traversal only when the path is `/` and both the entry being left and the target are validated records of ours. It then stops the event, so no RSC request or document load runs (this is what keeps Back and Forward working offline or when the Worker fails), applies the target, and re-commits the URL with the public `history.replaceState`, which the framework patches to keep its own URL state current. Every other traversal, including the Guide and framework entries, reaches the framework untouched. `history` is not patched. Records also carry `__vinext_scrollY`, which the framework's own restoration reads for traversals it handles.
- **Restoration.** The restored snapshot owns the scoreboard's date (or Today), categories and period as explicit state, even where the page being left read equal values from its URL (a reloaded game URL carries them; the scoreboard entry's URL may not). Pinning an unchanged day does not restart polling. Returning shows the scoreboard, focuses the origin card's link without scrolling (or the Scores heading if that card is gone), then restores the saved absolute scroll position clamped to the page. The card may have moved to another section while the game was open; the position is never re-anchored to it. A cross-document return (Back after reloading a game) restores the saved snapshot once scores load. It is recognized by arriving on a different history entry from the one the previous document left (recorded in session storage on `pagehide`), falling back to the navigation timing type; only real input (pointer, touch, wheel, key) cancels that wait. A plain reload of the scoreboard keeps its URL and saved-preference behavior.
- **Notification and update links.** `#game-<id>` (alerts) and the update `_ss_focus` remain Watchlist membership. They also open that game once, when it appears on the protected boards and before any input: the entry is replaced by a scoreboard entry with a `consumed` marker and the hash removed, then the game is pushed. Back, polls and reloads never reopen it. Updates serialize `_ss_open` as the still-pending game or `0`; a 1.14.0 update link without it opens its focused game once, as it used to expand. An open game survives an update through its own `event` parameter. Updates never replay notification scrolling.
- **Privacy.** The screen looks its game up on the Duke-protected boards at every render. Unknown, not yet loaded and protected games share one generic screen with no teams, score, title or stats work; hiding a game while it is open switches to it immediately and unmounts its stats controller.
- **Appearance.** The approved palette (`--bg`, `--surface`, `--line`, `--lime` and the rest) is scoped to `.game-screen`; the status-bar band uses its navy only while the screen is rendered (`body:has(.game-screen)::before`). The scoreboard's tokens and appearance are unchanged. Only the slim bar and section navigation stick, and only with at least 600 CSS px of zoom-adjusted height and the two bars using no more than a third of the viewport. The score header stays side by side when every full name, record and score fits, and otherwise stacks into rows; this is measured after each render and size change rather than set by a breakpoint. Neutral share bars appear only on total, passing and rushing yards when both values are non-negative integers; they are decorative and imply no leader. Real team logos keep the scoreboard's light tile; otherwise the abbreviation shows.

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

  | Phase | While its screen is open and visible |
  |---|---|
  | Started | Polls every 30 s |
  | Pregame | Revalidates once at its 5-minute TTL |
  | Final | Reused for 5 minutes, then revalidated on reopen or **Check again** |

  Opening or resuming refreshes once when the applicable TTL has passed.
- **Cancellation.** Leaving the game screen, switching to another game, a privacy re-hide, hiding the tab or going offline cancels owned work and removes queued work.
- **Backoff.** Failures back off 60, then 120, then 300 s. `Retry-After` is honored, clamped to 1–300 s. Retry and Check again cannot bypass it: during backoff the control is disabled and reads "Retry in 42s" / "Retry in 5m"; the eligible attempt then runs automatically, or manually when no automatic attempt is due (for example a final whose revalidation failed). Each manual action is one attempt with `refresh=1`, still subject to the queue and deadline.
- **Fallback boundary.** Worker `429`/`503`, `400`, `502` and identity mismatches are authoritative and never fall back. Only an unreachable Worker, a timeout or an invalid contract may fall back, and only when the fallback is enabled.
- **Age and warnings.** The age timer runs independently of score refreshes.
  - Past the applicable TTL, the card shows factual age copy ("Checked 22s ago") with no failure wording.
  - A failed refresh shows "Stats may be out of date" with Retry. Offline shows "Offline · saved stats".
  - Paused-after-kickoff cards say "Play is paused" and "Showing the latest game stats the source provided", with the retrieval age. They make no claim about when the source recorded the totals.
  - A fresh score never clears a stats warning.
  - Only the title and a stable sentence of loading, error and warning notices are polite `role="status"` regions. Retrieval age, countdowns and cell values sit outside them, so timer ticks are never announced.

## Focus across section moves

A state change (live ↔ paused, for example) moves a card to another scoreboard section, remounting it. `app/page.tsx` records the focused card link (`data-focus-key="summary"`). When the same event's card remounts, it puts focus back on it, scrolling only as far as needed, but only if the link was removed with the old card, nothing else has focus and the scoreboard is not hidden behind an open game. Focus the user moved elsewhere, or a deliberate blur, is never overridden. The open game screen is not remounted by such a change, so its section, focused control and stats state stay as they are.

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
- **Live coverage.** Browser tests cover live loading on opening the screen, the separate source status, 30 s polling while open and no polling after Back. These run against intercepted responses built from the genuine live capture; the real-ESPN evidence is the coordinator probe above.
- **Navigation evidence.** `tests/browser/game-screen.spec.mjs` covers restoration (including a group/order change and a later poll), Forward, reload then Back, direct and unknown links, one-shot notification links, A→B isolation, a Duke re-hide while open, owned Back/Forward offline and with failing RSC responses (zero RSC or document requests, same document), a framework-handled Guide traversal, and sticky/zoom behavior, in mobile-emulated Chromium and WebKit. Physical iPhone gestures (edge-swipe Back) and installed Home Screen behavior are not covered.
- **No device evidence.** No physical device, Safari or Simulator verification has been done.
