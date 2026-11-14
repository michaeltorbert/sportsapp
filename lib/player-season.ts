import { z } from "zod";
import type { Game } from "./football";
import { dukeHidden, isDuke, type DukePreferences } from "./duke-visibility";
export const PLAYER_YEAR = 2026;
export const PLAYER_CATEGORIES = ["passing", "rushing", "receiving"] as const;
export type PlayerCategory = typeof PLAYER_CATEGORIES[number];
export const PLAYER_FIELDS = {
  passing: [["COMPLETIONS", "Completions"], ["ATT", "Pass attempts"], ["YDS", "Passing yards"], ["TD", "Passing touchdowns"], ["INT", "Interceptions"], ["PCT", "Completion percentage"], ["YPA", "Yards per attempt"]],
  rushing: [["CAR", "Carries"], ["YDS", "Rushing yards"], ["TD", "Rushing touchdowns"], ["YPC", "Yards per carry"], ["LONG", "Longest rush · yards"]],
  receiving: [["REC", "Catches"], ["YDS", "Receiving yards"], ["TD", "Receiving touchdowns"], ["YPR", "Yards per catch"], ["LONG", "Longest catch · yards"]],
} as const;
export type PlayerStats = Partial<Record<PlayerCategory, Record<string, number | null>>>;
// Immutable entry anchor is separate from the selected display season/stint.
export type PlayerRequest = { id: string; year: number; team: string; anchorYear: number; stintTeam?: string; witnessTeam?: string; witnessEvent?: string };
export const playerId = (v: unknown): v is string => typeof v === "string" && /^[1-9]\d{0,11}$/.test(v);
export const playerTeamId = (v: unknown): v is string => typeof v === "string" && /^[1-9]\d{0,5}$/.test(v);
export const playerYear = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 2000 && v <= PLAYER_YEAR;
export function parsePlayerRequest(params: URLSearchParams): PlayerRequest | null {
  const keys = ["id", "year", "team", "anchorYear", "stintTeam", "witnessTeam", "witnessEvent"];
  if ([...params.keys()].some(k => !keys.includes(k)) || [...new Set(params.keys())].some(k => params.getAll(k).length !== 1)) return null;
  const pid = params.get("id"), team = params.get("team");
  const year = /^\d{4}$/.test(params.get("year") ?? "") ? Number(params.get("year")) : NaN;
  const anchorYear = /^\d{4}$/.test(params.get("anchorYear") ?? "") ? Number(params.get("anchorYear")) : NaN;
  const stintTeam = params.get("stintTeam"), witnessTeam = params.get("witnessTeam"), witnessEvent = params.get("witnessEvent");
  if (!playerId(pid) || !playerTeamId(team) || !playerYear(year) || !playerYear(anchorYear) ||
      (stintTeam !== null && (!stintTeam.length || stintTeam.length > 100 || /[\u0000-\u001f\u007f<>]/.test(stintTeam))) ||
      !!witnessTeam !== !!witnessEvent || (witnessTeam !== null && !playerTeamId(witnessTeam)) || (witnessEvent !== null && !/^[1-9]\d{5,11}$/.test(witnessEvent))) return null;
  return { id: pid, team, year, anchorYear, ...(stintTeam ? { stintTeam } : {}), ...(witnessTeam && witnessEvent ? { witnessTeam, witnessEvent } : {}) };
}
export function playerRequestKey(r: PlayerRequest) { return [r.id, r.year, r.team, r.anchorYear, r.stintTeam ?? "", r.witnessTeam ?? "", r.witnessEvent ?? ""].join(":"); }
export type PlayerSeasonChoice = { year: number; teams: string[] };
export type PlayerLog = { game: Game; stats: PlayerStats; boxSupplied: boolean };
export type PlayerSeason = {
  v: 1; id: string; name: string; position: string | null;
  anchor: { team: string; year: number }; year: number; needsTeamChoice: boolean; team: { id: string; name: string } | null; currentTeam: { id: string; name: string } | null;
  basis: "regular"; checkedAt: string; stale: boolean; choices: PlayerSeasonChoice[];
  totals: PlayerStats; logs: PlayerLog[]; scheduleComplete: boolean; totalsAvailable: boolean; historyAvailable: boolean;
};
const idSchema = z.string().regex(/^[1-9]\d{0,11}$/), teamIdSchema = z.string().regex(/^[1-9]\d{0,5}$/);
const text = z.string().min(1).max(100).refine(v => !/[\u0000-\u001f\u007f<>]/.test(v));
const statsSchema = z.object(Object.fromEntries(PLAYER_CATEGORIES.map(c => [c, z.record(z.number().finite().min(-1_000_000).max(1_000_000).nullable()).refine(v => Object.keys(v).every(k => PLAYER_FIELDS[c].some(([f]) => f === k))).optional()])));
const teamSchema = z.object({ id: idSchema, name: text, abbreviation: z.string().max(16), logo: z.null(), score: z.number().finite().min(0).max(300).nullable(), rank: z.null(), rankKnown: z.boolean().optional(), record: z.literal(""), conferenceId: z.null() });
const gameSchema = z.object({ id: z.string().regex(/^[1-9]\d{5,11}$/), date: z.string().max(40).refine(v => Number.isFinite(Date.parse(v))), timeValid: z.boolean(), neutralSite: z.boolean().optional(), state: z.enum(["live", "delayed", "upcoming", "final", "other"]), status: text, period: z.number().int().min(0).max(20), clock: z.number().min(0).max(3600), clockKnown: z.boolean().optional(), started: z.boolean(), teams: z.tuple([teamSchema, teamSchema]), broadcast: z.string().max(200), possession: z.null(), downDistance: z.literal(""), redZone: z.literal(false), url: z.literal("") });
const publicTeam = z.object({ id: teamIdSchema, name: text });
const schema = z.object({ v: z.literal(1), id: idSchema, name: text, position: text.nullable(),
  anchor: z.object({ team: teamIdSchema, year: z.number().int().min(2000).max(PLAYER_YEAR) }), year: z.number().int().min(2000).max(PLAYER_YEAR), needsTeamChoice: z.boolean(), team: publicTeam.nullable(), currentTeam: publicTeam.nullable(), basis: z.literal("regular"), checkedAt: z.string().max(40).refine(v => Number.isFinite(Date.parse(v))), stale: z.boolean(), choices: z.array(z.object({ year: z.number().int().min(2000).max(PLAYER_YEAR), teams: z.array(text).min(1).max(5) })).max(30), totals: statsSchema, logs: z.array(z.object({ game: gameSchema, stats: statsSchema, boxSupplied: z.boolean() })).max(30), scheduleComplete: z.boolean(), totalsAvailable: z.boolean(), historyAvailable: z.boolean() });
export function parsePlayerSeason(raw: unknown, request: PlayerRequest): PlayerSeason | null {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return null;
  const s = parsed.data as PlayerSeason;
  if (s.id !== request.id || s.year !== request.year || s.anchor.team !== request.team || s.anchor.year !== request.anchorYear || new Set(s.logs.map(l => l.game.id)).size !== s.logs.length || s.logs.some(l => !s.team || !l.game.teams.some(t => t.id === s.team!.id)) || new Set(s.choices.map(c => c.year)).size !== s.choices.length) return null;
  return s;
}
/** Historical data never writes observations. Unknown potentially protected game state fails closed. */
export function playerGameHidden(game: Game, prefs: DukePreferences | null) {
  if (!isDuke(game)) return false;
  if (!prefs) return true;
  if (Object.hasOwn(prefs.manual, game.id)) return dukeHidden(game, prefs);
  return game.state === "other" || dukeHidden(game, prefs);
}
export function playerAggregates(season: PlayerSeason, prefs: DukePreferences | null) {
  if (!prefs) return { shown: false, reason: "checking" as const };
  if (!season.scheduleComplete) return { shown: false, reason: "incomplete" as const };
  if (season.logs.some(l => playerGameHidden(l.game, prefs))) return { shown: false, reason: "hidden" as const };
  return { shown: true };
}
export function playerGame(season: PlayerSeason, id: string, prefs: DukePreferences | null, board?: Game): Game | null {
  const raw = season.logs.find(l => l.game.id === id)?.game;
  if (!raw) return null;
  const game = board && board.id === raw.id && raw.teams.every(t => board.teams.some(b => b.id === t.id)) ? board : raw;
  return playerGameHidden(game, prefs) ? null : game;
}
