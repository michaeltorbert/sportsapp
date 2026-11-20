import { z } from "zod";
import type { Game } from "./football";
import type { DukePreferences } from "./duke-visibility";
import { PLAYER_YEAR, playerGameHidden, playerGameSchema, playerId, playerTeamId } from "./player-season";

/** #181 team defensive leaders: the public contract and pure helpers shared by the Worker and the browser.
 *  No source access here; the Worker builds the projection from the same CFBD team/year pack (player-season-server). */
export const DEFENSE_FAMILIES = [
  ["tackles", "defensive", "TOT", "Total tackles"],
  ["sacks", "defensive", "SACKS", "Sacks"],
  ["interceptions", "interceptions", "INT", "Interceptions"],
] as const;
export type DefenseFamilyKey = typeof DEFENSE_FAMILIES[number][0];
export type DefenseLeader = { id: string; name: string; solo?: number };
/** "leaders": every tied valid maximum (no cap); "none-positive": every supplied value is a known 0;
 *  "not-supplied": the source gave no row; "invalid": a possible maximum was malformed or conflicting. */
export type DefenseFamily =
  | { state: "leaders"; value: number; leaders: DefenseLeader[] }
  | { state: "none-positive" } | { state: "not-supplied" } | { state: "invalid" };
export type DefenseProjection = { v: 1; families: Record<DefenseFamilyKey, DefenseFamily> };
/** "available": a pack normalized with defense; "pending": a fresh legacy pack (defense not yet known,
 *  never a known absence); "unavailable": a stored defense projection that failed validation. */
export type TeamDefense = {
  v: 1; team: { id: string; name: string }; year: number; basis: "regular"; checkedAt: string; stale: boolean;
  capability: "available" | "pending" | "unavailable"; families: Record<DefenseFamilyKey, DefenseFamily> | null;
  games: Game[]; scheduleComplete: boolean;
};

const obj = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const name = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 100 && !/[\u0000-\u001f\u007f<>]/.test(v);
/** Source stat strings ("3", "1.0", "7.5") or numbers. Counts are nonnegative integers; sacks/TFL keep half units. */
export function defenseValue(statType: string, raw: unknown): number | null {
  const s = typeof raw === "number" && Number.isFinite(raw) ? String(raw) : raw;
  if (typeof s !== "string" || !/^\d{1,4}(?:\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  return statType === "SACKS" || statType === "TFL" ? (Number.isInteger(n * 2) ? n : null) : Number.isInteger(n) ? n : null;
}
/** A team aggregate row (negative or zero ID) is not a person; any other non-ID makes the family unknowable. */
function personId(v: unknown): string | null | "team" {
  const s = typeof v === "number" && Number.isSafeInteger(v) ? String(v) : v;
  if (typeof s === "string" && /^-\d{1,12}$|^0+$/.test(s)) return "team";
  return playerId(s) ? s : null;
}

/** From the ORIGINAL season rows, before any lossy person filtering. A malformed or conflicting possible
 *  maximum invalidates its family rather than promoting a lower surviving row. Identical duplicates collapse. */
export function projectTeamDefense(teamName: string, year: number, rows: readonly unknown[]): DefenseProjection {
  const families = {} as Record<DefenseFamilyKey, DefenseFamily>;
  const solo = new Map<string, number | "conflict">();
  for (const raw of rows) {
    const r = obj(raw);
    if (r.team !== teamName || r.season !== year || r.category !== "defensive" || r.statType !== "SOLO") continue;
    const pid = personId(r.playerId), v = defenseValue("SOLO", r.stat);
    if (!pid || pid === "team") continue;
    const prior = solo.get(pid); solo.set(pid, v === null || (prior !== undefined && prior !== v) ? "conflict" : v);
  }
  for (const [key, category, statType] of DEFENSE_FAMILIES) {
    const people = new Map<string, { name: string; value: number }>(); let invalid = false;
    for (const raw of rows) {
      const r = obj(raw);
      if (r.team !== teamName || r.season !== year || r.category !== category || r.statType !== statType) continue;
      const pid = personId(r.playerId);
      if (pid === "team") continue;
      const v = defenseValue(statType, r.stat);
      if (!pid || !name(r.player) || v === null) { invalid = true; break; }
      const prior = people.get(pid);
      if (prior && (prior.name !== r.player || prior.value !== v)) { invalid = true; break; }
      people.set(pid, { name: r.player, value: v });
    }
    if (invalid) { families[key] = { state: "invalid" }; continue; }
    if (!people.size) { families[key] = { state: "not-supplied" }; continue; }
    const max = Math.max(...[...people.values()].map(p => p.value));
    if (max <= 0) { families[key] = { state: "none-positive" }; continue; }
    const leaders = [...people.entries()].filter(([, p]) => p.value === max)
      .sort(([a, p], [b, q]) => p.name.localeCompare(q.name, "en") || a.localeCompare(b))
      .map(([id, p]) => { const s = key === "tackles" ? solo.get(id) : undefined; return typeof s === "number" ? { id, name: p.name, solo: s } : { id, name: p.name }; });
    families[key] = { state: "leaders", value: max, leaders };
  }
  return { v: 1, families };
}

const leaderSchema = z.object({ id: z.string().regex(/^[1-9]\d{0,11}$/), name: z.string().min(1).max(100).refine(name), solo: z.number().int().min(0).max(10_000).optional() });
// The bound is a response-size safety limit, not a display cap: every tied leader is shown.
const familySchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("leaders"), value: z.number().finite().positive().max(10_000).refine(n => Number.isInteger(n * 2)), leaders: z.array(leaderSchema).min(1).max(300) }),
  z.object({ state: z.literal("none-positive") }), z.object({ state: z.literal("not-supplied") }), z.object({ state: z.literal("invalid") }),
]);
const familiesSchema = z.object({ tackles: familySchema, sacks: familySchema, interceptions: familySchema });
export const defenseProjectionSchema = z.object({ v: z.literal(1), families: familiesSchema });
const teamDefenseSchema = z.object({
  v: z.literal(1), team: z.object({ id: z.string().regex(/^[1-9]\d{0,5}$/), name: z.string().min(1).max(100).refine(name) }),
  year: z.number().int().min(2000).max(PLAYER_YEAR), basis: z.literal("regular"), checkedAt: z.string().max(40).refine(v => Number.isFinite(Date.parse(v))),
  stale: z.boolean(), capability: z.enum(["available", "pending", "unavailable"]), families: familiesSchema.nullable(),
  games: z.array(playerGameSchema).max(30), scheduleComplete: z.boolean(),
});
export function validDefenseProjection(v: unknown): v is DefenseProjection {
  const parsed = defenseProjectionSchema.safeParse(v);
  return parsed.success && Object.values(parsed.data.families).every(f => f.state !== "leaders" || new Set(f.leaders.map(l => l.id)).size === f.leaders.length);
}
/** The browser trusts nothing it did not validate: exact selected team/year/basis and internally consistent ties and games. */
export function parseTeamDefense(raw: unknown, teamId: string, year: number): TeamDefense | null {
  const parsed = teamDefenseSchema.safeParse(raw);
  if (!parsed.success) return null;
  const d = parsed.data as unknown as TeamDefense;
  // Current-only discovery (matches parseTeamDefenseQuery): a historical response is rejected even if asked for.
  if (d.team.id !== teamId || d.year !== year || d.year !== PLAYER_YEAR || (d.capability === "available") !== !!d.families) return null;
  if (d.families && !validDefenseProjection({ v: 1, families: d.families })) return null;
  if (new Set(d.games.map(g => g.id)).size !== d.games.length || d.games.some(g => !g.teams.some(t => t.id === teamId))) return null;
  return d;
}
export function parseTeamDefenseQuery(params: URLSearchParams): { team: string; year: number } | null {
  const keys = [...params.keys()];
  if (keys.length !== 2 || keys.some(k => k !== "team" && k !== "year") || params.getAll("team").length !== 1 || params.getAll("year").length !== 1) return null;
  const team = params.get("team"), year = /^\d{4}$/.test(params.get("year") ?? "") ? Number(params.get("year")) : NaN;
  return playerTeamId(team) && year === PLAYER_YEAR ? { team, year } : null;
}
/** PV1-01: the raw own-pack gate must pass, AND (when board context exists) the same gate over the pack's games
 *  with matching board copies substituted. A board copy can only tighten protection, never erase a raw hidden
 *  decision (e.g. a source-unknown possibly-underway game whose board copy says upcoming). */
export function teamDefenseGate(d: TeamDefense, prefs: DukePreferences | null, board: readonly Game[] = []): ReturnType<typeof teamDefenseShown> {
  const raw = teamDefenseShown(d, prefs);
  if (!raw.shown || !board.length) return raw;
  return teamDefenseShown({ ...d, games: d.games.map(g => board.find(b => b.id === g.id && g.teams.every(t => b.teams.some(x => x.id === t.id))) ?? g) }, prefs);
}
/** The pack's own contribution gate (playerAggregates semantics), applied IN ADDITION to the base team
 *  seasonAggregates gate: unknown prefs, an incomplete schedule or any hidden Duke game withholds everything. */
export function teamDefenseShown(d: TeamDefense, prefs: DukePreferences | null): { shown: true } | { shown: false; reason: "checking" | "incomplete" | "hidden" } {
  if (!prefs) return { shown: false, reason: "checking" };
  if (!d.scheduleComplete || !d.games.length) return { shown: false, reason: "incomplete" };
  if (d.games.some(g => playerGameHidden(g, prefs))) return { shown: false, reason: "hidden" };
  return { shown: true };
}
