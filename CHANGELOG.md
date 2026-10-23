# Saturday Signal releases

## 1.23.0 · 2026-10-23

- Add a separate team-season FBS statistical rankings section after existing averages: total, net passing and rushing yards per game, offense and defense allowed, with actual values and ranks among 138 teams. Saturday Signal computes competition ranks from CFBD season totals divided by reported games; these are not poll rankings.
- Keep leaders, ESPN regular-season averages, schedules, navigation and spoiler protection. Rankings show their own check time, unknown source-update timing, and delayed/partial/unavailable states.
- A fixed daily shared snapshot uses two source reads; public views and Retry read KV only. Both statistics publishers honor persistent shared provider denial state and the existing leaders block. Broader player coverage and navigation in #189/#190 remain open.

## 1.22.0 · 2026-10-23

- Add three named regular-season yard leaders above the existing team averages and schedule (#181): passing, rushing and receiving, with full player names and total yards. Missing or partial data stays labeled unavailable and can be retried.
- Leaders follow the existing season aggregate spoiler gate. A shared CFBD regular-season snapshot refreshes twice daily, with its own check date; delayed or unavailable data stays explicit. Visitor requests and Retry read the saved snapshot without using provider quota.
- This is the approved leaders-first slice; full season player tables and the broader statistics issue remain open.

## 1.21.2 · 2026-10-21

- Limit shared icon-button hover feedback to hover-capable, fine-pointer input. Preserve mouse hover, keyboard focus indicators, panel focus restoration and the Alerts color cue (#127).
- The owner recording establishes lingering toolbar circles on iPhone before this change. Desktop touch emulation did not reproduce the same lingering state; physical after-fix confirmation remains pending and #127 stays open.

## 1.21.1 · 2026-10-21

- Keep a game's category and delayed One-score history when the provider corrects its home/away designations without changing the event or participants. Saved betting lines still require the same ordered matchup and kickoff (#14).

## 1.21.0 · 2026-10-21

- Add to Home Screen guidance appears in browser tabs and stays out of the Home Screen app. Open the footer action for Safari’s Share and Add to Home Screen steps, from Scores, Guide, game or team screens (#169).
- The action uses the current launch mode, so an existing Home Screen icon does not hide it in a browser tab. Saved settings, alerts and installation identity are preserved.

## 1.20.0 · 2026-10-21

- On Scores, a deliberate horizontal touch swipe on the games, or on the empty, loading or unavailable message, moves once: left goes to the next day in Day or the next Thursday–Monday football week in Week, and right goes back. Vertical scrolling, pinch zoom, taps on games, controls, open panels, multi-finger touches and swipes starting within 32 points of a screen edge do not change the date. While the page is zoomed in, swiping is off so you can pan freely (#172).
- While the finger stays down, the games follow it one-to-one and the neighboring day or week slides in beside them, labeled with its date. It shows that range's games, filtered like the current view (categories, Hide finals, All FBS games and Duke settings), as soon as they are known: from scores loaded in the last 90 seconds, or from one score request made only once the drag reveals that side. Until then it says it is loading, and a failed request says scores are unavailable, never showing the current games under another date. Letting go 60 points or more from the start moves once and the new range settles into place; a shorter, reversed or abandoned drag slides back with no change of date or address. With Reduce Motion, the games still follow the finger, and the move or return happens at once (#172).
- A tap on a game while the new range is still settling stops it in place and opens that game; a new drag continues from where the games are. Revealing the other side cancels a request for the side no longer shown, and no range is requested twice in one drag. A neighbor's games show their ESPN status without the halftime countdown or extra game details until that range is chosen. Scores refreshed while a finger holds a drag appear once it lifts, so the touched game never moves or disappears mid-touch (#172).
- Week now has Previous week and Next week buttons and a This week button, as accessible alternatives to swiping. At normal phone widths, Day/Week stays beside the date controls without shrinking the buttons. A chosen week is kept in the address (`weekDate`) without adding history entries; once it is, the address also follows later Day and Week choices, so reloads, app updates, game and team screens and Back keep it, together with the All FBS games scope they already restore. The Guide passes it along unchanged and still shows one day; returning to Scores opens Day as before, and choosing Week shows the remembered week (#172).
- Day and Week keep separate selections: the Day arrows, picker and Today never change the chosen week, and the week controls never change the chosen day. Categories, Hide finals, All FBS games and Duke settings are kept. A deliberate move to an empty day or week stays in the chosen view, and a link carrying `weekDate` never switches to Week automatically (#171, #172).
- Day dates are still not written to the address when changed, as before. Ordering, filters, alerts and the score feed are unchanged.

## 1.19.0 · 2026-10-21

- A new **All FBS games** checkbox beside Hide finals, off by default. When checked, the All chip reads **All FBS** and lists every game the existing FBS scoreboard feed returns for the selected Day or Week, including games against FCS opponents; unchecked, All is still your watchlist. It adds no separate FCS coverage and does not promise the feed is complete (#176).
- ACC, Top 25, One score and Upsets still narrow the list as before, and their counts are unchanged. Checking or unchecking the box clears category selections to that view's All; All FBS counts describe what it lists (#176).
- This device remembers the choice across dates, Day and Week, and reloads. Game Back, history and app updates restore the view you left; ordinary links use the saved choice. Home returns to Day and All within it (#176).
- Duke spoiler settings and Hide finals still apply first. Ordering, the Guide's own All games/Watchlist choice, game screens, pregame lines and alerts are unchanged (ORD-021).

## 1.18.0 · 2026-10-19

- When Today’s successfully loaded schedule has no games, Scores opens the existing Thursday–Monday football week so you can see the rest of the week. Day remains available, and a scheduled game hidden by categories or Hide finals does not count as an empty schedule (#171).
- Explicit period and date links, notification destinations, restored views and choices made while scores load keep their selected view. Failed or stale score feeds do not trigger the default.
- Game ordering, filters, week dates, alerts and the empty-week message are unchanged.

## 1.17.1 · 2026-10-19

- When ESPN’s main score feed is unavailable, one refresh reuses backup score documents it has already finished downloading instead of downloading them again, so there are fewer repeat downloads. Two parts of a refresh that need the same document at the same moment can still each download it. Every refresh starts fresh; nothing is kept for a later one (#53).
- Each Day, Week and overnight check still validates its own dates, calendar week, season and games, keeps its own time limits and cancellation, and falls back to the hosted feed exactly as before when backup data can’t be used. A board built from reused documents reports when they were actually downloaded, which may be a little earlier than before (#53).
- Scores, the Guide, ordering, Upset watch, halftime timing, pregame lines, alerts and hosting are unchanged.

## 1.17.0 · 2026-10-19

- A game screen now has quiet links to each team’s season page (`/?team=<id>`), outside the score header. The page shows the team’s current season from ESPN: its overall record, four regular-season per-game averages for the team and its opponents (points, total, passing and rushing yards), and the published regular-season and postseason schedules with results, opponents’ full names, dates and kickoff times in Eastern Time (each converted on its own date, across the daylight-saving change), unconfirmed times as TBD, and TV where listed. A missing value shows as unavailable, never zero; an empty postseason says none are listed yet (#166).
- Every schedule game opens the existing game screen in the app, including games outside the scoreboard’s dates. Such a game is found only in that team’s checked schedule (`/?event=<id>&team=<id>`) and refreshes with it, at most about once a minute while live; a scoreboard copy is preferred when present. Back, Forward, reload, deep links and new tabs work; a directly opened schedule game goes back to its team, and a directly opened team page goes back to Scores (#166).
- Duke spoiler settings apply unchanged. A hidden Duke game shows only its date on any team’s schedule, with no opponent, score, result or link, and opens nothing. A team’s record and averages are withheld while one of its started games is hidden, or while part of its schedule couldn’t be checked. Season schedules never change the Duke settings’ own observations (#166).
- Scores, the Guide, the header, ordering, Upset watch, the bare pregame line, alerts, subscriptions and configuration are unchanged. No external Gamecast link is added.

## 1.16.8 · 2026-10-19

- Started Team stats no longer repeats “This game” beside its heading. The comparison, tabs, matchup, source status, and the labels on Scoring and Player stats are unchanged (#165).

## 1.16.7 · 2026-10-17

- After kickoff, a game keeps the pregame line this device saved for it before kickoff, instead of being replaced by a line found later from ESPN's game summary. A current pregame line, including a pick'em, still replaces a saved one, and a changed kickoff or matchup still discards it. Without a saved line, the line is still looked up from the summary. The saved line may not be the closing line, and the Day and Week views keep separate saved lines (#14).
- Yesterday's scores, which decide whether overnight games are still in progress, are loaded without extra game details unless that day is the one shown. The Guide's overnight check never loads them (#14).
- Upset watch, the line display, halftime timing, alerts and settings are unchanged.

## 1.16.6 · 2026-10-17

- The local deployment preflight now checks every configured additional alert origin, not only the main site origin. An entirely empty value still means none; an empty, malformed, wildcard or non-exact entry fails with its position rather than its value (#9). The Worker's origin matching and the configured origins are unchanged.
- When a release tag's commit isn't reachable from `origin/main`, the release check now says so and still stops the release. Other Git failures, such as a missing `origin/main`, still fail with their original error (#9).
- The workflow artifact uploads are pinned to the official `actions/upload-artifact` v7.0.2 commit, which runs on Node 24, with the same artifact names, paths, hidden files and retention (#9).
- Release history and alerts hosting notes now say v1.2.0 was first deployed from an authorized local Wrangler session while the automated release workflow was still being prepared, and label the stored deployment receipt as historical. The rollback guide adds that restoring an older alerts Worker would also restore its old-only origin list; the ban on restoring alert code that doesn't understand saved preferences is unchanged. The service worker's header comment no longer names a version (#9).
- No app data, alert, subscription or external service behavior changes.

## 1.16.5 · 2026-10-17

- In Help, Alerts and Settings, when a focused large-text heading comes to fit because its text gets smaller, focus moves to Close before the heading's tab stop is removed, instead of falling to the page body (#126). Keyboard Close, body scrolling, End, Escape and reduced motion are unchanged, as is the heading's appearance; no new scroll cue is added.
- The local Worker runtime check now waits for readiness reported by the process it started, over its own IPC channel with port 0, rather than accepting any plausible health response on the port. An occupied port and other startup failures are reported separately, the first startup failure is kept, and a failed start is not retried (#120).
- The local updater check handles an interrupted proxied response or request error without sending headers twice or failing uncaught, keeps the first failing result with safe partial diagnostics, and cleans up the whole owned process group, including descendants left after the leader exits. The existing updater checks are preserved (#132).
- No app data, alert, subscription or external service behavior changes.

## 1.16.4 · 2026-10-17

- Keep Scores header controls visible at 200% zoom on narrow screens, without overlap or smaller text (#151).
- Keep the Guide date, Today button and wordmark on screen at 200% zoom while preserving timeline scrolling and normal layouts (#145).
- Clarify update and local development instructions; ordinary updates keep existing installations and alert subscriptions (#133).

## 1.16.3 · 2026-10-17

- Keep the known pregame spread beside the favored team after kickoff and in the final result. Upset watch, game details and alerts keep their existing behavior.

## 1.16.2 · 2026-10-16

- The suggested install name is Saturday Signal — Sports Scores & Stats in the web app manifest (`name` and `short_name`), the `application-name` and `apple-mobile-web-app-title` metadata, and the page title, Saturday Signal — Sports Scores & Stats | College Football Watchlist, on Scores and the Guide (#112). The in-app wordmark, layout, icons, colors and descriptions are unchanged.
- The manifest `id`, `start_url` and `scope` stay `/`, with the same origin, standalone display and status bar style. Storage, service worker, alert and subscription code is unchanged.
- In a fresh local-origin iPhone 18 Pro Simulator install on iOS 27.0, Add to Home Screen suggested the full name; Search found the installed app for “sports”, “scores” and “stats”, and each result opened it in standalone mode. A first Home Screen launch showed a white screen; later launches succeeded on the same candidate, and the cause is unknown. Existing-install renaming, physical-iPhone behavior, and preference or alert carryover after re-adding remain unverified. Issue #112 remains open; details are in `docs/install-search.md`.

## 1.16.1 · 2026-10-16

- The install name is now Saturday Signal Scores in the web app manifest (`name` and `short_name`), the `application-name` and `apple-mobile-web-app-title` metadata, and the page title, `Saturday Signal Scores | College Football Watchlist`, on Scores and the Guide (#112). The in-app wordmark, layout, icons, colors and descriptions are unchanged.
- The manifest `id`, `start_url` and `scope` stay `/`, with the same origin, standalone display and status bar style. Storage, service worker, alert and subscription code is unchanged.
- No extra Search keywords are added. The reviewed web and Apple sources describe no web-app field for them; see `docs/install-search.md`.
- On a simulated iPhone, adding the app fresh suggested Saturday Signal Scores, and Search found it by “scores”. An app already on the Home Screen updated and kept its saved choices, but kept the name Saturday Signal; no safe way to give it the new name is established. “Sports” didn't find either app there. Not confirmed on a physical iPhone; details and limits are in `docs/install-search.md`.

## 1.16.0 · 2026-10-15

- The game screen has a third section, Scoring, between Team stats and Player stats; Team stats stays the default (#149). Scoring shows the score by quarter for the periods ESPN supplies, with overtime as OT, 2OT and so on and the source's total. Below that are ESPN's scoring plays, in its order, each with the quarter, clock, team, its short public description and the away–home score after the play. Overtime plays at 0:00 keep their order.
- Values are shown as supplied. A missing value shows a dash and a supplied zero stays zero. Points are never worked out from play text, and a missing total is never calculated. When the two teams' quarter lists differ in length, the table says "Quarter scores are incomplete and may not align correctly." Quarters that don't add up to the total, running scores that don't match the score or go down, plays whose team isn't in this game, and conflicting duplicates each get a short note instead of a guess. Plays whose order contradicts their own quarter or clock are not shown. Nothing claims every scoring play is listed.
- Scoring arrives with the existing stats request, using the same retrieval time, polling, cache, offline and retry behavior; it adds no request, poll or cache. Its availability is separate from Team and Player stats: a game can show scoring while team stats are unavailable, and the reverse. Scoring is added only in whatever space is left after team and player stats, so it never pushes player stats out; if it doesn't fit, the section says it is too large. Before kickoff, Scoring says it starts after kickoff. The score at the top of the screen is unchanged.
- Older app versions get exactly the same stats responses as before, and this version accepts responses from a server that has no scoring yet, showing Scoring as unavailable.
- `section=scoring` links, Back and Forward, reload and app updates keep the section. Section switches still replace the history entry, so Back returns to the scoreboard. The three section buttons share one row at normal sizes; at larger text or zoom where a word wouldn't fit, they stack with their words intact. Duke privacy, ordering, categories, Guide, alerts and storage are unchanged.
- Verified against genuine ESPN data for live, final, overtime and pregame games; this does not guarantee every game supplies scoring. Not yet confirmed on a physical iPhone or on the hosted site during a live game.

## 1.15.2 · 2026-10-15

- Duke spoiler protection's automatic setting, now labeled Hide away games during play, hides a Duke game only when Duke is the confirmed away team and play is under way: live, including halftime and overtime, or paused after play started. Home, neutral-site and unknown-venue games stay visible in every state. An away game is visible before play, even through a delayed kickoff, and visible again once it's final, canceled or postponed, in Scores, Guide, counts, focus links and the game screen (ORD-020, #155).
- Games you hide yourself, and games governed by Always hide, still stay hidden after the final. Always show, per-game reveals and a default chosen while a loaded game waits through a delay are unchanged. A game this device saw start keeps the default in effect then, even if ESPN later reports it as delayed without start evidence.
- Per-game decisions the app saved automatically no longer decide visibility, so finished away games show again and a saved automatic decision can no longer hide a home or neutral-site game by itself. They remain saved for tabs still running the previous version, which keep the old behavior until reloaded.
- Damaged saved preferences now use the automatic setting with a warning, instead of hiding every Duke game, and stay as saved until you choose something. Unreadable storage behaves the same for the visit. A first Always hide rule that earlier versions saved only after such damage is replaced with the automatic setting once; later default choices and per-game choices are kept, and Settings explains the change.
- Duke notifications stay off. Ordering, categories, Hide finals, alerts and sound are unchanged. Not yet confirmed on a physical iPhone; what hid home games on the reporting phone is not known.

## 1.15.1 · 2026-10-14

- All, ACC, Top 25 and One score now show the same current (total) count as Upsets. The first number is the category's games in progress: live, including halftime, or delayed after kickoff. The total counts every game the category lists for the selected Day or Week, including upcoming, delayed, schedule-update and finished games; Hide finals removes finals. Upsets keeps its brewing count and actual-upset total (#146).
- On the compact scoreboard, all five categories stay in one row, with each label on one line and its counts below, at unchanged text sizes and touch height. There is no added legend or explanation strip; Help explains the counts.
- Counts still use the Duke-protected board and the All-only focused game. Stale scores show dashes, loading shows dashes, and a loaded empty view shows real zeros. Each button's screen-reader label gives both numbers.
- Opening a game notification now scrolls its scoreboard card into view once before the game opens, even when the week's scores arrive before the day's, so Back returns to that card. The game still opens if the day's scores fail, or if it is on the week board but not the displayed day.
- Not yet confirmed on a physical iPhone.

## 1.15.0 · 2026-10-13

- Selecting a game on the scoreboard opens a dedicated game screen instead of expanding the card. A slim bar with Back to Scores sits above a score header with status, broadcast, teams, records and scores; the bar condenses to the score as you scroll. The validated pregame line (shown without the bookmaker's name), upset explanation, down and distance, delay note, halftime countdown and category badges move to this screen; the scoreboard rows look as before (#115). Game details and stats stay in the app: the game screen has no Gamecast or other external link, and its messages do not send you elsewhere.
- Team stats is the default view. Live and completed games show all 15 team metrics in one continuous away/home comparison, with neutral bars on total, passing and rushing yards only; before kickoff it shows season averages labeled per game, never as game totals. Player stats lists every passing, rushing and receiving participant ESPN supplies for both teams, with jump links and no truncation. Missing values still show a dash, and loading, stale, offline, retry and catching-up states are unchanged.
- Back, on screen or in the browser, returns to the scoreboard as you left it: the same date or week, categories, Hide finals, scroll position and the game you opened, even if it moved while you were away. Forward reopens the game. Back and Forward between the scoreboard and a game work without reloading the page, including offline. A direct game link or an app update keeps the game open, and its Back stays in the app.
- Notification links open their game once; Back, later refreshes, reloads and app updates never reopen it. Games hidden by the Duke setting, and unknown games, show only a generic "This game isn't available" screen, including by direct link and when hidden while open.
- Not yet confirmed on a physical iPhone, including edge-swipe Back and the Home Screen app.

## 1.14.0 · 2026-10-12

- Opening a game card now loads its statistics inside the existing expanded details, with a short loading state; scores, the line, situation, upset note, delay note and Gamecast link stay where they were (#115).
- Live and completed games show a team comparison in fixed away/home order: total, passing and rushing yards, first downs, third-down conversions, turnovers, penalties/yards and time of possession. A Team details section adds fourth-down conversions, completions/attempts, yards per pass, rush attempts, yards per rush, interceptions thrown and fumbles lost. A Players section lists every passing, rushing and receiving participant ESPN supplies for both teams, with abbreviations explained. There are no winner highlights or comparison bars.
- Before kickoff, including a kickoff delay, the card shows season averages labeled per game: points scored and allowed, and total, passing and rushing yards gained and allowed. No zero-filled game totals or empty player tables are shown before kickoff.
- Data is shown truthfully. "Stats checked at" gives the retrieval time and the source's own game status appears separately. Missing values show a dash rather than zero, and 0-0 conversions are not shown as percentages. A missing or malformed section is labeled unavailable without hiding the valid ones. When the stats source has not caught up with the scoreboard, the card says so instead of relabeling season averages as game totals. A failed or offline refresh keeps the last stats with their age and a warning, and Retry waits for the backoff. Paused games keep their latest game totals with honest age.
- Live stats refresh about every 30 seconds while a card is open and visible; collapsing it, hiding the tab or going offline stops refreshing. Canceled, postponed, forfeited and no-contest games load no stats. Stats are fetched through the app's own server route and are never saved on the device; score refresh, ordering, categories, the Guide and alerts are unaffected.
- The existing validated pregame spread or pick'em is unchanged; no totals, moneylines, live odds, picks, predictions or win probabilities are added.
- At 200% zoom, the Scores and Guide tabs at the top may use slightly less side padding instead of pushing the page wider; at normal sizes the header is unchanged.
- Confirmed on the hosted preview for completed and upcoming games. Live stats were checked against real ESPN data through a local server, not on the hosted site during a live game, and not on a physical phone. Halftime, overtime, delays and other rare states are covered only by test data.

## 1.13.8 · 2026-10-10

- Keep the Guide details title and Close button pinned while the body scrolls. Opening game details by touch no longer outlines the X; keyboard focus indicators remain available. Browser regressions cover these interactions.

## 1.13.7 · 2026-10-10

- Under the automatic default, now labeled "Hide away games once they start," a Duke game is hidden only when ESPN lists Duke as the away team, the venue is confirmed not neutral, and play has actually started (start evidence, or a live or final status). A passed kickoff time alone is not enough. Home and neutral-site games, games with unknown venue metadata, and upcoming or delayed games that have not started stay visible. This replaces the 1.7.0 default, which hid away and neutral-site games and games with unknown venue (#123, ORD-019).
- A started away game stays hidden through the final, reloads and later status corrections until you show it. Always hide, Always show and per-game hide or show choices keep their existing behavior and take precedence over the automatic decision. A default you choose while a loaded game is still waiting to start, including through a delay, holds once play begins, as does one chosen earlier if this device loads the game again before play starts. If this device next loads a game only after play has started, the game keeps the newer of two defaults: the one in effect at its scheduled kickoff, and the newest one in place when the device last saw it waiting, if it ever did. A default chosen after that kickoff time, while the game was not loaded, does not reach it.
- Duke preferences move to new device storage that keeps per-game choices separate from automatic decisions. The previous storage could not tell the two apart, so saved per-game hide and show values, including choices you made yourself, are cleared once, as the user approved. Your default and its history (automatic, Always hide or Always show) carry over unchanged. Settings shows a notice when values were cleared. Damaged saved preferences still hide Duke until you choose a new setting.
- Daily and weekly lists, category counts, focused game links, Duke pinning and the Guide all follow the same visibility. Duke notifications stay off. Alerts, subscriptions, server data and configuration are unchanged, and no reinstall is needed.
- Unit tests and Chromium and WebKit browser tests cover the venue, game-state, manual-choice, delay and migration cases with synthetic game data. Behavior is not confirmed on a physical device.
- Tests and documentation: update the Duke visibility, Settings, Guide and compact scoreboard tests, and record ORD-019 and its accepted migration exception in `docs/ordering-decisions.md`.

## 1.13.6 · 2026-10-09

- Settings, Alerts and Help share one fixed sheet height that reaches 12px below the top safe-area inset (at least 24px from the top), replacing the 1.13.5 content-sized sheet capped at 90% of the viewport, so all three match whatever their content. The sheet stays anchored at the bottom; the pinned header, icon-only Close and independently scrolling body are unchanged (#116).
- Add a small grab handle to the sheet header. Dragging the header down moves the sheet with the finger: a short pull returns, and a deliberate pull closes through the normal Close path, sliding out from where it was released. Sideways movement, a second pointer, rotation or a viewport resize cancels the pull without closing. Buttons and an overflowing heading keep their normal tap and scroll behavior, and scrolling the body never closes the sheet. Reduce Motion removes the return animation.
- Reopening a sheet, including while it is still sliding closed, starts with no leftover pull offset, the heading and body scrolled to the top, and Close focused.
- When the body or an overflowing heading has more content than fits, one-finger touch scrolling at its edges is left to the browser's own overscroll, contained within the sheet, instead of being stopped by the dialog's scroll lock. Short content, multi-finger touches, a sheet beneath another dialog and browsers without overscroll containment keep the previous behavior.
- The user confirmed on their phone, in Safari and in a separate Home Screen preview of the pre-release `3a02fe0` build, the native scroll indicator and edge bounce, the consistent height of all three sheets, and that scrolling the body never closes them. No device model or OS version is recorded, and other devices and browsers are not confirmed.
- Sheet colors, rounding, Close button, Display details placement in Settings, saved preferences, alert behavior, subscriptions and data are unchanged from 1.13.5.
- Tests and documentation only, with no app behavior change: update the browser-test fixtures and Settings sheet tests, and document the panel interactions in `docs/panel-interactions.md`.

## 1.13.5 · 2026-10-07

- Restore the preferred original Help and Alerts presentation, replacing the 1.13.4 right-side panel: a content-sized bottom sheet in #121c2a with a #344257 border and 24px rounded top, centered at up to 640px wide, sliding up over 500ms and down over 300ms (Reduce Motion still disables it). Its height is capped at 90% of the viewport and 12px below the top safe-area inset. Settings follows the same sheet. Each sheet keeps one pinned, icon-only Close (44px, labeled "Close") that opens focused, a 23px title, and a body that scrolls on its own. A heading becomes a named, focusable scroll region only when enlarged text really overflows it (#116).
- Closing a sheet returns focus to the button that opened it without scrolling the page, including from a scrolled page and when a tap left focus on another control. If that button can't take focus, the standard dialog focus return still applies.
- Side safe-area padding inside the sheet applies only the part of the inset the centered sheet does not already clear, keeping the normal 24px body and header-left and 16px header-right spacing.
- Move the collapsed, read-only Display details to the first row of Settings under Support, and remove it from Help.
- Scores and portrait Guide add up to 18px below a top safe-area inset (80px at a 62px inset, 12px without one); short-landscape Guide spacing is unchanged.
- In the Home Screen app (`display-mode: standalone`), the page body is at least the viewport height (`100vh`, then `100lvh`). In simulator captures of the existing installation, this filled the full portrait window and the sheets reached the bottom of the screen; the mechanism is unknown, and it is not confirmed on a physical iPhone. In browser tabs the minimum is the dynamic viewport height (`100dvh`), with no fallback, so a short page doesn't gain scroll under Safari's toolbar.
- Status-bar metadata (`black-translucent`, `viewport-fit=cover`) is unchanged, and no reinstall is requested. Browser checks use simulated insets. These are candidate mitigations, not a confirmed iPhone fix; native and physical-iPhone confirmation remain open in #116 (see `docs/ui-recovery.md`).
- Release tooling only, with no app source change: pin Wrangler 4.129.1 and the Cloudflare Vite plugin 1.54.5. The two-build update check now waits until the page has read each health response before advancing its test clock, and saves partial diagnostics if it fails. Two earlier checks on main failed (a blank Wrangler error, then a missing Refresh app button); their cause is unknown, and these changes are not a confirmed fix.

## 1.13.4 · 2026-10-07

- Open Alerts and Help as the same full-height right-side panel as Settings (full width below 600px, 430px otherwise). Each has one pinned, labeled 44px Close that opens focused, and only the panel body scrolls, when its content needs it. Shared 300ms open and 200ms close motion; Reduce Motion still disables it. Alert settings and request handling, Help content and app-update actions, and the Settings confirmation are unchanged (#116).
- Leave 8px below the top safe-area inset on Scores and the Guide (at least 12px without an inset); short-landscape Guide spacing is unchanged. A solid, noninteractive band covers the status-bar area so scrolled content and the sticky category row stay below it. Focused-game scroll offsets include the inset.
- Add a collapsed, read-only Display details section to Help showing display mode, safe-area insets and viewport size, measured when opened and after rotation. Nothing is stored or sent.
- Status-bar metadata (`black-translucent`, `viewport-fit=cover`) is unchanged; the update arrives through the usual in-app refresh, and no reinstall is requested. Browser checks use simulated insets; these are layout mitigations, not a confirmed iPhone fix. Native confirmation remains open in #116.

## 1.13.3 · 2026-10-07

- Add 16px of Settings header spacing below the top safe-area inset to address reported portrait clipping of Settings, X and Close (#116). Preserve the right-side landscape panel and independently scrolling content.
- The user confirmed installed-iPhone dismissal in both orientations and landscape scrolling on 1.13.2. The new portrait spacing still needs on-device confirmation; a zero reported safe-area inset would leave the header spacing unchanged.

## 1.13.2 · 2026-10-06

- Pin a labeled 44px Close button in Settings while its content scrolls, with layouts for narrow landscape screens and enlarged text. Opening Settings focuses Close and preserves saved preferences, from both Scores and the Guide (#116, #119).
- Browser functional and layout checks passed in Chromium and WebKit, where the originally reported inability to leave Settings was not reproduced. Native iOS and touch-swipe behavior remain unverified (#116).

## 1.13.1 · 2026-10-05

- Align the owner-only sample alert with normalized ESPN school names: Western KY and Coastal (#103, #117). Preserve the sample label, current-device restriction and duplicate protection.
- Native phone and Watch presentation, tapping and other real alerts remain to be verified; source checks and deployment do not establish real-device delivery (#103).

## 1.13.0 · 2026-10-03

- Put each school, valid ranking and score on its own alert line. Keep the alert reason in the title and omit redundant margin or tie text (#103, #111).
- Add an owner-only, delayed sample alert for the current device, using the same formatter as game alerts. Preserve subscription ownership, duplicate protection, settings revisions and existing delivery history. Provider acceptance does not establish phone or Watch display; real-device presentation remains to be checked (#103).

## 1.12.4 · 2026-09-27

- Suppress every alert type for known matchups between two unranked Group-of-Six teams. Make existing pending events terminal when they become excluded, while preserving subscriptions, trigger IDs and delivery history (#101, ORD-018).
- Keep fallback team labels readable at larger text sizes and show the betting line and its source in expanded upcoming-game details (#102).
- Allow a bounded two-second tolerance for halftime-only retry backoff so a deadline timeout can recover on the 60-second poll; preserve the exact odds retry gate (#80).
- Repair the opt-in local poll diagnostic's CDN/date-API allowlist and source/error attribution, with deterministic tests proving that real push transport stays blocked. Production feed behavior is unchanged (#58).
- Capture browser-test server exits, stderr and resource evidence promptly; recognize colored Wrangler errors and stabilize queued updater tests. The initiating cause of intermittent Wrangler exits remains under investigation in #94.

## 1.12.3 · 2026-09-26

- Omit the betting line from canceled, postponed, no-contest and forfeited games, in both the score row and game details (#93).
- Give the line in expanded game details the same pregame screen-reader context as the inline line, without a visible “Pregame” label or an announced minus sign (#93).
- Align the expanded line with other game details and scale it and the red-zone label with larger text. Show only win-loss(-tie) team records; a malformed ESPN record is omitted instead of dropping the game (#93).

## 1.12.2 · 2026-09-26

- Remove recovered-favorite finals from Upsets while preserving other matching categories and the completed-upset count (#97, ORD-016).
- In Final, put known two-unranked Group-of-Six matchups after other games, following Duke/Virginia Tech pins; preserve kickoff order among the other finals (#98, ORD-017). Live-game priority and alerts are unchanged.

## 1.12.1 · 2026-09-26

- Include any trailing validated pregame favorite or known higher-ranked team in displayed Upsets and counts, including unranked favorites outside ACC/SEC and contrary or pick’em lines (#95, ORD-015). Preserve ordering and phone-alert rules.
- Keep the last cards visible but show unknown category counts while scores are stale; restore fresh counts after a successful refresh.
- Cover the direct ESPN, CDN and hosted fallback failure/recovery sequence. The historical iPhone transport failure remains unproven.

## 1.12.0 · 2026-09-26

- Improve alert settings with clearer on, off, focus, saving and unavailable switch states, including narrow-screen and larger-text support (#62, #63, #90).
- Shorten the visible alert descriptions and place the full policy in an expandable explanation. Alert delivery behavior is unchanged.

## 1.11.0 · 2026-09-20

- Show active Upsets first and the total of active plus completed upset results in parentheses (#75).
- Keep recovered-favorite watches visible without counting them as completed upsets, with accessible labels and narrow-phone layout coverage.

## 1.10.0 · 2026-09-19

- Prioritize stronger live games with explicit Power Four and Group of Six conference evidence while preserving late-game drama, favorite evidence and the Duke/Virginia Tech pins (#82, ORD-012).
- Separate ranking disruption from favorite-based upset interest so Watchlist labels remain truthful, including when a ranked underdog is favored (#74, ORD-012).
- Hold an unranked Group of Six fourth-quarter close-game alert when a stronger fresh live candidate exists, without rewriting its original transition-time payload if it later delivers (#82, ORD-012).
- Preserve existing tie and one-to-three-point narrow-lead priority, verify Duke and Virginia Tech pins through ESPN parsing, and clarify that upcoming chronology applies within preferred-team tiers (#71, ORD-013).
- Replace fixed browser-test delays with observed health and request boundaries, and retain lifecycle, console, request and crash evidence for diagnosing intermittent WebKit failures (#69, #77).

## 1.9.0 · 2026-09-19

- Make ACC, Top 25, One score and Upsets independent toggles that combine, with All as the reset to the complete watchlist (#73, ORD-011).
- Add a Day | Week control so any category combination applies to the selected date or the current Thursday–Monday football week; existing `tab=` links keep their meaning and app-update refresh restores the exact selection and period.
- Serve every weekly category from the full-FBS weekly feed, retiring the ACC-only weekly request, and warn when ESPN returns its maximum number of games.

## 1.8.0 · 2026-09-18

- Add an estimated halftime countdown anchored to ESPN’s recorded end of Q2, with an Awaiting 3rd quarter state after 20 minutes.
- Keep timing evidence in the browser session and hide estimates when status, visibility, connectivity or device-clock checks cannot support them.
- Share the existing optional summary budget with odds, preserving odds priority and score fallback behavior. Guide timing and Watchlist ordering are unchanged.

## 1.7.1 · 2026-09-12

- Replace spacious score cards with compact listings and expandable game details, retaining spoiler protection and focused-game behavior.
- Simplify the header, group update status with Duke visibility and Hide finals, and remove redundant live-section labels.
- Preserve readable team names and scores with larger text across phone and tablet widths.

## 1.7.0 · 2026-09-12

- Add Settings to Scores and Guide, with Duke away and neutral-site games hidden by default.
- Save per-game hide/show choices on each device, including through refreshes and final results; changing the future default preserves prior games.
- Exclude hidden Duke matchups before filters, counts and Guide layout, omit team records that could reveal results, and always suppress Duke notifications.

## 1.6.3 · 2026-09-12

- Pin Duke and Virginia Tech within each game-state section, preserving filters and hidden finals.
- Raise ranked upset watches above ordinary comfortable wins and retain most interest when a ranked favorite ties, with comparable active upsets remaining higher.
- Record cumulative ordering decisions, explicit exceptions and regression coverage so later requests preserve earlier preferences. The ambiguous 16–17-point-margin request remains pending; its existing behavior is unchanged.

## 1.6.2 · 2026-09-11

- Gradually reduce Watchlist priority for comfortable leads, including in the first half, while retaining ACC interest, ranking relevance and meaningful upset significance (#66).
- Smooth score-margin and halftime transitions, reduce multi-score drama as regulation time runs out, and give close fourth-quarter games more priority relative to comfortable leads.
- Guard priority calculations against malformed saved scores; preserve shared tab ordering, stable tiebreakers and notification behavior.

## 1.6.1 · 2026-09-10

- Prefer full school names in the Guide, measure available space before falling back to abbreviations, include rankings and make kickoff times less prominent.
- Explain stars with an explicit Watchlist legend in All games; hide the legend and redundant stars in Watchlist mode.
- Add a Find on YouTube TV matchup-search link in game details while preserving Gamecast. The link opens search, not direct playback or confirmed viewing access.

## 1.6.0 · 2026-09-10

- Add a responsive TV Guide with network rows, Eastern kickoff times, watchlist filtering, game details and an accessible text schedule (#60).
- Show estimated game windows, overlapping broadcasts and unknown kickoff times honestly; preserve selected dates, browser navigation and retained schedules during refresh failures.
- Add static Guide delivery and regression coverage for mobile layouts, keyboard navigation and accessible game labels. Preserve alert preferences, subscriptions, trigger IDs and delivery history.

## 1.5.0 · 2026-09-09

- Add per-device close-game, upset-watch, final and ACC kickoff choices. Existing devices retain their selections; enrollment through the updated UI defaults to upset watch only, while legacy clients omitting the new fields retain legacy defaults. Turning alerts off preserves saved choices (#54).
- Use selective late-game upset watches, fresh activation baselines and shared live-alert deduplication to avoid replaying conditions already underway or sending a second live alert for the same game. Preserve ownership checks, subscriptions, trigger IDs and delivery history (#54).
- Add a guarded, paused cutover procedure with tested poll fencing and retained release-preflight evidence; prohibit preference-unaware alert rollbacks and require fresh-baseline acceptance before paired release (#54).
- Improve updater test diagnostics and retained failure evidence without changing app update behavior.
- Document the investigation finding that no reliable low-cost CDN freshness signal was available, so no speculative runtime freshness heuristic was added; existing coverage checks remain unchanged (#46).

## 1.4.4 · 2026-09-08

- Serve the prebuilt homepage through static assets to avoid repeated Worker rendering on app opens (#38, #50).
- Preserve client-side dates, preferences, scores and update restoration; keep score and health APIs dynamic and verify asset-first routing in workerd.

## 1.4.3 · 2026-09-08

- Reuse the Eastern date formatter during score processing to reduce measured CPU work (#38). Production resource-limit verification remains required; this does not establish a fix for cold homepage rendering.
- Fix notification sends rejected by the Workers runtime before reaching the push provider; preserve known response statuses and add sanitized diagnostics without changing ownership, deduplication or delivery retry behavior (#9, #48).

## 1.4.2 · 2026-09-08

- Restore complete overnight score coverage by validating and joining adjacent ESPN football weeks when the primary feed is unavailable (#41).
- Preserve strict coverage checks and existing alert subscriptions, ownership, keys, and delivery history; log primary-feed failures for diagnosis.

## 1.4.1 · 2026-09-08

- Clear pending update-check announcements when the app is hidden or offline, while preserving deliberate checks and dismissal overrides (#36, #39).
- Use committed view state when restoring the app after an update, and clarify delayed navigation and retry feedback.
- Add suspension and retry regression coverage; preserve alert subscriptions, delivery history, and notification rules.

## 1.4.0 · 2026-09-07

- Offer Refresh app/Later when a new deployment is confirmed, with a manual update check in Help (#17, #35).
- Preserve the selected date, category, Hide finals, focus target, unrelated URL state, and saved preferences during an explicit refresh.
- Add quiet background checks, per-deployment dismissal, accessible feedback, and recovery when navigation is cancelled.
- Validate updates with two local builds and simulated mobile browser flows. Installed-iOS behavior and real notification delivery are not established by these tests.
- Track nonblocking feedback and slow-navigation copy refinements in #36.

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

## 1.2.0 · 2026-09-06 · deployed locally; release workflow prepared

- Status corrected October 17, 2026 (#9): this entry previously said "prepared, not deployed". On September 6, 2026 an authorized local Wrangler session made this version's initial Cloudflare deployment while the GitHub release workflow was still being set up. Automated paired releases were recorded later in #9.
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

Every published change gets a new semantic version, changelog entry, source commit, immutable Git tag, and GitHub release. Never move an existing release tag. The initial v1.2.0 deployment used an authorized local Wrangler session; subsequent automated releases use the GitHub release workflow to deploy the exact tagged source to Cloudflare and verify the deployed version and commit. See `docs/releases.md` for setup and rollback. Existing Sites publications remain available during migration; new releases do not require a Sites source push or saved version.
