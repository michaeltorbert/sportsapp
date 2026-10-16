import { z } from "zod";
import type { GameStats, StatsPhase } from "./game-stats";

// Scoring summary for the game screen (issue #149): scores by period and the source's scoring
// plays, read from the same ESPN summary as the stats. Supplied values only: a missing value is
// null (shown as unavailable), never zero, never calculated, and nothing is inferred from text.
export const SCORING_MAX_PERIODS = 20;
export const SCORING_MAX_PLAYS = 256;
export const SCORING_MAX_TEXT = 512;

export type ScoringUnavailable = { unavailable: "missing" | "malformed" | "too-many" | "order" };
type Points = number | null;
// `incomplete`: the two teams' period arrays differ in length, so cells are matched by position only.
// `mismatch`: every period is known but they don't sum to the source's own total.
export type PeriodScores = { away: Points[]; home: Points[]; totals: [Points, Points]; incomplete?: true; mismatch?: true };
// `team` is the away (0) or home (1) index from the event's own teams; null when the source names no team.
export type ScoringPlay = { team: 0 | 1 | null; period: number | null; clock: string | null; type: string | null; text: string | null; away: Points; home: Points };
// `omitted`: supplied items not shown (unknown team, malformed or conflicting duplicate).
// `inconsistent`: the running scores don't agree with the source's total, or go down.
export type ScoringPlays = { items: ScoringPlay[]; omitted?: number; inconsistent?: true };
export type Scoring = { periods: PeriodScores | ScoringUnavailable; plays: ScoringPlays | ScoringUnavailable } | { unavailable: "too-large" };

type Raw = { [key: string]: unknown };
function object(value: unknown): Raw { return value && typeof value === "object" && !Array.isArray(value) ? value as Raw : {}; }
function teamIdOf(value: unknown) { const id = typeof value === "number" && Number.isInteger(value) ? String(value) : value; return typeof id === "string" && /^\d{1,12}$/.test(id) ? id : null; }
// Bounded text: an over-long value is unavailable, never silently shortened.
function text(value: unknown, max: number) { if (typeof value !== "string") return null; const t = value.trim(); return t && t.length <= max ? t : null; }
// Header totals and period cells are digit strings; a supplied "0" stays 0.
function digits(value: unknown): Points { const t = typeof value === "number" && Number.isInteger(value) ? String(value) : typeof value === "string" ? value.trim() : ""; return /^\d{1,3}$/.test(t) ? Number(t) : null; }
function running(value: unknown): Points { return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 999 ? value : null; }
const CLOCK = /^\d{1,2}:[0-5]\d$/;
const seconds = (clock: string) => { const [m, s] = clock.split(":").map(Number); return m * 60 + s; };

export function periodLabel(n: number) { return n <= 4 ? `Q${n}` : n === 5 ? "OT" : `${n - 4}OT`; }
export function periodName(n: number) { return n <= 4 ? `${["1st", "2nd", "3rd", "4th"][n - 1]} quarter` : n === 5 ? "Overtime" : `Overtime ${n - 4}`; }

function periodsOf(competitors: [Raw, Raw], totals: [Points, Points]): PeriodScores | ScoringUnavailable {
  const lines = competitors.map(c => c.linescores);
  if (lines.every(l => l === undefined)) return { unavailable: "missing" };
  if (!lines.every(l => l === undefined || Array.isArray(l))) return { unavailable: "malformed" };
  const [away, home] = lines.map(l => (l ?? []) as unknown[]);
  const count = Math.max(away.length, home.length);
  if (count > SCORING_MAX_PERIODS) return { unavailable: "too-many" };
  // Only supplied periods: an unequal array keeps its known cells and the gap is unavailable, never a future zero.
  const cells = [away, home].map(line => Array.from({ length: count }, (_, i) => i < line.length ? digits(object(line[i]).displayValue) : null));
  const scores: PeriodScores = { away: cells[0], home: cells[1], totals };
  if (away.length !== home.length) scores.incomplete = true;
  if (count > 0 && cells.some((row, i) => totals[i] !== null && !row.includes(null) && row.reduce<number>((sum, v) => sum + v!, 0) !== totals[i])) scores.mismatch = true;
  return scores;
}

function playsOf(value: unknown, teamIds: [string, string], totals: [Points, Points]): ScoringPlays | ScoringUnavailable {
  if (value === undefined) return { unavailable: "missing" };
  if (!Array.isArray(value)) return { unavailable: "malformed" };
  if (value.length > SCORING_MAX_PLAYS) return { unavailable: "too-many" };
  let omitted = 0;
  const kept: { id: string | null; play: ScoringPlay }[] = [];
  for (const raw of value.map(object)) {
    const team = raw.team === undefined ? undefined : teamIdOf(object(raw.team).id);
    // A play is never attributed to the other team: an unreadable or foreign team omits it.
    if (team === null || (team !== undefined && !teamIds.includes(team))) { omitted++; continue; }
    const period = object(raw.period).number, clock = text(object(raw.clock).displayValue, 5);
    kept.push({ id: typeof raw.id === "string" || typeof raw.id === "number" ? String(raw.id) : null, play: {
      team: team === undefined ? null : team === teamIds[0] ? 0 : 1,
      period: typeof period === "number" && Number.isInteger(period) && period >= 1 && period <= SCORING_MAX_PERIODS ? period : null,
      clock: clock && CLOCK.test(clock) ? clock : null,
      type: text(object(raw.type).text, 64), text: text(raw.text, SCORING_MAX_TEXT),
      away: running(raw.awayScore), home: running(raw.homeScore),
    } });
  }
  // A repeated ID is one play; copies that disagree assert nothing.
  const byId = new Map<string, string[]>();
  for (const { id, play } of kept) if (id !== null) byId.set(id, [...(byId.get(id) ?? []), JSON.stringify(play)]);
  const seen = new Set<string>(), items: ScoringPlay[] = [];
  for (const { id, play } of kept) {
    const copies = id === null ? null : byId.get(id)!;
    if (copies && copies.some(c => c !== copies[0])) { omitted++; continue; }
    if (id !== null && seen.has(id)) continue;
    if (id !== null) seen.add(id);
    items.push(play);
  }
  // Source order is kept (equal OT 0:00 clocks included); a known period or clock that runs
  // backwards contradicts it, and no order is invented in its place.
  let lastPeriod: number | null = null, lastClock: number | null = null;
  for (const play of items) {
    if (play.period === null) continue;
    const period: number = play.period, clock: number | null = play.clock === null ? null : seconds(play.clock);
    const same: boolean = lastPeriod !== null && period === lastPeriod;
    if (lastPeriod !== null && period < lastPeriod) return { unavailable: "order" };
    if (same && clock !== null && lastClock !== null && clock > lastClock) return { unavailable: "order" };
    // A new period starts from its own clock; within a period a missing clock keeps the last known one.
    if (!same || clock !== null) lastClock = clock;
    lastPeriod = period;
  }
  const plays: ScoringPlays = { items };
  if (omitted) plays.omitted = omitted;
  // Corrections replace the whole snapshot; a decrease or disagreement is shown with a caveat, never rejected.
  let inconsistent = false;
  const known = items.filter(p => p.away !== null && p.home !== null);
  for (let i = 1; i < known.length; i++) if (known[i].away! < known[i - 1].away! || known[i].home! < known[i - 1].home!) inconsistent = true;
  if (totals[0] !== null && totals[1] !== null) {
    const end = known.at(-1);
    if (end ? end.away !== totals[0] || end.home !== totals[1] : !items.length && (totals[0] > 0 || totals[1] > 0)) inconsistent = true;
  }
  if (inconsistent) plays.inconsistent = true;
  return plays;
}

/**
 * Scoring for a started or final source. Undefined when the source supplies neither period
 * scores nor scoring plays, which reads the same as an older Worker that sends none.
 * `competitors` are the header's away and home entries, already identified by the caller.
 */
export function normalizeScoring(raw: unknown, competitors: [Raw, Raw], teamIds: [string, string]): Scoring | undefined {
  const body = object(raw);
  if (competitors.every(c => c.linescores === undefined) && body.scoringPlays === undefined) return undefined;
  const totals = competitors.map(c => digits(c.score)) as [Points, Points];
  return { periods: periodsOf(competitors, totals), plays: playsOf(body.scoringPlays, teamIds, totals) };
}

/**
 * Display decision for the Scoring section, independent of the Team stats metric family and
 * of Players: valid started scoring shows even when Team stats is empty or season-only.
 * The source phase must still agree with the scoreboard, as for stats.
 */
export type ScoringDisplay = { mode: "catching-up"; reason: "phase" | "season-only" } | { mode: "unavailable"; reason: "missing" | "too-large" } | { mode: "scoring"; scoring: Exclude<Scoring, { unavailable: "too-large" }> };
export function scoringDisplay(stats: GameStats, expected: Exclude<StatsPhase, "pregame">): ScoringDisplay {
  if (stats.sourcePhase !== expected) return { mode: "catching-up", reason: stats.sourcePhase === "pregame" ? "season-only" : "phase" };
  if (!stats.scoring) return { mode: "unavailable", reason: "missing" };
  if ("unavailable" in stats.scoring) return { mode: "unavailable", reason: "too-large" };
  return { mode: "scoring", scoring: stats.scoring };
}

const points = z.number().int().min(0).max(999).nullable();
const unavailable = z.object({ unavailable: z.enum(["missing", "malformed", "too-many", "order"]) }).strict();
const periodsSchema = z.object({
  away: z.array(points).max(SCORING_MAX_PERIODS), home: z.array(points).max(SCORING_MAX_PERIODS), totals: z.tuple([points, points]),
  incomplete: z.literal(true).optional(), mismatch: z.literal(true).optional(),
}).strict().refine(p => p.away.length === p.home.length);
const playSchema = z.object({
  team: z.union([z.literal(0), z.literal(1)]).nullable(), period: z.number().int().min(1).max(SCORING_MAX_PERIODS).nullable(), clock: z.string().regex(CLOCK).nullable(),
  type: z.string().max(64).nullable(), text: z.string().max(SCORING_MAX_TEXT).nullable(), away: points, home: points,
}).strict();
const playsSchema = z.object({ items: z.array(playSchema).max(SCORING_MAX_PLAYS), omitted: z.number().int().min(1).max(SCORING_MAX_PLAYS).optional(), inconsistent: z.literal(true).optional() }).strict();
export const scoringSchema = z.union([
  z.object({ periods: z.union([periodsSchema, unavailable]), plays: z.union([playsSchema, unavailable]) }).strict(),
  z.object({ unavailable: z.literal("too-large") }).strict(),
]);
