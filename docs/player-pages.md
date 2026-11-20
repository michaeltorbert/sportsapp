# Player pages

Player pages connect positive individual passing/rushing/receiving rows and team season leaders to explicit regular-season totals and the full selected-team schedule/game log. Team-attributed negative IDs remain text. Missing athlete rows say “No player statistics supplied.” Missing game boxes remain separate; neither means zero or DNP. Supplied-game coverage is not an appearances claim. Category headings and full metric labels identify counts, yards, percentages and rates; QBR and unrelated categories are not promised.

## Identity and routes

`/?player=<id>&playerTeam=<entry-team-id>&anchorSeason=<entry-year>&season=<selected-year>` is the reusable profile contract for future #192. The immutable entry anchor survives year changes; it is not the historical selected team's ID. No missing anchor year is repaired using the current year or kickoff date. `stintTeam` is an optional exact canonical source team name, only a selector after exact-player metadata validation. Multiple listed teams require an explicit choice; no combined/first/current-team default. Source-listed years are choices, not a promise that every year is populated. Selected-year absence never substitutes anchor/current statistics.

For an FCS/noncatalog opponent, `witnessTeam=<trusted-FBS-id>&witnessEvent=<owned-game-id>` at anchorSeason reconstructs canonical identity from the trusted team's exact source schedule and box side/player join before admitting the anchor. Boxes lack team IDs: exact game, name/homeAway/points joins assign schedule IDs. Full schedules retain legitimate lower-division opponents, including classification ii. This is bounded canonical demand, not a universal crawler or coverage promise.

A player-origin game has `event`, `fromPlayer`, `playerTeam`, `anchorSeason`, `playerSeason` (displayed year), optional stint/witness selectors and ordinary `section`. Profile `player/season` and current-team `team` are absent. Exact selected pack/schedule membership drives GameScreen, including direct/reload/new-tab. Owned Back restores player/year/scroll/row; direct game Back returns to the canonical profile. Unrelated URLs strip context; section and update URLs preserve it. History/session records contain IDs and UI state, never player statistics.

Game box links require an authoritative summary `header.season.year` or already validated player-origin selected year. No kickoff-calendar guess. `sourceSeason` is an optional opt-in API field: new stats clients request `playerContext=1`; default/0 bodies omit it, including scoring=1, preserving deployed strict v1.23 parsers. Missing/malformed source season preserves existing statistics but leaves unanchored player names as text. Tests pin the exact b72 old parser, not a reconstruction.

## Source and free operation

The new public player API can fill admitted server-side shared team/year/explicit-regular bundles (three fixed CFBD reads: season-player rows, games, bulk game-player boxes) and exact source-derived identity metadata (one fixed name search, exact ID selection). Existing public team/leaders/rankings behavior, publishers and cron are unchanged. No provider key reaches the client, request parameters, logs or public errors. Minimal selected-player normalized data reaches the browser, not unrelated raw team boxes. Neither overview totals nor summed retained games certify season totals.

Uses existing SEASON_LEADERS_KV and CFBD_API_KEY bindings. Current bundles cache at least24h; historical bundles and identities30days. Retained last-good current packs may be used up to30days, historical up to365days, labeled delayed. Persistent per-resource attempt markers prevent cache eviction/Retry from forcing repeat reads in the admitted interval. Failed/partial attempts reserve full cost. Same-isolate pack/identity calls coalesce. The durable source block is shared with leaders/ranks; denial/challenge/redirect stops reads without retry. Storage uncertainty prevents source access.

Operational admission reserves24calls/day and400/rolling31days before source. Daily buckets retain the partial oldest day conservatively (up to32calendar buckets), so the rolling interval is never shortened by a midnight boundary. KV counters are non-atomic across isolates: these are best-effort pacing limits, not account-wide guarantees, provider balances or billing cutoffs. Shared ledger writes are serialized and spaced over one second in-isolate because Workers KV limits writes to the same key. Cross-isolate races remain a limitation, never permission to bypass a storage denial. No D1, queue, billing, provider reset, source key rotation or alert change is introduced. Existing estimated310calls plus400 is710; preview/diagnostics/cbb/other consumers share the same free account and remaining balance is unknown.

Requests use fixed HTTPS endpoints, manual redirects, bounded source transport/rows/response shape and per-read15s deadlines. No arbitrary source URL or public name-search proxy exists. Cold history may require the anchor bundle+identity+selected bundle; cold FCS adds one witness pack. Valid unknown player IDs may consume an admitted canonical pack to prove absence, whereas malformed inputs are rejected before source. Identity/stint records are evidence, not arbitrary browser authority.

## Spoiler and acceptance boundaries

Existing Duke rules gate full season aggregates, rows, opponent/game links and direct historical games before rendering GameScreen or starting its stats load. Hidden rows contain only date/notice. Unknown preferences and genuinely protected unknown source states fail closed. Only the normalized CFBD unknown marker (other / Game state unavailable) is evaluated through existing Duke timeline/waiting/venue rules as possibly underway for protection only; the source is never relabeled live. Safe known-home/neutral/Always-show/manual-show cases remain visible, while eligible unknown away cases stay protected. Authoritative board cancellation/postponement/no-contest/forfeit states retain their existing ORD020 visibility rather than being relabeled. Completed true establishes final; incomplete alone never establishes pregame/live. Authoritative matching board data may refine state. Historical/team data never writes preference observations, and hidden-game subtraction is not used. This preserves the existing client-side preference architecture, not per-user server transport redaction.

Minimized real fixtures cover current QB/rusher/receiver, multiple old Texas years, Wisconsin transfer and ETSU/FCS with negative rushing and a classification ii game. Synthetic overlapping/inactive metadata and source failures are labeled. Browser tests default-intercept the player API before server egress and verify test-scoped media mute; no Mac volume or production sound preference is changed. Fixture success does not prove current provider, hosted CPU/memory, real navigation, phone pixels, native behavior or release. Root acceptance must verify actual preview/production identities/totals/logs/history, exact source/commit/version, old/new client compatibility, required checks, fresh independent review, preserved alerts and actual320/390/large-text pixels. No unavailable state counts as delivery of a requested statistic.

## Supplemental current leader availability

When the original season-leader reader is wholly unavailable, the team API may read a fresh eligible current player pack from KV. Every valid original result wins unchanged, including partial categories. The new reader performs no source fetch, admission, KV write, publisher trigger or timestamp renewal. A naturally admitted current player visit can populate that pack; a team-first cold visit with neither usable snapshot nor eligible pack still shows unavailable. This does not restore all138teams or diagnose the unknown publisher/cron freshness cause.

Current pack normalization derives a versioned leader projection from original season-player rows **before** invalid IDs/fields are filtered from people. Malformed possible maxima invalidate their category; identical/conflicting duplicates, signed integer yards and deterministic ties follow the legacy selector. Box-only participants and game sums cannot become season leaders. Old packs lacking raw-row eligibility remain ineligible until normal refresh; no forced conversion or deletion occurs.

Fallback requires exact2026/regular/team ID and pack/projection timestamp agreement, a complete usable pack schedule, bounded shape and the existing catalog's school/mascot/full-name correlation. Expired catalog statistics are not used as values; finite retained identity metadata can still corroborate the team. Actual pack data expires after36h and is labeled delayed after12h, independently of player cache retention. Existing Duke aggregate and client gates remain unchanged. Storage/shape/deadline failures return null. Preview and production must prove ordinary real player fill followed by named team leaders and working team→player navigation; test fixtures are not that proof.

## Defensive statistics (#181)

**Fields.** Profiles and game logs add CFBD `defensive` and `interceptions` categories, with only these supplied fields:
- Defense: TOT (Total tackles), SOLO (Solo tackles), TFL (Tackles for loss), SACKS (Sacks).
- Interceptions: INT (Interceptions made), YDS (Interception return yards), TD (Interception return touchdowns).

**Validation.**
- Counts must be nonnegative integers.
- Sacks and TFL keep the source's half units (`"1.0"` becomes 1, `"7.5"` stays 7.5). Any other value is unavailable, never rounded.
- Return yards follow the existing signed-integer yard rule.
- Conflicting duplicates are unavailable.

**Not shown:**
- CFBD `PD`. It equals schools' breakups (BU), not passes defended. The existing ESPN game-box PD is unchanged.
- QB HUR, defensive TD (meaning unclear), derived assisted tackles, games played and interception AVG.
- Passing INT stays "thrown". A missing interceptions row is not zero.
- No season total is summed from boxes.

**Source cue.** The profile shows "Stats: CFBD. Totals may differ from school reports. Source update time unknown." directly under the season totals, before the game log, whenever defensive or interception totals appear.

**Capability marker.** Packs built by this version carry `defense: 1` and include defense-only people. A fresh legacy v1 pack lacks the marker. It keeps its offense, and the profile shows its seasons as `defense: "pending"`. A miss in such a pack returns 503 `defense-pending`, never a false 404 `player-not-supplied`. Normal TTL and admission refresh it; there is no forced refresh, alias, deletion or re-dating.

**Malformed optional data.** An invalid defensive or interceptions category (in totals or any log), or an unknown marker, is quarantined on its own. It is dropped and the season is marked `defense: "unavailable"` ("Some defensive statistics couldn’t be loaded."). It is never shown, and never treated as zero or absence. Valid offense, identity, year, history and logs survive, and prior categories keep their original strict contract. Identical repeated defensive or interception rows collapse, matching the team projection, while conflicting repeats are unavailable. Offense repeat semantics are unchanged.

**Old clients.** The exact released 1.27 parser (`tests/fixtures/player-season-127.ts.txt`) strips the additive categories and marker. A defense-only player opened by an old client shows no category, which is a known, harmless limitation.

**Known source variation (DQ-181-DEF-01).** Values are kept exactly as CFBD reports them. For example, Aycen Stevens has 7.5 sacks against 8.5 in Virginia Tech's own table. Equal game coverage cannot distinguish lag, revision or credit differences, so the cause is unknown. There are no manual overrides.
