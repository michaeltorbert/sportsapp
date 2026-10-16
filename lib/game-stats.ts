import { z } from "zod";
import type { Game } from "./football";
import { normalizeScoring, scoringSchema, type Scoring } from "./game-scoring";

// Enable gate for started-game stats. Enabled on a genuine IN_PROGRESS capture
// plus an actual browser → local workerd → real ESPN probe; see docs/game-stats.md.
// When off, started games make no stats request and show a static message.
export const LIVE_STATS_ENABLED = true;
// Optional anonymous direct-ESPN fallback, off until browser CORS and the
// remaining-deadline behavior are verified.
export const DIRECT_STATS_FALLBACK = false;

export const STATS_TOTAL_DEADLINE_MS = 8000;
export const STATS_WORKER_BUDGET_MS = 5000;
export const STATS_UPSTREAM_TIMEOUT_MS = 4000;
export const STATS_SNAPSHOT_LIMIT = 20;
export const STATS_MAX_BYTES = 64 * 1024;
export const STATS_MAX_ROWS = 256;
export const STATS_MAX_ACTIVE = 2;
export const STATS_STARTED_TTL_MS = 15_000;
export const STATS_SETTLED_TTL_MS = 300_000;
export const STATS_POLL_MS = 30_000;
export const STATS_BACKOFF_MS = [60_000, 120_000, 300_000] as const;
export const STATS_MAX_RETRY_AFTER_S = 300;

export type StatsPhase = "pregame" | "started" | "final";
export type SourcePhase = StatsPhase | "other";
export type Unavailable = { unavailable: "missing" | "malformed" | "identity" | "mixed" | "too-many" | "too-large" };
export type Pair = [string | null, string | null];

export const GAME_CORE = [
  ["totalYards", "Total yards"], ["netPassingYards", "Passing yards"], ["rushingYards", "Rushing yards"], ["firstDowns", "First downs"],
  ["thirdDownEff", "Third-down conversions"], ["turnovers", "Turnovers"], ["totalPenaltiesYards", "Penalties / yards"], ["possessionTime", "Time of possession"],
] as const;
export const GAME_DETAILS = [
  ["fourthDownEff", "Fourth-down conversions"], ["completionAttempts", "Completions / attempts"], ["yardsPerPass", "Yards per pass"], ["rushingAttempts", "Rush attempts"],
  ["yardsPerRushAttempt", "Yards per rush"], ["interceptions", "Interceptions thrown"], ["fumblesLost", "Fumbles lost"],
] as const;
// ESPN's raw labels ("Total Yards", "Yards Allowed") omit the rate; these do not.
export const SEASON_ROWS = [
  ["totalPointsPerGame", "Points scored"], ["totalPointsPerGameAllowed", "Points allowed"], ["yardsPerGame", "Total yards gained"], ["yardsPerGameAllowed", "Total yards allowed"],
  ["passingYardsPerGame", "Passing yards gained"], ["passingYardsPerGameAllowed", "Passing yards allowed"], ["rushingYardsPerGame", "Rushing yards gained"], ["rushingYardsPerGameAllowed", "Rushing yards allowed"],
] as const;
const count = /^-?\d{1,5}$/, decimal = /^-?\d{1,5}(?:\.\d{1,2})?$/, made = /^\d{1,3}-\d{1,3}$/, ratio = /^\d{1,3}\/\d{1,3}$/;
// Every allowlisted metric validates its displayValue shape. Anything else is unavailable, never zero.
const GAME_FORMATS: Record<string, RegExp> = {
  totalYards: count, netPassingYards: count, rushingYards: count, firstDowns: count, turnovers: count, rushingAttempts: count, interceptions: count, fumblesLost: count,
  thirdDownEff: made, fourthDownEff: made, totalPenaltiesYards: made, completionAttempts: ratio, yardsPerPass: decimal, yardsPerRushAttempt: decimal, possessionTime: /^\d{1,2}:\d{2}$/,
};
const SEASON_FORMATS: Record<string, RegExp> = Object.fromEntries(SEASON_ROWS.map(([name]) => [name, decimal]));

export type PlayerCategory = "passing" | "rushing" | "receiving";
type Column = { key: string; label: string; format: RegExp };
const PLAYER_COLUMNS: Record<PlayerCategory, Column[]> = {
  passing: [{ key: "completions/passingAttempts", label: "C/ATT", format: ratio }, { key: "passingYards", label: "YDS", format: count }, { key: "passingTouchdowns", label: "TD", format: count }, { key: "interceptions", label: "INT", format: count }],
  rushing: [{ key: "rushingAttempts", label: "CAR", format: count }, { key: "rushingYards", label: "YDS", format: count }, { key: "rushingTouchdowns", label: "TD", format: count }],
  receiving: [{ key: "receptions", label: "REC", format: count }, { key: "receivingYards", label: "YDS", format: count }, { key: "receivingTouchdowns", label: "TD", format: count }],
};
export const PLAYER_CATEGORIES: PlayerCategory[] = ["passing", "rushing", "receiving"];
export const playerColumns = (category: PlayerCategory) => PLAYER_COLUMNS[category].map(column => column.label);
// The only observed key/label discrepancy: live passing omits the trailing QBR label and value.
const OPTIONAL_TRAILING_KEY: Partial<Record<PlayerCategory, string>> = { passing: "adjQBR" };

export type PlayerRow = { athleteId: string; name: string | null; values: Record<string, string | null> };
export type CategoryRows = { rows: PlayerRow[]; unaligned?: true } | Unavailable;
export type PlayerTeam = { teamId: string; categories: Record<PlayerCategory, CategoryRows> } | (Unavailable & { teamId: string });
export type TeamSection = { kind: "game" | "season"; rows: Record<string, Pair> } | Unavailable;
export type PlayersSection = { teams: [PlayerTeam, PlayerTeam] } | Unavailable;
export type GameStats = {
  v: 1; eventId: string; teamIds: [string, string]; sourceDate: string | null; sourcePhase: SourcePhase;
  sourceStatus: { state: string; name: string; detail: string | null; period: number | null; displayClock: string | null };
  checkedAt: string; team: TeamSection; players: PlayersSection;
  // Sent only to clients that ask for it (`scoring=1`); absent means unavailable.
  scoring?: Scoring;
};

export class StatsSourceError extends Error {}

type Raw = { [key: string]: unknown };
function object(value: unknown): Raw { return value && typeof value === "object" && !Array.isArray(value) ? value as Raw : {}; }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
export function validEventId(value: unknown): value is string { return typeof value === "string" && /^\d{6,12}$/.test(value); }
function teamIdOf(value: unknown) { const id = typeof value === "number" && Number.isInteger(value) ? String(value) : value; return typeof id === "string" && /^\d{1,12}$/.test(id) ? id : null; }
function athleteIdOf(value: unknown) { const id = typeof value === "number" && Number.isInteger(value) ? String(value) : value; return typeof id === "string" && /^-?\d{1,12}$/.test(id) ? id : null; }
// Bounded text: an over-long value is unavailable, never silently shortened.
function text(value: unknown, max = 64) { if (typeof value !== "string") return null; const t = value.trim(); return t && t.length <= max ? t : null; }
function formatted(value: unknown, format: RegExp) { const t = text(value, 16); return t !== null && format.test(t) ? t : null; }

export function sourcePhaseOf(state: string, name: string, completed: boolean): SourcePhase | null {
  if (/CANCELED|CANCELLED|POSTPONED|NO_CONTEST|FORFEIT/.test(name)) return "other";
  if (completed || state === "post") return "final";
  if (state === "in") return "started";
  if (state === "pre") return "pregame";
  return null;
}

/** Scoreboard-derived expected phase. `null` means status-first: no stats request. */
export function expectedPhase(game: Pick<Game, "state" | "started">): StatsPhase | null {
  if (game.state === "other") return null;
  if (game.state === "final") return "final";
  if (game.state === "live" || (game.state === "delayed" && game.started)) return "started";
  return "pregame";
}
export function statsTtl(phase: SourcePhase) { return phase === "started" ? STATS_STARTED_TTL_MS : STATS_SETTLED_TTL_MS; }

function teamSection(raw: unknown, away: string, home: string): TeamSection {
  const entries = array(raw);
  if (!entries.length) return { unavailable: "missing" };
  const byTeam = new Map<string, Raw>();
  for (const entry of entries.map(object)) {
    const id = teamIdOf(object(entry.team).id), side = entry.homeAway;
    // A team without a trustworthy identity invalidates the section; it is never attached to the other team.
    if (!id || (id !== away && id !== home) || byTeam.has(id)) return { unavailable: "identity" };
    if (side !== undefined && side !== (id === away ? "away" : "home")) return { unavailable: "identity" };
    byTeam.set(id, entry);
  }
  let family: "game" | "season" | null = null;
  const values: Record<string, Pair> = {};
  for (const [index, id] of [away, home].entries()) {
    const entry = byTeam.get(id);
    if (!entry) continue;
    const seen = new Map<string, number>();
    for (const stat of array(entry.statistics).map(object)) {
      if (typeof stat.name !== "string") continue;
      // Own-key membership only: inherited names such as "constructor" are unknown fields.
      const kind = Object.hasOwn(GAME_FORMATS, stat.name) ? "game" : Object.hasOwn(SEASON_FORMATS, stat.name) ? "season" : null;
      if (!kind) continue; // Allowlist: unrecognized provider fields never become visible.
      if (family && family !== kind) return { unavailable: "mixed" };
      family = kind;
      seen.set(stat.name, (seen.get(stat.name) || 0) + 1);
      values[stat.name] ??= [null, null];
      values[stat.name][index] = formatted(stat.displayValue, (kind === "game" ? GAME_FORMATS : SEASON_FORMATS)[stat.name]);
    }
    // A duplicated metric is ambiguous for that team.
    for (const [name, times] of seen) if (times > 1) values[name][index] = null;
  }
  if (!family) return { unavailable: "missing" };
  const rows = family === "game" ? [...GAME_CORE, ...GAME_DETAILS] : SEASON_ROWS;
  const out: Record<string, Pair> = {};
  for (const [name] of rows) out[name] = values[name] ? [values[name][0], values[name][1]] : [null, null];
  if (Object.values(out).every(pair => pair[0] === null && pair[1] === null)) return { unavailable: "missing" };
  return { kind: family, rows: out };
}

// Column alignment is checked once per category. When it cannot be confirmed,
// identifiable participants stay listed with unavailable values; nothing shifts.
function alignedIndexes(raw: Raw, category: PlayerCategory): number[] | null {
  const keys = array(raw.keys), labels = array(raw.labels), descriptions = raw.descriptions;
  if (!keys.every(k => typeof k === "string") || new Set(keys).size !== keys.length || !labels.every(l => typeof l === "string")) return null;
  const trailing = OPTIONAL_TRAILING_KEY[category];
  if (!(keys.length === labels.length || (trailing && keys.length === labels.length + 1 && keys.at(-1) === trailing))) return null;
  if (descriptions !== undefined && (!Array.isArray(descriptions) || descriptions.length !== labels.length)) return null;
  const indexes: number[] = [];
  for (const column of PLAYER_COLUMNS[category]) {
    const index = keys.indexOf(column.key);
    // Each required value must have both its key and its confirming label at the same position.
    if (index < 0 || index >= labels.length || labels[index] !== column.label) return null;
    indexes.push(index);
  }
  return indexes;
}
function categoryRows(raw: Raw, category: PlayerCategory): CategoryRows {
  const athletes = array(raw.athletes), labels = array(raw.labels), indexes = alignedIndexes(raw, category);
  if (athletes.length > STATS_MAX_ROWS) return { unavailable: "too-many" };
  const rows: PlayerRow[] = [];
  for (const item of athletes.map(object)) {
    const athlete = object(item.athlete), athleteId = athleteIdOf(athlete.id);
    // An unidentifiable row would make the list silently partial.
    if (!athleteId) return { unavailable: "malformed" };
    const stats = array(item.stats), aligned = indexes !== null && stats.length === labels.length;
    const values: Record<string, string | null> = {};
    PLAYER_COLUMNS[category].forEach((column, i) => { values[column.label] = aligned ? formatted(stats[indexes[i]], column.format) : null; });
    rows.push({ athleteId, name: text(athlete.displayName), values });
  }
  return indexes ? { rows } : { rows, unaligned: true };
}

function playersSection(raw: unknown, away: string, home: string): PlayersSection {
  const entries = array(raw);
  if (!entries.length) return { unavailable: "missing" };
  const byTeam = new Map<string, Raw>();
  for (const entry of entries.map(object)) {
    const id = teamIdOf(object(entry.team).id);
    if (!id || (id !== away && id !== home) || byTeam.has(id)) return { unavailable: "identity" };
    byTeam.set(id, entry);
  }
  const teams = [away, home].map((teamId): PlayerTeam => {
    const entry = byTeam.get(teamId);
    if (!entry) return { teamId, unavailable: "missing" };
    const groups = new Map<string, Raw[]>();
    for (const stat of array(entry.statistics).map(object)) if (typeof stat.name === "string") groups.set(stat.name, [...(groups.get(stat.name) || []), stat]);
    const categories = Object.fromEntries(PLAYER_CATEGORIES.map(category => {
      const found = groups.get(category);
      return [category, !found ? { unavailable: "missing" } : found.length > 1 ? { unavailable: "malformed" } : categoryRows(found[0], category)];
    })) as Record<PlayerCategory, CategoryRows>;
    return { teamId, categories };
  }) as [PlayerTeam, PlayerTeam];
  return { teams };
}

export function snapshotBytes(stats: GameStats) { return new TextEncoder().encode(JSON.stringify(stats)).length; }

/**
 * Pure normalizer for ESPN's public summary. Builds the public contract field
 * by field from header and boxscore only; betting, predictor, news and media
 * fields are never read. Throws when the event identity is not trustworthy.
 */
export function normalizeGameStats(raw: unknown, eventId: string, checkedAt: string): GameStats {
  const body = object(raw), header = object(body.header), competition = object(array(header.competitions)[0]);
  if (!validEventId(eventId) || header.id !== eventId) throw new StatsSourceError("Summary event does not match");
  const competitors = array(competition.competitors).map(object);
  const side = (homeAway: string) => competitors.filter(c => c.homeAway === homeAway);
  const awayEntries = side("away"), homeEntries = side("home");
  const away = teamIdOf(object(awayEntries[0]?.team).id), home = teamIdOf(object(homeEntries[0]?.team).id);
  if (competitors.length !== 2 || awayEntries.length !== 1 || homeEntries.length !== 1 || !away || !home || away === home) throw new StatsSourceError("Summary teams are not identifiable");
  const status = object(competition.status), type = object(status.type);
  const name = text(type.name) || "", state = text(type.state, 16) || "";
  const sourcePhase = sourcePhaseOf(state, name, type.completed === true);
  if (!sourcePhase) throw new StatsSourceError("Summary status is not readable");
  const date = typeof competition.date === "string" ? competition.date : header.date;
  const period = typeof status.period === "number" && Number.isInteger(status.period) && status.period >= 0 && status.period <= 20 ? status.period : null;
  const clock = typeof status.displayClock === "string" && /^\d{1,2}:\d{2}$/.test(status.displayClock) ? status.displayClock : null;
  const box = object(body.boxscore);
  const stats: GameStats = {
    v: 1, eventId, teamIds: [away, home],
    sourceDate: typeof date === "string" && Number.isFinite(Date.parse(date)) && date.length <= 40 ? date : null,
    sourcePhase, sourceStatus: { state, name, detail: text(type.shortDetail) || text(type.detail), period, displayClock: clock },
    checkedAt, team: teamSection(box.teams, away, home), players: playersSection(box.players, away, home),
  };
  // Valid team data survives an oversized Players section, which is omitted whole.
  if (snapshotBytes(stats) > STATS_MAX_BYTES) stats.players = { unavailable: "too-large" };
  if (snapshotBytes(stats) > STATS_MAX_BYTES) throw new StatsSourceError("Summary snapshot is too large");
  // Scoring is additive: Team and Players are decided above exactly as before, and scoring
  // only uses what remains of the same bound. It is never what pushes Players out.
  if (sourcePhase === "started" || sourcePhase === "final") {
    const scoring = normalizeScoring(body, [awayEntries[0], homeEntries[0]], [away, home]);
    if (scoring) for (const candidate of [scoring, { unavailable: "too-large" } as const]) {
      if (snapshotBytes({ ...stats, scoring: candidate }) <= STATS_MAX_BYTES) { stats.scoring = candidate; break; }
    }
  }
  return stats;
}

// Public contract validator for Worker (or fallback) responses. Unknown keys are rejected.
const cell = z.string().max(64).nullable();
const unavailable = z.object({ unavailable: z.enum(["missing", "malformed", "identity", "mixed", "too-many", "too-large"]) }).strict();
const categorySchema = z.union([z.object({ rows: z.array(z.object({ athleteId: z.string().regex(/^-?\d{1,12}$/), name: cell, values: z.record(z.string().max(8), cell) }).strict()).max(STATS_MAX_ROWS), unaligned: z.literal(true).optional() }).strict(), unavailable]);
const playerTeamSchema = z.union([
  z.object({ teamId: z.string(), categories: z.object({ passing: categorySchema, rushing: categorySchema, receiving: categorySchema }).strict() }).strict(),
  unavailable.extend({ teamId: z.string() }).strict(),
]);
const statsSchema = z.object({
  v: z.literal(1), eventId: z.string().regex(/^\d{6,12}$/), teamIds: z.tuple([z.string().regex(/^\d{1,12}$/), z.string().regex(/^\d{1,12}$/)]),
  sourceDate: z.string().max(40).nullable(), sourcePhase: z.enum(["pregame", "started", "final", "other"]),
  sourceStatus: z.object({ state: z.string().max(16), name: z.string().max(64), detail: cell, period: z.number().int().min(0).max(20).nullable(), displayClock: z.string().max(5).nullable() }).strict(),
  checkedAt: z.string().max(40).refine(value => Number.isFinite(Date.parse(value))),
  team: z.union([z.object({ kind: z.enum(["game", "season"]), rows: z.record(z.string().max(32), z.tuple([cell, cell])) }).strict(), unavailable]),
  players: z.union([z.object({ teams: z.tuple([playerTeamSchema, playerTeamSchema]) }).strict(), unavailable]),
  // Optional: a Worker from before scoring sends none, and that response stays valid.
  scoring: scoringSchema.optional(),
}).strict();
/** The response for a client that did not ask for scoring: the released v1 body, unchanged. */
export function withoutScoring(stats: GameStats): GameStats {
  if (!("scoring" in stats)) return stats;
  const base = { ...stats };
  delete base.scoring;
  return base;
}
export function parseGameStats(value: unknown): GameStats | null {
  const parsed = statsSchema.safeParse(value);
  return parsed.success ? parsed.data as GameStats : null;
}

/** Display decision. Source phase and metric family must agree with the scoreboard. */
export type StatsDisplay = { mode: "stats"; kind: "game" | "season" } | { mode: "catching-up"; reason: "phase" | "season-only" } | { mode: "players-only" } | { mode: "empty" };
export function statsDisplay(stats: GameStats, expected: StatsPhase): StatsDisplay {
  if (stats.sourcePhase !== expected) return { mode: "catching-up", reason: expected !== "pregame" && stats.sourcePhase === "pregame" ? "season-only" : "phase" };
  const team = stats.team;
  // Season averages are never relabeled as game totals, and vice versa.
  if ("kind" in team) {
    if (expected === "pregame" && team.kind !== "season") return { mode: "catching-up", reason: "phase" };
    if (expected !== "pregame" && team.kind !== "game") return { mode: "catching-up", reason: "season-only" };
    return { mode: "stats", kind: team.kind };
  }
  return expected !== "pregame" && hasPlayers(stats) ? { mode: "players-only" } : { mode: "empty" };
}
export function hasPlayers(stats: GameStats) {
  return "teams" in stats.players && stats.players.teams.some(t => "categories" in t && PLAYER_CATEGORIES.some(c => "rows" in t.categories[c] && t.categories[c].rows.length > 0));
}
