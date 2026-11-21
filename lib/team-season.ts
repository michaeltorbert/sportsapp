import { z } from "zod";
import type { Game } from "./football";
import { dukeHidden, dukeStarted, type DukePreferences } from "./duke-visibility";

// A team's current football season: record, three yard leaders, four regular-season per-game pairs and
// the published regular and postseason schedules. Shared by the Worker, which builds it from
// fixed upstream reads (lib/team-season-server.ts), and the browser, which validates it again.
export const TEAM_SEASON_TOTAL_DEADLINE_MS = 10_000;
export const TEAM_SEASON_WORKER_BUDGET_MS = 9_000;
// Schedule-derived scores are not live board scores: they refresh at this slower cadence.
export const TEAM_SEASON_TTL_MS = 300_000;
export const TEAM_SEASON_LIVE_TTL_MS = 60_000;
export const TEAM_SEASON_BACKOFF_MS = [30_000, 60_000, 120_000, 300_000] as const;
export const TEAM_SEASON_MAX_RETRY_AFTER_S = 300;
export const TEAM_SEASON_MAX_GAMES = 30;

// Each pair is [the team's average, its opponents' average], read by category and stat name.
export const TEAM_STAT_ROWS = [
  ["points", "Points", "scoring", "totalPointsPerGame"],
  ["totalYards", "Total yards", "passing", "yardsPerGame"],
  ["passingYards", "Passing yards", "passing", "passingYardsPerGame"],
  ["rushingYards", "Rushing yards", "rushing", "rushingYardsPerGame"],
] as const;
export type TeamStatKey = typeof TEAM_STAT_ROWS[number][0];
export const TEAM_LEADER_ROWS = [
  ["passingYards", "Passing", "passingYards"],
  ["rushingYards", "Rushing", "rushingYards"],
  ["receivingYards", "Receiving", "receivingYards"],
] as const;
export type TeamLeaderKey = typeof TEAM_LEADER_ROWS[number][0];
export type SeasonLeader = { athleteId: string; name: string; yards: number };
export type SeasonLeaders = { year: number; seasonType: 2; checkedAt?: string; stale?: boolean } & Record<TeamLeaderKey, SeasonLeader | null>;
export type ThirdDownConversions = { converted: number; attempted: number };
export type SeasonDetails = {
  year: number; seasonType: 2; checkedAt: string;
  interceptionsMade: number | null; interceptionsThrown: number | null;
  sacksMade: number | null; sacksAllowed: number | null;
  thirdDown: { offense: ThirdDownConversions | null; allowed: ThirdDownConversions | null };
};
const detailCount = z.number().int().min(0).max(10_000);
const conversionSchema = z.object({ converted: detailCount, attempted: detailCount }).refine(row => row.converted <= row.attempted);
/** Optional detail is checked separately, so one bad field cannot discard a usable team season. */
export function parseSeasonDetails(raw: unknown, year: number): SeasonDetails | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const identity = z.object({ year: z.number().int().min(2000).max(2100), seasonType: z.literal(2), checkedAt: z.string().datetime() }).safeParse(value);
  if (!identity.success || identity.data.year !== year) return null;
  const count = (key: string) => { const parsed = detailCount.safeParse(value[key]); return parsed.success ? parsed.data : null; };
  const thirdDown = value.thirdDown && typeof value.thirdDown === "object" && !Array.isArray(value.thirdDown) ? value.thirdDown as Record<string, unknown> : {};
  const conversions = (side: string) => { const parsed = conversionSchema.safeParse(thirdDown[side]); return parsed.success ? parsed.data : null; };
  const details: SeasonDetails = { ...identity.data, interceptionsMade: count("interceptionsMade"), interceptionsThrown: count("interceptionsThrown"), sacksMade: count("sacksMade"), sacksAllowed: count("sacksAllowed"), thirdDown: { offense: conversions("offense"), allowed: conversions("allowed") } };
  return [details.interceptionsMade, details.interceptionsThrown, details.sacksMade, details.sacksAllowed, details.thirdDown.offense, details.thirdDown.allowed].some(value => value !== null) ? details : null;
}
export const RANKING_ROWS = [["totalYards", "Total yards"], ["netPassingYards", "Passing yards (net)"], ["rushingYards", "Rushing yards"]] as const;
export const RANKING_KEYS = ["totalYards", "netPassingYards", "rushingYards", "totalYardsOpponent", "netPassingYardsOpponent", "rushingYardsOpponent"] as const;
export type RankingKey = typeof RANKING_KEYS[number];
export type RankingMetric = { total: number; games: number; rank: number | null; population: number; coverage: number; tied: boolean };
/**
 * #189 scoring: points scored/allowed per game over the team's own CFBD-reported completed 2026
 * regular-season games. Its own denominator, basis and generation time; never one of the six yardage metrics.
 */
export type ScoringRankings = { basis: "regular-completed"; year: number; games: number; population: number; checkedAt: string; offense: RankingMetric; defense: RankingMetric };
export type SeasonRankings = { year: number; games: number | null; population: number; checkedAt: string; stale: boolean; metrics: Record<RankingKey, RankingMetric | null>; scoring?: ScoringRankings | null };
/** Optional data fails closed independently of the retained ESPN season. */
export function parseSeasonRankings(raw: unknown, year: number, now = Date.now()): SeasonRankings | null {
  const metric = z.object({ total: z.number().int().min(-10_000_000).max(10_000_000), games: z.number().int().min(1).max(20), rank: z.number().int().min(1).max(138).nullable(), population: z.literal(138), coverage: z.number().int().min(1).max(138), tied: z.boolean() });
  const parsed = z.object({ year: z.literal(2026), games: z.number().int().min(1).max(20).nullable(), population: z.literal(138), checkedAt: z.string().datetime(), metrics: z.object({ totalYards: metric.nullable(), netPassingYards: metric.nullable(), rushingYards: metric.nullable(), totalYardsOpponent: metric.nullable(), netPassingYardsOpponent: metric.nullable(), rushingYardsOpponent: metric.nullable() }) }).safeParse(raw);
  if (!parsed.success || parsed.data.year !== year) return null;
  const data = parsed.data, age = now - Date.parse(data.checkedAt);
  if (!Number.isFinite(age) || age < 0 || age > 259_200_000) return null;
  for (const row of Object.values(data.metrics)) if (row && (row.games !== data.games || (row.rank !== null && row.coverage !== row.population) || (row.rank === null && (row.coverage === row.population || row.tied)) || (row.tied && row.rank === row.population))) return null;
  // The legacy yardage result above is unchanged; a missing (older snapshot) or invalid scoring child is only null.
  return { ...data, stale: age > 86_400_000, scoring: parseScoringRankings((raw as Record<string, unknown>).scoring, data.checkedAt) };
}
/** Same metric rules as yardage, with its own completed-games denominator, from the same rankings generation only. */
export function parseScoringRankings(raw: unknown, checkedAt: string): ScoringRankings | null {
  const metric = z.object({ total: z.number().int().min(0).max(6_000), games: z.number().int().min(1).max(20), rank: z.number().int().min(1).max(138).nullable(), population: z.literal(138), coverage: z.number().int().min(1).max(138), tied: z.boolean() });
  const parsed = z.object({ basis: z.literal("regular-completed"), year: z.literal(2026), games: z.number().int().min(1).max(20), population: z.literal(138), checkedAt: z.string().datetime(), offense: metric, defense: metric }).safeParse(raw);
  if (!parsed.success || parsed.data.checkedAt !== checkedAt) return null;
  const data = parsed.data;
  for (const row of [data.offense, data.defense]) if (row.games !== data.games || row.coverage !== data.offense.coverage || (row.rank !== null && row.coverage !== row.population) || (row.rank === null && (row.coverage === row.population || row.tied)) || (row.tied && row.rank === row.population)) return null;
  return data;
}
export type StatPair = [string | null, string | null];
// The existing season-metric shape: signed, up to two decimals. Anything else is unavailable, never zero.
export const STAT_FORMAT = /^-?\d{1,5}(?:\.\d{1,2})?$/;
export const RECORD_FORMAT = /^\d{1,2}-\d{1,2}(?:-\d{1,2})?$/;

export type TeamSeasonTeam = { id: string; name: string; shortName: string; abbreviation: string; logo: string | null };
export type ScheduleEntry = { game: Game; opponent: { id: string; name: string }; seasonType: 2 | 3 };
// Complete means every published event was read and validated; an empty list is "none listed".
export type ScheduleSection = { status: "complete"; entries: ScheduleEntry[] } | { status: "unavailable" };
export type TeamSeason = {
  v: 1; team: TeamSeasonTeam; season: { year: number };
  leaders?: SeasonLeaders | null;
  details?: SeasonDetails | null;
  rankings?: SeasonRankings | null;
  record: string | null; stats: Record<TeamStatKey, StatPair> | null;
  regular: ScheduleSection; postseason: ScheduleSection;
  checkedAt: string; stale?: boolean;
};

export function validTeamId(value: unknown): value is string { return typeof value === "string" && /^\d{1,6}$/.test(value); }
export function entries(section: ScheduleSection) { return section.status === "complete" ? section.entries : []; }
export function seasonEntries(season: TeamSeason) { return [...entries(season.regular), ...entries(season.postseason)]; }
export function findScheduleGame(season: TeamSeason | null, id: string) { return season ? seasonEntries(season).find(entry => entry.game.id === id) ?? null : null; }
export function hasLiveGame(season: TeamSeason) { return seasonEntries(season).some(({ game }) => game.state === "live" || (game.state === "delayed" && game.started)); }
export function seasonTtl(season: TeamSeason) {
  // Incomplete answers are retried sooner so a recovered source shows up quickly.
  return hasLiveGame(season) || !season.stats || season.regular.status !== "complete" || season.postseason.status !== "complete" ? TEAM_SEASON_LIVE_TTL_MS : TEAM_SEASON_TTL_MS;
}

/**
 * Whether the record and season statistics may be shown. They aggregate every game played, so a protected
 * Duke game that has started (live or final) withholds them, on any team's page whose schedule
 * contains it. While preferences load, Duke games count as protected, as on the scoreboard. An
 * incomplete schedule cannot show that no protected result is included, so it withholds them too.
 * Uses the existing visibility rules unchanged and records no observation.
 */
export type Aggregates = { shown: true } | { shown: false; reason: "checking" | "hidden" | "incomplete" };
/**
 * The root prefers the scoreboard's copy of a game: it refreshes faster than a team schedule. A board
 * game replaces the schedule's copy only for the same event and the same two teams in the same order.
 */
export function withBoardGames(season: TeamSeason, games: readonly Game[]): TeamSeason {
  const board = new Map(games.map(game => [game.id, game]));
  const fresher = (section: ScheduleSection): ScheduleSection => section.status !== "complete" ? section : { status: "complete", entries: section.entries.map(entry => {
    const game = board.get(entry.game.id);
    return game && game.teams[0].id === entry.game.teams[0].id && game.teams[1].id === entry.game.teams[1].id ? { ...entry, game } : entry;
  }) };
  return { ...season, regular: fresher(season.regular), postseason: fresher(season.postseason) };
}
export function seasonAggregates(season: TeamSeason, prefs: DukePreferences | null): Aggregates {
  if (seasonEntries(season).some(({ game }) => dukeStarted(game) && dukeHidden(game, prefs))) return { shown: false, reason: prefs ? "hidden" : "checking" };
  if (season.regular.status !== "complete" || season.postseason.status !== "complete") return { shown: false, reason: "incomplete" };
  return { shown: true };
}
/**
 * #189 S4: the board-merged season AND the team's own validated schedule must both permit aggregates. A board
 * copy can add protection (a fresher started game) but can never remove the raw schedule's protection (an
 * older or mismatched upcoming copy over a started hidden game). Without a raw season, the merged result stands.
 */
export function protectedAggregates(season: TeamSeason, raw: TeamSeason | null | undefined, prefs: DukePreferences | null): Aggregates {
  const merged = seasonAggregates(season, prefs);
  return !merged.shown || !raw ? merged : seasonAggregates(raw, prefs);
}

// The browser trusts nothing it did not validate: the same shapes the Worker produces, bounded.
const text = (max: number) => z.string().trim().min(1).max(max);
const logo = z.string().max(300).nullable().transform(value => {
  try { const u = new URL(value || ""); return u.protocol === "https:" && u.hostname.endsWith(".espncdn.com") ? u.href : null; } catch { return null; }
});
const teamSchema = z.object({
  id: z.string().regex(/^\d{1,12}$/), name: text(64), abbreviation: z.string().max(16), logo,
  score: z.number().finite().nonnegative().nullable(), rank: z.null(), rankKnown: z.boolean().optional(), record: z.literal(""), conferenceId: z.null(),
});
const gameSchema = z.object({
  id: z.string().regex(/^\d{6,12}$/), date: z.string().max(40).refine(value => Number.isFinite(Date.parse(value))), timeValid: z.boolean(), neutralSite: z.boolean().optional(),
  state: z.enum(["live", "delayed", "upcoming", "final", "other"]), status: text(80), period: z.number().int().min(0).max(20), clock: z.number().finite().min(0).max(3600),
  clockKnown: z.boolean().optional(), intermission: z.boolean().optional(), halftime: z.boolean().optional(), pregameEvidenceInvalid: z.boolean().optional(),
  started: z.boolean(), teams: z.tuple([teamSchema, teamSchema]), broadcast: z.string().max(200), broadcasts: z.array(text(40)).max(8).optional(),
  possession: z.string().max(12).nullable(), downDistance: z.string().max(80), redZone: z.boolean(), url: z.string().max(300),
});
const entrySchema = z.object({ game: gameSchema, opponent: z.object({ id: z.string().regex(/^\d{1,12}$/), name: text(64) }), seasonType: z.union([z.literal(2), z.literal(3)]) });
const sectionSchema = z.union([z.object({ status: z.literal("complete"), entries: z.array(entrySchema).max(TEAM_SEASON_MAX_GAMES) }), z.object({ status: z.literal("unavailable") })]);
const value = z.string().regex(STAT_FORMAT).nullable();
const pair = z.tuple([value, value]);
const leaderSchema = z.object({ athleteId: z.string().regex(/^\d{1,12}$/), name: text(100).refine(name => !/[\u0000-\u001f\u007f]/.test(name)), yards: z.number().int().min(-999_999).max(999_999) });
function parseLeaders(raw: unknown, year: number): SeasonLeaders | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (value.year !== year || value.seasonType !== 2) return null;
  const metadata = z.object({ checkedAt: z.string().datetime(), stale: z.boolean() }).safeParse(value);
  return { year, seasonType: 2, ...(metadata.success ? metadata.data : {}), ...Object.fromEntries(TEAM_LEADER_ROWS.map(([key]) => { const row = leaderSchema.safeParse(value[key]); return [key, row.success ? row.data : null]; })) } as SeasonLeaders;
}
const seasonSchema = z.object({
  v: z.literal(1),
  team: z.object({ id: z.string().regex(/^\d{1,6}$/), name: text(64), shortName: text(48), abbreviation: z.string().max(16), logo }),
  season: z.object({ year: z.number().int().min(2000).max(2100) }),
  record: z.string().regex(RECORD_FORMAT).nullable(),
  stats: z.object({ points: pair, totalYards: pair, passingYards: pair, rushingYards: pair }).nullable(),
  regular: sectionSchema, postseason: sectionSchema,
  checkedAt: z.string().datetime(), stale: z.boolean().optional(),
});

/** Validates a team-season response for the requested team. Anything else is unusable. */
export function parseTeamSeason(body: unknown, teamId: string): TeamSeason | null {
  const parsed = seasonSchema.safeParse(body);
  if (!parsed.success || parsed.data.team.id !== teamId) return null;
  const season = parsed.data as unknown as TeamSeason;
  season.rankings = parseSeasonRankings((body as Record<string, unknown>).rankings, season.season.year);
  season.leaders = parseLeaders((body as Record<string, unknown>).leaders, season.season.year);
  season.details = parseSeasonDetails((body as Record<string, unknown>).details, season.season.year);
  // Every listed game must include the team, once, in the section its season type names.
  const ids = new Set<string>();
  for (const [section, type] of [[season.regular, 2], [season.postseason, 3]] as const) for (const entry of entries(section)) {
    const teams = entry.game.teams.map(team => team.id);
    if (entry.seasonType !== type || ids.has(entry.game.id) || !teams.includes(teamId) || !teams.includes(entry.opponent.id) || entry.opponent.id === teamId) return null;
    ids.add(entry.game.id);
  }
  return season;
}
