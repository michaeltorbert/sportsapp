# Watchlist ordering

The durable rule and conflict history is in [ordering-decisions.md](ordering-decisions.md). Read it before changing this implementation.

Issue #10 combines team relevance, live drama, and upset significance. Every category selection and period uses the same comparator for the games it includes; the selection is a filter and adds no priority (ORD-011). Live games come first, then delayed games, upcoming games, schedule updates, and finals. Within each state section, Duke and Virginia Tech come first. Both share one pinned tier; the existing priority/chronological tiebreakers order games within that tier and within the ordinary tier. Upcoming games remain chronological within each tier. Pinning does not change filter eligibility or the Hide finals setting. Equal live priorities use drama, a final-minute clock band, kickoff, and event ID as stable tiebreakers.

## Live priority

The score is an internal ordering weight, not a probability or a percentage.

| Component | Weight |
| --- | --- |
| ACC involvement | 20; another 2 for two ACC teams |
| Non-ACC Power Four involvement (SEC, Big Ten or Big 12) | 4 once per game |
| Best ranking | 30 for Top 5; 26 for Top 10; 14 for Top 25 |
| Two ranked teams | 4 |
| Relevance cap | 50 |

The urgency stage is 1–3 for the first three quarters, 4 for the fourth quarter, 5 for the final five minutes of regulation, and 6 for overtime. A missing or invalid clock or an intermission never supplies a final-minute bonus. A game with a missing period gets no urgency credit.

A margin of eight points or fewer earns six times the urgency stage. In the first half, that drama weight decreases linearly to zero between eight and twenty points (three times the stage at fourteen points). After halftime the zero-drama margin shrinks smoothly from twenty to sixteen points by regulation’s end; at Q4 kickoff it is eighteen. One-score games retain their full drama weight. A margin of three or fewer gets four additional points in the final five minutes or overtime. An early 0–0 game therefore receives six drama points, compared with 34 for a tie in the final five minutes. Team relevance still matters independently.

Issue #66 replaces the abrupt 25-point / second-half 17-point reduction with a continuous taper. Relevance stays at full weight through an eight-point margin. Beyond eight, subtract 65% times `min(1, (margin - 8) / (22 - 2 * elapsedQuarters))` from its multiplier. Elapsed regulation quarters run from zero at kickoff to four at regulation's end, using the reported quarter and a valid known clock; overtime stays at four. A missing or invalid clock uses the start of the reported quarter. An explicit end-of-quarter intermission uses that quarter's end, including halftime, so halftime and Q3 kickoff have identical relevance. Missing scores or a nonfinite margin from malformed saved scores receive no margin reduction or close-game drama.

The relevance floor remains 35%, reached at a 30-point margin at kickoff, 26 at halftime, and 22 at regulation's end. These are product weights, not estimates of comeback probability. Increasing a favorite's lead cannot raise its priority. Smoothing drama across the margin range also removes the old 16/17-point drama cliff. Quarter urgency can still lift competitive games as play advances; it cannot create the old halftime relevance collapse. Rankings and ACC interest still distinguish equally competitive games, and an early ordinary tie does not automatically beat a relevant two-score game.

The taper applies to either leader, while the separate supported upset bonus preserves additional interest when the expected winner trails. Significant upsets thus remain above otherwise identical comfortable favorite wins, without making every large upset deficit outrank a close late game. Final-minute tiebreak bands remain five minutes, two minutes, and one minute. Close one-score games retain those time bands; wider margins can gradually change relative priority as reported clocks advance. Kickoff and event ID still break otherwise equal scores.

Historical screenshot comparison (explicit ordinary favorite assumptions; the screenshots do not establish betting lines). The current column includes subsequent tie/disruption and Power Four calibrations:

| State | Original priority | Current priority |
| --- | ---: | ---: |
| No. 24 Louisville 31–10 Villanova, Q2 1:53 | 34 | 18.26 |
| No. 23 Missouri 0–0 Kansas, Q1 7:21 | 24 | 33.19 |
| Boston College 14–0 Rutgers, end Q1 | 24 | 22.32 |
| No. 25 Virginia 28–3 Norfolk State, end Q2 | 11.90 | 13.13 |

Both Missouri–Kansas and Rutgers–BC now precede both larger leads. Virginia's weight rises slightly because a 25-point first-half margin no longer triggers an abrupt floor; its relative position below the two alternatives remains correct. No prior pairwise preference fixture was removed or reversed.

Late-game tradeoff: at Q4 kickoff, a No. 24 ACC favorite leading by seventeen scores 23.97 (21.57 relevance plus 2.40 drama), below an ordinary one-score game at 24. This holds for leads from seventeen through twenty-four and throughout Q4. The old threshold assigned 11.90; the smooth rule keeps some relevance without lifting this comfortable win above a competitive alternative. A Top 5 ACC favorite with the same seventeen-point lead still scores 34.12 at Q4 kickoff because its relevance is stronger, but falls to 29.30 with one minute remaining, below the ordinary one-score game at 30.

Upset significance uses the largest supported signal rather than adding overlapping signals:

- Ranking: 12 for Top 5, 9 for Top 10, or 6 for Top 25; add 8 for a known unranked opponent or 4 for a ranking gap of at least ten places.
- Pregame spread: 16 for at least 14 points, 12 for at least 7, or 8 for a smaller nonzero spread.
- Conference watch: 8.

Favorite-based `upset` significance is capped at 20. Multiply it by the score-state factor: 1 when trailing, 0.75 when a ranked expected winner is tied, 0.5 for a lead of up to three in the final five minutes or overtime, otherwise zero. Unranked ties retain the previous half-credit rule only in the final five minutes or overtime.

The distinct `disruption` component uses rankings and scores independently of the betting favorite. The better-ranked team must have a valid Top-25 rank and its opponent must have a worse valid rank or be known unranked. Its weight is `35 * (1 - comfort)`, multiplied by the same 1 / 0.75 / 0.5 score-state factors relative to that better-ranked team. Both components use stage factors 0.25 / 0.5 / 0.75 / 1 for Q1 / Q2 / Q3 / Q4-or-later and margin factors 1 through eight points, 0.75 through sixteen, then 0.5 in the first half or 0.25 later. These are coordinator-selected calibrations, not user-specified numbers. There is no display spread threshold.

A worse-ranked betting favorite trailing a better-ranked opponent by more than three points receives favorite-based upset significance but no rank-disruption component: the better-ranked team is winning comfortably enough that no tie or late narrow-lead retention applies. The focused `ORD-012 worse-ranked betting favorite trailing a better-ranked opponent gains only favorite upset significance` regression covers this boundary.

35 is the smallest whole-point disruption weight satisfying both narrow-line #74 fixtures with these retained factors: Iowa State 9–0 No. 21 Iowa, Q2 7:51 scores 40.82 when Iowa State is the assumed favorite, above No. 1 Ohio State 10–0 No. 4 Texas at end Q1 (40.53). Weight 34 would score 40.47 and fail. The assumption with Iowa favored, absent-line and pick’em variants are covered independently; multiple-score assumed lines do not establish an unconditional pairwise requirement.

This preserves most upset interest when a ranked favorite ties, while keeping a comparable ranked favorite trailing an unranked opponent higher. Ties and narrow leads affect ordering without receiving an upset label. A ranked betting underdog still receives no favorite-based bonus for trailing. The additional interest reaches zero at the same large-margin threshold as the relevance floor. The existing 16/17-point upset-margin step remains pending clarification under ORD-008; it is not silently smoothed.

No. 11 Oklahoma trailing Michigan 0–10 at Q3 14:52 precedes No. 10 Texas A&M leading Arizona State 17–13 at Q3 10:14. Earlier claims that all extra interest disappears on a tie were superseded by ORD-006.


## Favorite evidence and labels

Power Four relevance is bounded, never a binary tier above live drama. ACC remains 20/22, SEC-only remains 4, ACC-versus-SEC remains 24, and comparable Big Ten/Big 12 involvement gains the same 4 once. Group of Six means American, CUSA, MAC, Mountain West, Pac-12 and Sun Belt; unknown conferences, independents and FCS are not presumed Group of Six. No conference evidence changes category membership or favorite inference.

1. A validated pregame line takes precedence, including a known pick'em. The favorite must belong to the game, explicit favorite flags must agree with the home-oriented spread, and equally preferred sources must not conflict.
2. Without a valid line, known rankings identify a rank-based watch.
3. With both teams known unranked, an ACC or SEC team trailing a team from the American, Conference USA, MAC, Mountain West, or Sun Belt receives an explicitly labeled **conference watch**. Conference alone is not evidence of a betting favorite. Unknown conferences, independents, and other power conferences do not trigger this fallback.

A game paused after kickoff keeps its upset eligibility in the Delayed section, with no live urgency credit and no new phone trigger. A delayed kickoff that has not started does not qualify as an upset.

A pause after kickoff also preserves the last live one-score observation for the eventual final, on this device, without showing a one-score badge or counting the paused game as live. Play that resumes at a wider margin replaces that observation; a delay that was never observed live, an unstarted delay, or a different event or matchup carries nothing. The upset history of a paused game still follows the paused snapshot's own score, so a favorite that recovered during the delay does not keep an earlier upset watch. Saved daily and weekly boards keep this history separately, and phone alerts ignore it.

An unranked ACC or SEC betting favorite can trigger a watch against any opponent. Thus Florida trailing ECU is included even if both are unranked. A valid line favoring ECU prevents Florida's deficit from being mislabeled. Unrelated unranked favorites do not expand the watchlist to every betting upset.

Pregame scoreboard odds are read only before kickoff. On a first visit after kickoff, optional ESPN summary `pickcenter` data can recover the pregame line. The generic/live summary `odds` field is not used. Summary results must match the event and both competitors. Each board lookup attempts at most 12 events, four at a time, within its own 1.5-second abort budget; failures preserve scores and allow honestly labeled fallbacks. Daily and weekly boards can overlap, so these are per-board limits, not a global concurrency cap. Finished results are shared; in-flight work stays independent so cancelling one board cannot cancel another. Finished results are cached by event, kickoff, and competitors: six hours for a line and five minutes for a successful response without one. Previously observed pregame lines also survive pre-kickoff feed omissions, score refreshes, and reloads through the existing board history. A changed kickoff invalidates that old betting baseline; retained categories still follow the same event and competitors across a schedule update.

Relevant public ESPN schema was checked on 2026-09-06 using scoreboard, summary, team, and conference endpoints. Completed events retained lines in `pickcenter` when scoreboard odds were absent. No in-progress games were available during that observation, so live scoreboard odds were not independently verified and are deliberately ignored.

Finals remain at the bottom. A comeback can retain an earlier upset-watch category without claiming an upset occurred. Actual finals disclose line, rank, or conference evidence. Phone alerts use their separate selective late-game rules and retained pregame evidence; display disruption never changes those conditions or trigger IDs. Close-game delivery applies the global slate gate documented in [the alert policy](../services/alerts/README.md#close-game-slate-prioritization-82). Category selections never filter notifications, and Duke notifications are always off. The expanded unranked display watches do not create new upset-watch triggers.

Failed or timed-out summary attempts rotate behind events not yet attempted, so repeated failures cannot monopolize each refresh's request slots. Transport failures and deadline timeouts also receive a one-minute retry backoff. Caller cancellation does not count as a provider failure. This bounded retry bookkeeping is separate from favorite evidence and never asserts that a missing line was found.

## Verification

`npm test` builds the app and runs the suite. Pairwise fixtures cover the approved comparisons, including Top 10 vs. unranked above a comparable unranked ACC tie; No. 3 vs. unranked above No. 24 vs. No. 25; ranked ACC upset above a comparable unranked ACC game; and close fourth-quarter games above a ranked team losing by 30. Other tests cover line provenance, absent data, cancellation, cache identity, retained finals, shared tab ordering, rendered explanations, and unchanged push IDs.


The second screenshot regression covers No. 6 Oregon trailing Oklahoma State 14–24 at Q2 1:56. It remains ahead of ordinary comfortable wins by Penn State, Texas A&M and Georgia. Virginia Tech's 24-point lead is now pinned ahead of Oregon under ORD-007. Oregon's original exact second position was an assistant interpretation, not a user requirement; retained tie interest can now put the fourth-quarter Oklahoma tie ahead of the second-quarter Oregon deficit. The fixtures leave unverified opponent conferences explicitly unknown instead of inventing conference-watch evidence. They do not claim recovered betting lines or establish the phone's loaded application version.
