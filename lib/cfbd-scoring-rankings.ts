import type { RankingMetric, ScoringRankings } from "./team-season";

// #189 national scoring offense/defense. One fixed public regular-season games read, joined to the same
// validated FBS membership generation as the yardage ranks. No per-team or caller-controlled provider query.
export const SCORING_YEAR = 2026;
export const SCORING_GAMES_URL = `https://api.collegefootballdata.com/games?year=${SCORING_YEAR}&seasonType=regular&classification=fbs`;
const MAX_GAME_ROWS = 20_000, MAX_TEAM_GAMES = 20, MAX_POINTS = 300;
export type ScoringMember = { id: string; school: string };
type Side = { id: unknown; team: unknown; classification: unknown; points: unknown };
const obj = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const text = (v: unknown): v is string => typeof v === "string" && v.trim() === v && v.length > 0 && v.length <= 64 && !/[\u0000-\u001f\u007f]/.test(v);
const positiveId = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0 && v < 1_000_000_000_000;
const points = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= MAX_POINTS;

/**
 * Per-member scoring for one generation, or a thrown error (the caller then publishes yardage with scoring
 * unavailable). Every row must carry a unique game ID and the 2026 regular-season identity. Only
 * `completed === true` games count, never a clock guess; their scores must be valid integers, and a genuine 0
 * counts. Each FBS side joins by numeric ID with an exact canonical school-name cross-check; an FCS (or other
 * non-member) opponent still counts for its FBS side. A conflicting identity, duplicate game or unknown FBS ID
 * stops the whole derivation rather than silently skipping or promoting anyone.
 */
export function createScoringRankings(members: readonly ScoringMember[], games: unknown, checkedAt: string, population = 138): Record<string, ScoringRankings | null> {
  if (members.length !== population || !Array.isArray(games) || !games.length || games.length > MAX_GAME_ROWS || !Number.isFinite(Date.parse(checkedAt))) throw new Error("games-shape");
  const byId = new Map(members.map(m => [m.id, m])), bySchool = new Map(members.map(m => [m.school, m]));
  if (byId.size !== population || bySchool.size !== population) throw new Error("membership-shape");
  const totals = new Map<string, { games: number; pointsFor: number; pointsAllowed: number }>(), seen = new Set<number>();
  for (const raw of games) {
    const g = obj(raw);
    if (!positiveId(g.id) || seen.has(g.id) || g.season !== SCORING_YEAR || g.seasonType !== "regular" || typeof g.completed !== "boolean") throw new Error("game-shape");
    seen.add(g.id);
    if (!g.completed) continue; // Upcoming or in-progress: null or partial scores never count.
    const sides: Side[] = (["home", "away"] as const).map(side => ({ id: g[`${side}Id`], team: g[`${side}Team`], classification: g[`${side}Classification`], points: g[`${side}Points`] }));
    if (sides.some(s => !positiveId(s.id) || !text(s.team) || !points(s.points)) || sides[0].id === sides[1].id) throw new Error("completed-game-shape");
    sides.forEach((side, index) => {
      const member = byId.get(String(side.id)), named = bySchool.get(side.team as string);
      if (member ? member.school !== side.team || side.classification !== "fbs" : named || side.classification === "fbs") throw new Error("identity-join");
      if (!member) return;
      const row = totals.get(member.id) ?? { games: 0, pointsFor: 0, pointsAllowed: 0 };
      row.games += 1; row.pointsFor += side.points as number; row.pointsAllowed += sides[1 - index].points as number;
      if (row.games > MAX_TEAM_GAMES) throw new Error("team-games");
      totals.set(member.id, row);
    });
  }
  const eligible = members.filter(m => totals.has(m.id));
  if (!eligible.length) throw new Error("no-completed-games");
  const complete = eligible.length === population;
  const rank = (id: string, side: "pointsFor" | "pointsAllowed"): RankingMetric => {
    const own = totals.get(id)!, total = own[side], n = own.games;
    // Exact integer cross-products before any rounding: higher scored ranks first, lower allowed ranks first.
    const others = eligible.map(m => totals.get(m.id)!);
    const better = others.filter(o => side === "pointsFor" ? o[side] * n > total * o.games : o[side] * n < total * o.games).length;
    const equal = others.filter(o => o[side] * n === total * o.games).length;
    return { total, games: n, rank: complete ? better + 1 : null, population, coverage: eligible.length, tied: complete && equal > 1 };
  };
  return Object.fromEntries(members.map((m): [string, ScoringRankings | null] => [m.id, totals.has(m.id) ? { basis: "regular-completed", year: SCORING_YEAR, games: totals.get(m.id)!.games, population, checkedAt, offense: rank(m.id, "pointsFor"), defense: rank(m.id, "pointsAllowed") } : null]));
}
