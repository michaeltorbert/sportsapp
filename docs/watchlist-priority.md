# Watchlist ordering

Issue #10 combines team relevance, live drama, and upset significance. Every tab uses the same comparator for the games it includes. Live games come first, then delayed games, upcoming games, schedule updates, and finals. Upcoming games remain chronological. Equal live priorities use drama, a final-minute clock band, kickoff, and event ID as stable tiebreakers.

## Live priority

The score is an internal ordering weight, not a probability or a percentage.

| Component | Weight |
| --- | --- |
| ACC involvement | 20; another 2 for two ACC teams |
| SEC involvement | 4 |
| Best ranking | 30 for Top 5; 26 for Top 10; 14 for Top 25 |
| Two ranked teams | 4 |
| Relevance cap | 50 |

The urgency stage is 1–3 for the first three quarters, 4 for the fourth quarter, 5 for the final five minutes of regulation, and 6 for overtime. A missing or invalid clock or an intermission never supplies a final-minute bonus. A game with a missing period gets no urgency credit.

A margin of eight points or fewer earns six times the urgency stage; nine through sixteen earns four times the stage. A margin of three or fewer gets four additional points in the final five minutes or overtime. An early 0–0 game therefore receives six drama points, compared with 34 for a tie in the final five minutes. Team relevance still matters independently.

From the third quarter onward, margins of 17 or more reduce relevance to 35% and eliminate close-game drama. This keeps a major ranked loss visible while letting a close fourth-quarter game rise above it. Final-minute tiebreak bands are five minutes, two minutes, and one minute; the clock does not reorder otherwise equal games every second.

Upset significance uses the largest supported signal rather than adding overlapping signals:

- Ranking: 12 for Top 5, 9 for Top 10, or 6 for Top 25; add 8 for a known unranked opponent or 4 for a ranking gap of at least ten places.
- Pregame spread: 16 for at least 14 points, 12 for at least 7, or 8 for a smaller nonzero spread.
- Conference watch: 8.

Significance is capped at 20 and scaled by game stage and margin. A trailing expected winner receives full state credit; a tie or a lead of up to three points receives half credit only in the final five minutes or overtime. Those narrow leads and ties affect ordering without being labeled as a trailing upset. Large late deficits receive only one-quarter upset credit.

## Favorite evidence and labels

1. A validated pregame line takes precedence, including a known pick'em. The favorite must belong to the game, explicit favorite flags must agree with the home-oriented spread, and equally preferred sources must not conflict.
2. Without a valid line, known rankings identify a rank-based watch.
3. With both teams known unranked, an ACC or SEC team trailing a team from the American, Conference USA, MAC, Mountain West, or Sun Belt receives an explicitly labeled **conference watch**. Conference alone is not evidence of a betting favorite. Unknown conferences, independents, and other power conferences do not trigger this fallback.

An unranked ACC or SEC betting favorite can trigger a watch against any opponent. Thus Florida trailing ECU is included even if both are unranked. A valid line favoring ECU prevents Florida's deficit from being mislabeled. Unrelated unranked favorites do not expand the watchlist to every betting upset.

Pregame scoreboard odds are read only before kickoff. On a first visit after kickoff, optional ESPN summary `pickcenter` data can recover the pregame line. The generic/live summary `odds` field is not used. Summary results must match the event and both competitors. Enrichment attempts at most 12 events, four at a time, within a 1.5-second abort budget; failures preserve scores and allow honestly labeled fallbacks. Finished results are cached by event, kickoff, and competitors: six hours for a line and five minutes for a successful response without one. Previously observed pregame lines also survive score refreshes and reloads through the existing board history.

Relevant public ESPN schema was checked on 2026-09-06 using scoreboard, summary, team, and conference endpoints. Completed events retained lines in `pickcenter` when scoreboard odds were absent. No in-progress games were available during that observation, so live scoreboard odds were not independently verified and are deliberately ignored.

Finals remain at the bottom. A comeback can retain an earlier upset-watch category without claiming an upset occurred. Actual finals disclose line, rank, or conference evidence. Existing phone alerts retain their ranked-upset contract; this change broadens the visible watchlist without broadening phone notifications.

## Verification

`npm test` builds the app and runs the suite. Pairwise fixtures cover the approved comparisons, including Top 10 vs. unranked above a comparable unranked ACC tie; No. 3 vs. unranked above No. 24 vs. No. 25; ranked ACC upset above a comparable unranked ACC game; and close fourth-quarter games above a ranked team losing by 30. Other tests cover line provenance, absent data, cancellation, cache identity, retained finals, shared tab ordering, rendered explanations, and unchanged push IDs.
