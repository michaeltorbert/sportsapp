# Team seasons (#166)

A team page shows one team's **current** football season: its overall record, four
regular-season per-game averages for the team and its opponents, and the published
regular-season and postseason schedules. Every schedule game opens the existing game
screen in the app. There is no archive, year selector, player season, standings or
rankings view.

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

## Duke spoiler settings

The existing preferences and `dukeHidden`/`dukeStarted` are reused unchanged, and season
games are never passed to the Duke observation writer.

- A schedule game that is also on the scoreboard uses the scoreboard's copy (same event, same
  teams), so the fresher state decides (`withBoardGames`).
- A schedule copy can trail a kickoff by minutes. So a Duke game still listed as upcoming
  after its scheduled start is judged as if under way: hidden whenever the existing rule
  would hide it in play (`scheduleGameHidden`, using `dukeHidden` unchanged). Until the
  page's clock is read, every upcoming Duke game is judged that way.
- A Duke game hidden by the settings shows only its date on any team's schedule: no
  opponent, status, score, result or link. Its game screen is the generic unavailable one.
- The record and averages are withheld on any team's page whose schedule contains a hidden
  Duke game that has started (`dukeStarted`, so a live 0–0 period-0 game counts). They are
  also withheld while preferences load and while any schedule section is unavailable,
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
