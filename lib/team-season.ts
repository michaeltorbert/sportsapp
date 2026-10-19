import { z } from "zod";
import type { Game } from "./football";
import { dukeHidden, dukeStarted, type DukePreferences } from "./duke-visibility";

// A team's current football season: overall record, four regular-season per-game pairs and
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
 * Whether the record and averages may be shown. They aggregate every game played, so a protected
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
  // Every listed game must include the team, once, in the section its season type names.
  const ids = new Set<string>();
  for (const [section, type] of [[season.regular, 2], [season.postseason, 3]] as const) for (const entry of entries(section)) {
    const teams = entry.game.teams.map(team => team.id);
    if (entry.seasonType !== type || ids.has(entry.game.id) || !teams.includes(teamId) || !teams.includes(entry.opponent.id) || entry.opponent.id === teamId) return null;
    ids.add(entry.game.id);
  }
  return season;
}
