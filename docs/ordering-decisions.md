# Watchlist ordering decisions

This is the cumulative product contract and conflict log. The numeric implementation is documented in [watchlist-priority.md](watchlist-priority.md). Regression coverage lives in [watch-priority.test.mjs](../tests/watch-priority.test.mjs). Repository [AGENTS.md](../AGENTS.md) requires reading and updating this log for every ordering change.

## How to use this record

1. Append the next stable ORD ID for a new instruction. Record the actual wording or faithful paraphrase and date; label uncertain interpretations.
2. Compare against every active rule below. Preserve existing rules unless an explicit new instruction supersedes one. Describe every exception and conflict; ambiguous conflicts need user direction before implementation.
3. Add a test for the requested comparison and run all old and new ordering tests plus the full suite. A failed older test is evidence of a conflict to resolve, not permission to erase it.
4. Add a dated change entry naming the IDs affected, decisions and validation. Commit the log, tests, code and instructions together. Earlier versions and exact code diffs remain in Git history.

## Rules

| ID | Source and status | Requirement | Coverage / exceptions |
| --- | --- | --- | --- |
| ORD-001 | Imported baseline at b409f4b; active | Keep live, delayed, upcoming, schedule updates and finals in separate ordered groups; shared filters preserve relative order; do not mutate input. | `every filter preserves shared relative order, chronology and immutable inputs`; `ORD-007 Duke and Virginia Tech lead each state group without crossing groups`. Upcoming chronology is now within pin tiers under ORD-007. |
| ORD-002 | Imported baseline tests/docs for issue #10; active | Preserve prior relevance preferences: comparable Top 10 over ordinary ACC tie; ranked ACC upset over comparable unranked ACC; ACC relevance among comparable ranked games; close late games above ranked teams losing by 30. | `confirmed viewing preferences hold for concrete games in either input order`; `relevance, late urgency and significant upsets survive comfortable-lead tuning`. These imported tests are evidence of prior behavior, not newly reconstructed user quotations. Pin exception ORD-007. |
| ORD-003 | Imported issue #66 / PR #67 at b409f4b; active | Comfortable wins lose interest continuously as margins/time grow; preserve historical screenshot comparisons and close late alternatives. Missing data must not create fake urgency. | `issue 66 screenshot alternatives precede both comfortable ranked ACC leads`; `favorite leads taper monotonically without the old single-point cliffs`; `comfortable leads remain continuous through halftime and Q3 and fade with elapsed time`; `ordinary one-score fourth quarters beat comfortable lower-ranked ACC wins`; clock/malformed-score tests. This smoothness contract originally covers favorite-lead relevance/drama, not every upset margin factor. Pin exception ORD-007. |
| ORD-004 | User, 2026-09-12; active | “a ranked team getting upset should be over tamu winning.” Protect No.11 Oklahoma 0–10 Q3 14:52 above No.10 Texas A&M 17–13 Q3 10:14. | `ranked upset watch precedes Texas A&M winning in the reported third-quarter state`; unknown spread and explicit assumed spreads tested. Do not invent odds or label a ranked betting underdog an upset. Pin exception ORD-007. |
| ORD-005 | User, 2026-09-12; active with explicit exception | “oregon losing to osu should not be the 7th game down either.” No.6 Oregon 14–24 Q2 1:56 should precede ordinary comfortable wins in that screenshot. | `Oregon upset ranks near the top of the seven screenshot games`. Virginia Tech is now exempt under ORD-007. Exact second position and Oregon above the later tied Oklahoma game were assistant interpretations, superseded below. |
| ORD-006 | User, 2026-09-12; active | A ranked team tying should not necessarily drop sharply, but a comparable ranked team losing to an unranked opponent should remain above it. | `ORD-006 ranked ties retain interest below comparable ranked upsets`. Implementation retains 75% of the ranked tie's upset-interest component in every stage; late narrow leads retain 50%. These percentages are Codex calibration, not user-specified constants. Total interest still depends on stage, relevance and margin. A tie never receives an actual-upset label. Pin exception ORD-007. |
| ORD-007 | User, 2026-09-12; active, highest priority within a state group | “Duke and Virginia Tech should always be at the top when their games are on. when they are future or previous games, they should be at the top of the future or previous games.” | `ORD-007 Duke and Virginia Tech lead each state group without crossing groups`. Applies to each included state group and each filter where the game qualifies; never moves a final above live games or overrides Hide finals. Both teams share a tier, with normal priority/chronology ordering between them; no Duke-versus-VT preference was stated. ESPN team IDs 150 and 259 verified against the official team endpoint on 2026-09-12. |
| ORD-008 | User, 2026-09-12; pending clarification | Exact wording: “Yeah, 16, 17.6 should be way down.” Asked whether this means 16–17-point margins should rank much lower. | Do not invent a hard cutoff or smooth the legacy margin step while unclear. Existing blowout and comfortable-lead rules/tests remain active. ORD-007 will still override ordinary drama if the intended interpretation is confirmed. |
| ORD-009 | Imported expectation/alert contract; active | Ordering follows supported favorite evidence; ties, pick'ems, unknown ranks and contrary lines do not acquire invented upset labels. Ranking changes must not change alert eligibility/IDs. | Existing Florida–ECU, intraconference, clock/tie, delayed-watch, and `expanded list eligibility does not redefine ranked push triggers or their dedupe IDs` tests. Pinning affects sort position only. |

## Conflict and supersession history

### 2026-09-12 — initial ranked-trailing change

- Added 24 points of ranked-trailing interest before stage/margin scaling, with continuous comfort taper. Added ORD-004 and ORD-005 screenshot regressions; full suite passed (253 tests after second fixture).
- Assistant interpretation: Oregon should be exactly second and above Virginia Tech's comfortable lead. This was not independently requested as an absolute ranking.
- Claude Fable 5.1 medium reviewed that frozen version: no blockers, with concerns about lead-change jumps, elite ties, and the legacy 16/17-point deficit step. That review does not cover subsequent revisions.

### 2026-09-12 — cumulative contract, ties and preferred teams

- ORD-007 explicitly supersedes the assistant's Oregon-over-Virginia-Tech comparison, and the baseline's unconditional upcoming chronology. All remaining ordinary-game comparisons stay protected.
- ORD-006 supersedes the implementation rule that all extra ranked interest vanishes at a tie. It also supersedes the assistant-imposed exact Oregon-second / Oregon-over-Oklahoma-tie assertions. The seven-game test now protects the user's actual complaint and the explicit pin exception, rather than freezing an invented complete ordering.
- ORD-006 retains 75% interest on ranked ties and 50% on late narrow leads. Thus an otherwise comparable active upset remains above the tie, while a tied No.1–No.2 matchup need not lose to a minor No.25 upset. This latter comparison is a regression guard chosen by Codex, not a new explicit user requirement.
- Corrected the screenshot fixture's unverified opponent conference to unknown, removing invented Wake–Purdue conference-watch evidence. No user preference is changed by correcting that evidence.
- ORD-008 remains pending. No change to the 16/17-point margin step is included in this revision.
- All old ordering scenarios remain present except the explicitly superseded assistant-derived comparisons listed above. New tests cover both pinned teams in either participant position, every state group, input-order reversal, future chronology within the pinned tier, filter eligibility/hidden finals, and ties/recoveries across all quarters and overtime.
- Validation: Codex ran the complete build and test suite: 255 passed, zero failures/skips. A separate read-only Codex reviewer found no actionable issues in this revision. This is not a renewed Claude/Fable verdict.

### 2026-09-12 — ORD-010 Duke spoiler protection

- Source: explicit user request, active. Hide Duke away and neutral-site matchups by default. Per-event hide/reveal overrides are independent of future defaults, persist past final, and apply before category counts, focus links, pinning, and Guide layout. Unknown home/neutral metadata stays hidden until explicitly revealed.
- ORD-010 supersedes ORD-007 only for hidden Duke games; revealed Duke and all Virginia Tech games retain the existing ordering. ORD-001 through ORD-006 and ORD-008 remain unchanged. ORD-009 has a new explicit Duke-only notification exclusion; other alert rules and IDs remain unchanged.
- Duke notifications are always off, irrespective of visibility. Default changes apply by kickoff time, preserving unseen historical games. Existing started games are remembered by event ID. Team records are suppressed while protection could apply, preventing indirect result disclosure across selected dates.
- Regression: `tests/duke-visibility.test.mjs` (including ORD-010 focus/category/Guide/input-order scenario), `tests/browser/duke-visibility.spec.mjs`; complete ordering and full suites required before handoff.
