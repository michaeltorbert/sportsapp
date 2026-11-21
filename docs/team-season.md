# Team seasons (#166)

A team page shows one team's **current** football season: its overall record, four
regular-season per-game averages for the team and its opponents, and the published
regular-season and postseason schedules. Every schedule game opens the existing game
screen in the app. Three full-name regular-season yard leaders (passing, rushing, receiving) appear above
the existing averages. There is no archive, year selector, full season player table or standings view.
The separate statistical ranks described below are retained; broader #181 remains open.

## Routes and history

- `/?team=<id>` is a team page. `<id>` is 1–6 digits; anything else, or a repeated
  `team`, is not a team page.
- `/?event=<id>&team=<id>` is a game opened from that team's schedule. The team is
  context for finding the game, never data: the game is shown only when the event
  is on the protected scoreboard (preferred, as it is fresher) or is an exact member
  of that team's checked schedule. Otherwise it is the generic unavailable screen.
- Both are root-owned entries (`lib/game-route.ts`): a `team` entry and a game entry
  with `team`. Opening a team from a game pushes a team entry above the game entry;
  opening a schedule game pushes a game entry above the team entry. Browser and
  on-screen Back/Forward traverse those genuine entries with focus and scroll restored.
- With nothing of ours behind it, Back from a schedule game replaces it with its team
  page, and Back from a team page replaces it with Scores. Neither leaves the app.

## Data

`GET /api/team?team=<id>` (`app/api/team/route.ts`, `lib/team-season-server.ts`) makes
fixed reads of ESPN's public team endpoints under one 9 s deadline:

1. `teams/<id>/schedule` — the source's active season (`season.year`/`type`; a supplied
   `requestedSeason` must match it). It is also the regular season when its type is 2.
2. `teams/<id>/schedule?season=<year>&seasontype=2` — only when the active type isn't 2.
3. `teams/<id>/schedule?season=<year>&seasontype=3` — the postseason.
4. `teams/<id>/statistics?season=<year>&seasontype=2` — regular-season statistics.

The year always comes from the source's active season, never from the calendar or the
URL. The record is the active season's `team.recordSummary` (`W-L` or `W-L-T`) and is
labeled with that season only.

Each schedule section is all-or-nothing. The envelope's team and `requestedSeason` must
match, and so must every event's `season.year` and `seasonType.type`, two distinct sides
including the team, a valid event id, a date and an opponent name. Events are unique, at
most 30. An empty list with no `requestedSeason` means none are listed (current
postseason before bowls are announced). A non-empty list without one is unverifiable.
Accepted events are adapted to the scoreboard shape (object score → scalar,
`logos[]` default → `logo`, `broadcasts[].media.shortName` → `names[]`, an invalid time
at either level → `timeValid: false`, no odds) and read by the unchanged
`normalizeScoreboard(raw, date, fetchedAt, endDate)` over the events' own Eastern date
range. It must return every event without warnings. The full opponent `displayName` is
kept for the page.

The four pairs are read by category and stat name from `results.stats.categories` and
the `results.opponent` list: `scoring.totalPointsPerGame`, `passing.yardsPerGame` (total
yards), `passing.passingYardsPerGame`, `rushing.rushingYardsPerGame`. The statistics
must name the same team and requested season (year, type 2). Values use the existing
season-metric shape (signed, up to two decimals). Missing, malformed or conflicting
repeats are unavailable, never zero.

Only completed seasons are cached per isolate (16 teams; 5 minutes, or 1 minute while a
game is live or a part is missing). At most two builds run at once; a third gets 503 with
`Retry-After: 5`. A failed refresh may return that team's last season, under 30 minutes
old, marked `stale`. `checkedAt` is the retrieval time. The browser (`lib/team-season.ts`,
`lib/team-season-client.ts`) validates the whole response again for the requested team,
with no direct-provider fallback, and `lib/use-team-season.ts` refreshes at the same
cadence, backs off after failures, pauses offline or hidden and cancels on team change.

## Time basis

A season crosses the switch between daylight and standard time. So the team page's schedule
shows each game's Eastern date and its kickoff converted on that date to Eastern time
(`America/New_York`), under the single cue "Dates and kickoffs in Eastern Time". It never
uses one season-wide EDT/EST abbreviation or the viewer's current zone. Scores, the Guide
and the game screen keep their existing time labels.

## Duke spoiler settings

The existing preferences and `dukeHidden`/`dukeStarted` are reused unchanged, and season
games are never passed to the Duke observation writer.

- A schedule game that is also on the scoreboard uses the scoreboard's copy (same event, same
  teams) for its row, so the fresher actual state decides (`withBoardGames`). Otherwise the schedule's own
  source state decides. Nothing is predicted from the clock or the scheduled kickoff time.
- Since 1.29.0 (#189) the page's aggregates require **both** the board-merged season and the
  team's own validated schedule to pass (`protectedAggregates`), and the defensive-pack request
  uses the same gate. A board copy can add protection but never remove it: an older or
  mismatched upcoming board copy cannot unhide a started hidden Duke game in the raw schedule.
  A raw schedule that still says live may briefly withhold aggregates after the board reports
  final, until the schedule refreshes.
- A Duke game hidden by the settings shows only its date on any team's schedule: no
  opponent, status, score, result or link. Its game screen is the generic unavailable one.
- The record, leaders, averages, statistical ranks and season detail are withheld on any team's page whose schedule contains a hidden
  Duke game that has started (`dukeStarted`, so a live 0–0 period-0 game counts). They are
  also withheld while preferences load if a possibly protected started Duke game is present,
  and while any schedule section is unavailable,
  because then a hidden result cannot be ruled out. A hidden game that hasn't started
  withholds nothing. Inference through third-party schedules is out of scope.

## Verification

- Unit tests: `tests/team-season.test.mjs`, `tests/team-season-transport.test.mjs`,
  `tests/team-season-ui.test.mjs`, `tests/game-route.test.mjs`. They use minimized genuine
  captures (`tests/fixtures/team-season-provenance.json`); variations are built in the
  tests and labeled SYNTHETIC.
- Browser: `tests/browser/team-season.spec.mjs`. `/api/team` is intercepted (a simulated
  outage by default), so the local Worker never reads real ESPN.
- `npm run test:runtime` checks that invalid `/api/team` input is rejected before upstream work.
- Fixtures, local curl and workerd are not hosted proof. Real current-season data through
  the Cloudflare preview's `/api/team` is a release gate.

## Optional season leaders (#181, first slice)

The denied ESPN Core method is retired completely. The retained ESPN live feeds,
team schedule and four averages are unchanged. Only a server publisher calls CFBD.
It reads four fixed authenticated Free API resources serially: the configured 2026
FBS identities and national passing/rushing/receiving player-season statistics,
explicitly `seasonType=regular`. Only exact YDS rows are considered. No prior-year
fallback exists. The maximum signed integer yard total wins; malformed rows or
conflicting duplicate athlete records withhold that team's category rather than
promoting an unreliable lower result. Equal maxima use a deterministic athlete-ID
representative; the singular row does not claim a sole leader.

The normalized snapshot contains all returned FBS identities. Public `/api/team`
reads only shared KV for leaders, including cache misses, Retry and unknown IDs.
It joins the requested ESPN canonical ID, school/location and full school/mascot
name exactly. Ambiguous or differing names remain unavailable; no fuzzy name guesses
or assumption that every provider ID is universally equivalent. Active ESPN year
must equal the configured source year. KV failures preserve the base season.

Each snapshot has its own retrieval `checkedAt`, independent of the ESPN season
check. The UI labels leader checks and states that source update time is unknown.
After 12h it says refresh delayed; after 36h rows become unavailable. A newer schedule
check never redates leaders. Spoiler withholding remains unchanged and removes
names, values and check metadata from the DOM whenever aggregates are protected.

Production cron runs at 05:00/17:00 UTC. Preview has a separate namespace and no cron.
The same publisher supports a fixed empty authenticated POST bootstrap. No public
request can refresh the source. A 12h attempt slot is persisted before calls; denied
401/403/429 or HTML responses persist a nonexpiring blocked marker and stop all
future scheduled/admin attempts until operator intervention. Remaining reads stop
on any source error, no redirects/retries/alternate endpoints. Each source response
has an 8MB streaming ceiling and the whole refresh has a 90s abort deadline.
KV is eventually consistent and markers are not atomic locks: this is operational
pacing, not a hard account-wide spending guarantee. Normal operation uses 4 reads
per refresh, 248 in a 31-day month, plus bounded preview/bootstrap use.

`tests/fixtures/season-leaders-provenance.json` records exact source retrieval
metadata, original hashes and minimized fixture hashes. All included fields are
actual source values; synthetic fault/tie/privacy variations are labeled in tests.
The external full-payload native workerd proof exercises the actual captured bulk
responses. Neither local check proves hosted Free CPU/memory acceptance: a real
hosted publisher and real current browser pixels remain release gates. The broader
team/player/game statistics issues, complete provider coverage and native-device
acceptance remain separate outcomes.


## FBS statistical yardage rankings (1.23.0 candidate)

The separate section after ESPN averages shows total, net passing and rushing yards per game for offense and defense allowed. Saturday Signal computes these ranks from CFBD 2026 season aggregates divided by each team's provider-reported games, using the fixed year's 138 FBS membership. It does not claim regular/postseason-only scope, official NCAA ranking, poll standing, adjusted strength, or live data. CFBD definitions and coverage can differ from the adjacent ESPN regular-season averages. Underlying sports-update timing is unknown; checkedAt is retrieval only.

Exact integer cross-products determine competition ranks before display rounding: higher offense/lower allowed is better, equal ratios share rank, and the next rank skips tied places. Each metric needs trustworthy data for every member. Missing/conflicting/malformed member rows withhold that category's national ranks for everyone while preserving valid own values; zero/negative yardage is valid, games must be positive. Incomplete or duplicate membership fails publication. The 2026 expected membership is 138; a source membership change requires explicit review.

`team-rankings:v1:2026` is a distinct snapshot with a pre-call daily attempt slot. The fixed publisher requests only `/teams/fbs?year=2026` and `/stats/season?year=2026&classification=fbs`. Production's existing cron orchestrates leaders then rankings serially. Preview has no automatic cron. Normal production budget is248 leader reads plus62 rank reads per 31-day month, 310 before probes/bootstrap/other consumers. KV pacing remains non-atomic and is not an account quota guarantee. No billing/reset behavior is added.

Both publishers honor `cfbd:v1:blocked` plus the unchanged legacy leaders blocked key. Denials 401/403/429, redirects and HTML/challenges persist shared denial state; no retries, alternate source or marker resets. Leaders additionally preserve their legacy marker. Storage errors prevent dependent scheduled source work. Each of the two sequential rankings source operations has its own 45s abort allowance through response headers and body, with finally cleanup and an 8MB per-response limit. The combined source allowance is up to 90s; KV, validation and other work are separate, so this is not a hard whole-invocation bound. Failed publication retains the last snapshot.

Public `/api/team` reads leaders and ranks concurrently from existing KV within one shared optional 3s allowance bounded by the original root deadline. A hung or invalid optional response cannot hold or mutate the base season; a fast leader read remains usable if ranks time out. No public request, cache miss or Retry calls CFBD. Identity/year/numerators/games/rank/population/freshness are validated; ranks stale after 24h and expire after 72h independently from leaders. The entire new section shares the existing Duke aggregate gate, including inaccessible/control content.

`POST /api/internal/team-rankings-refresh` requires the existing refresh-token secret before storage/source access, an actually empty byte stream within 1s and no query parameters. It changes no leaders slot, source key, alert binding, subscription or preference. The external reviewed operator may configure only CFBD_REFRESH_TOKEN and call this fixed endpoint once per candidate; no force/replay path exists.

Minimal real fixture provenance is recorded in `tests/fixtures/cfbd-team-rankings-provenance.json`; synthetic population/fault tests are labeled. Current full national independent derivation and direct Texas/UNC comparisons are external acceptance evidence. Local fixtures/browser checks do not prove hosted access, production display or native-device behavior. Issues 189/181 stay open for broader player coverage/navigation and other original outcomes; player issue 190 and leaders-browser issue 192 remain distinct.

### Scoring offense and defense (#189, 1.29.0 candidate)

A fourth row, **Scoring (points per game)**, follows the unchanged three yardage rows: offense is points
scored per game (higher ranks first) and defense allowed is points allowed per game (lower ranks first).
The section basis now reads "per-game averages", keeps the yardage line ("Yardage: N games reported by
CFBD") and adds the scoring row's own cue ("Scoring: N completed regular-season games").

- **Source.** The same daily rankings publisher adds one fixed read,
  `/games?year=2026&seasonType=regular&classification=fbs`, after membership and season stats have produced
  a valid yardage generation (`lib/cfbd-scoring-rankings.ts`). No points field exists in the season-stats
  response, so scoring is calculated from completed game scores. There is no per-team or public CFBD query.
- **Rules.** Every row needs a unique positive game ID, season 2026, `seasonType` regular and a boolean
  `completed`. Only `completed === true` counts; upcoming/in-progress null scores never become zero. Completed
  rows need integer scores 0..300 and distinct positive team IDs. A member side joins by numeric ID with an
  exact school-name cross-check and `fbs` classification; an FCS or other non-member opponent counts for its
  FBS side. A duplicate game ID, conflicting identity, unknown FBS ID, malformed relevant row or more than 20
  games stops the whole scoring derivation. A member with no completed game withholds every national scoring
  rank (coverage below 138); values remain. Exact integer cross-products order teams before display
  rounding, with competition ties across different game counts.
- **Snapshot compatibility.** Scoring is an optional sibling `rankings.scoring`
  (`basis: "regular-completed"`, year, own `games`, population, the generation's `checkedAt`, offense and
  defense metrics) inside the unchanged `team-rankings:v1:2026` key. The six yardage metrics, their
  common `games`, factory and parser are unchanged. The 1.28.0 parser (verbatim in
  `tests/fixtures/legacy-ranking-parser-1.28.0.ts.txt`) strips the child and reads identical yardage; the
  new parser reads older snapshots with `scoring: null`, and an invalid child is only null. A serialized
  generation over the reader's 600,000-character bound publishes without scoring.
- **Failure behavior.** A non-denial games failure (HTTP error, transport, abort, size, JSON) or scoring
  validation/size failure still publishes the yardage generation with `scoring: "unavailable"` and a private
  fixed `scoringDiagnostic`/`team_rankings_scoring_unavailable` warning; it never reports scoring refreshed.
  An actual 401/403/429/redirect/challenge on the games read persists `cfbd:v1:blocked`, returns blocked
  (or failed storage if the block cannot be written), keeps the last good snapshot and stops later provider
  work. The games read has its own 45s operation allowance and the 8,000,000-byte limit; `gamesMs` is added
  to private `sourceTiming.totalMs` with the existing field names retained.
- **Budget.** Normal production use is now 248 leader reads plus 93 rank reads per 31-day month (three per
  daily slot instead of two), 341 before probes, preview/bootstrap publication and other consumers (the
  previous figure was 310). This is pacing, not an account quota guarantee. No KV key, cron, attempt slot,
  credential, billing or reset change.
- **Evidence and limits.** Genuine Texas/UNC rows (`tests/fixtures/cfbd-scoring-2026-sample.json` and its
  provenance) reproduce the independently verified November 21 capture: Texas 302/178 over 10 games, UNC
  258/221 over 10 including the FCS game 401858218. National ranks were verified externally from the
  complete capture (all 138 members). CFBD's game coverage and completion flags can change later; a capture
  is not universal coverage, and the underlying sports-update time is unknown. Local tests and intercepted
  browser routes are not hosted proof.

### Controlled failure diagnostics

The authenticated rankings refresh response and private Worker warning share a small
allowlisted diagnostic: operation stage, fixed reason, and observed numeric source
HTTP status when available. They distinguish source reads, snapshot validation and
snapshot storage without publishing source bodies, headers, URLs or exception text.
Public team responses are unchanged. Failed common-block persistence is reported as
storage failure with the observed source denial retained; it never claims the block
was saved. Best-effort cancellation cannot replace or indefinitely delay a detected
denial. This corrects diagnostic behavior, not the still-unknown historical preview
503 cause. The new reviewed maintenance client preserves the original stopped
client/evidence and refuses refresh before the next legitimate UTC daily slot;
time alone does not authorize execution or override a persistent source block.


The reviewed phase-budget maintenance client uses a 105s socket timeout and 110s
outer deadline. Its authenticated-only sourceTiming fields are fixed numeric
requestLimitMs, membershipMs, statsMs and summed totalMs; each elapsed phase is
rounded and clamped to 0–3,600,000ms. These measure the owned source operation,
not provider internal execution or sports freshness. They are absent from public
team/snapshot payloads. Independent phase timers prevent slow membership from
shrinking the stats allowance, but do not establish the historical abort cause
or actual hosted success. The current daily slot remains consumed; no replay,
reset, source-key change or early publisher invocation is permitted.


## Supported regular-season detail (#189, 1.27.0 candidate)

After the retained four averages and before FBS statistical ranks, a compact Season
detail section shows three supported families from the **same already-fetched** ESPN
regular-season statistics response. Interceptions are **Made / Thrown** totals; sacks
are **Made / Allowed** totals. Third-down conversions are **Offense / Defense allowed**,
with a one-decimal conversion percentage and successful conversions of attempted
third downs. Defense allowed means opponents' conversions against the selected team.
They are not per-game averages, new national ranks or all turnovers.

`seasonDetails` requires success and matching team, requested year/type 2 and source
year/type 2. It reads own `defensiveInterceptions.interceptions` / `passing.interceptions`,
own `defensive.sacks` / `passing.sacks`, and own/opponent
`miscellaneous.thirdDownConvs`, `thirdDownAttempts`, `thirdDownConvPct`. Counts are
finite nonnegative integers bounded at 10,000; supplied display values must agree.
Conflicting repeated categories/statistics make affected fields unavailable. Identical
stat repeats may agree. A supplied reciprocal opponent interception/sack must agree;
a missing counterpart does not erase a clearly scoped valid own count. These rules
operate per field so a bad optional row does not discard valid rows or the base season.

Conversion counts must satisfy converted<=attempted. A supplied percentage must be
finite 0..100 and agree with the count-derived rate within 0.02 percentage points, with
its display value consistent with its reported precision. A missing percentage permits
a clearly computed rate from validated counts. Zero attempts keeps 0 of 0 counts but
shows an unavailable percentage; it never fabricates 0%. No game-box summation or
schedule-derived divisor is used.

The v1 wire format adds optional nullable `details`: year, seasonType 2, checkedAt,
interceptionsMade/Thrown, sacksMade/Allowed, and thirdDown.offense/allowed converted/
attempted pairs. The browser validates identity/time and each field/group separately;
old responses and malformed optional detail preserve the existing record, averages,
leaders, ranks and schedule. Missing cells use a spoken Unavailable dash; a wholly
missing block has a compact unavailable state. No extra source request, cache/deadline/
admission change, CFBD publisher call, key, or owner setting is introduced.

Detail checkedAt is recorded only when the same statistics JSON read succeeds, not
on schedule discovery or each cache read. Cached and stale seasons retain that time;
the existing stale banner remains. Source update time is unknown. All new headings,
values, source-check text and accessible markup live under the unchanged
seasonAggregates gate. There is no hidden-value DOM fallback or preference writer.

Genuine November19 Texas/UNC minimized source objects and full original capture
hashes are in `tests/fixtures/espn-team-season-detail-provenance.json`. They verify
Texas interceptions 9/10, sacks 30/30 and third downs 57 of 141 / 51 of 154, and UNC 7/7,
19/26 and 58 of 125 / 65 of 149. These are captured examples, not current hosted proof.
Parser/client/service tests exercise production functions and targeted labeled
SYNTHETIC faults; the compiled Worker regression exercises the actual `/api/team`
route and fixed three-source-read/cache behavior. Browser tests exercise the exact
UI at 320/390 and 200% CSS zoom, partial/zero/unavailable values, navigation/reload,
and hidden/incomplete/opponent DOM/accessibility omissions with test-scoped mute.
Live source/preview/production comparisons, actual pixels and independent exact-
artifact review remain release gates; controlled fixtures do not substitute.

**TURNOVER-01 remains a coverage limitation:** current complete source takeaways/
giveaways and reciprocal opponent totals conflict, and fumblesLost is not reliably
reconciled. This bounded slice includes only separately corroborated interceptions;
it does not label them all turnovers, infer fumbles, select convenient totals,
introduce another collector or close broader #189/#181.

## Defensive leaders (#181, team-first)

**What the section shows.** Directly after the three yard leaders, the current supported
season shows **Total tackles** (CFBD defensive/TOT, with a "N solo" line only for a sole
leader), **Sacks** (defensive/SACKS, half sacks preserved) and **Interceptions** made
(interceptions/INT).
- Every tied leader is listed by full name as an ordinary in-app profile link, with no cap,
  collapse or "+N more".
- Family states are distinct: leaders, every supplied value a known 0 ("No positive total
  supplied"), no rows ("Not supplied") and invalid ("Leader unavailable").
- The section ends with the generation's check time (its acquisition time, not when the
  source was updated) and the cue "Stats: CFBD. Totals may differ from school reports.
  Source update time unknown."

**Source and route.**
- `/api/team-defense?team=<id>&year=<current>` rejects unknown, duplicate, malformed and
  unsupported-year input before any storage or source work.
- It resolves the team from the existing trusted catalog and returns
  `createPlayerSeasonService().teamDefense()`. That reads the **same private
  `pack:<team>:<year>`**, with the same coalescing, 24-hour/30-day TTLs, retained stale
  pack, `admitPlayerReads` budget and attempt keys, and common CFBD denial block.
- There is no other collector, publisher, ledger or alias, and it fetches no identities.
- Profiles stay lazy on actual opens. A cold environment's worst case for VT plus GT is
  2 packs × 3 reads + 11 profiles = 17 calls, against that environment's own 24/day and
  400/31-day ledger. These are not account-balance guarantees.
- `/api/team` and `/api/leaders` stay KV-only and unchanged, and the yard projection and
  national publisher are untouched.

**Projection.** `projectTeamDefense` runs over the original season rows before people are
filtered.
- Negative or zero team rows are skipped.
- A malformed value, invalid ID, conflicting duplicate or name conflict invalidates its
  family instead of promoting a lower row. Identical duplicates collapse.
- New packs carry `defense: 1` plus the projection. A fresh legacy pack returns
  `capability: "pending"`, never a known absence. A stored projection that fails
  validation returns `"unavailable"`.

**Privacy.** The browser validates exact team, year, basis, ties and games. The section
renders only when **both** gates pass:
- the base `seasonAggregates` gate, which also gates the request itself;
- the pack generation's own contribution gate, `teamDefenseGate`. This uses
  `playerGameHidden` semantics over the pack's **raw** schedule. When scoreboard copies
  exist, the same gate must **also** pass with them substituted: a board copy can only add
  protection, never erase a raw hidden decision (for example a source-unknown, possibly
  underway game that the board lists as upcoming). It fails closed on unknown preferences,
  an incomplete or empty schedule and any hidden Duke game, for example Georgia Tech's
  real 401858255.

Protected, loading, pending and failure states render a status line only: no names,
values, tie counts, links or times. A failed revisit keeps the retained, still-gated
values, marks them "Refresh delayed" and offers an ordinary Retry, with no polling and no
forced upstream work. No preference observation or subtraction occurs.

The response validator accepts only the current supported year, matching the query
contract. Historical player routes are unchanged.

**Evidence.** Genuine November 20 rows (`tests/fixtures/team-defense-source.json` plus its
provenance file) verify:
- VT: 59 / 7.5 / three-way 1
- GT: 63 / two-way 3 / three-way 1

The CFBD-reported 7.5 against Virginia Tech's own 8.5 is DQ-181-DEF-01: kept as reported,
with the cause unknown. Fixtures and intercepted browser routes are not hosted proof.
