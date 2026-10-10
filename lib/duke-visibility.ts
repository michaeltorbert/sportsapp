import type { Game, Scoreboard } from "./football";
export const DUKE_ID = "150";
export const DUKE_STORAGE_KEY = "ss:duke-visibility:v2";
// v1 kept automatic snapshots and manual choices in one map. It is only read once, to migrate.
export const DUKE_LEGACY_STORAGE_KEY = "ss:duke-visibility:v1";
export type DukeMode = "away" | "hide" | "show";
type DukeRule = { from: number; mode: DukeMode };
// manual: the user's per-game choices. remembered: automatic decisions frozen once play started.
export type DukePreferences = { version: 2; rules: DukeRule[]; manual: Record<string, boolean>; remembered: Record<string, boolean> };
export const defaultDukePreferences = (): DukePreferences => ({ version: 2, rules: [{ from: 0, mode: "away" }], manual: {}, remembered: {} });
const corruptedDukePreferences = (): DukePreferences => ({ version: 2, rules: [{ from: 0, mode: "hide" }], manual: {}, remembered: {} });
export function isDuke(game: Game) { return game.teams.some(team => team.id === DUKE_ID); }
function validRules(rules: unknown): rules is DukeRule[] {
  if (!Array.isArray(rules) || !rules.length || rules[0]?.from !== 0) return false;
  let previous = -1;
  for (const rule of rules) {
    if (!Number.isSafeInteger(rule?.from) || rule.from < 0 || rule.from < previous || !["away", "hide", "show"].includes(rule.mode)) return false;
    previous = rule.from;
  }
  return true;
}
function validChoices(choices: unknown): choices is Record<string, boolean> {
  return !!choices && typeof choices === "object" && !Array.isArray(choices) && Object.entries(choices).every(([id, hidden]) => /^[A-Za-z0-9_-]+$/.test(id) && typeof hidden === "boolean");
}
export function decodeDukePreferences(raw: string | null): { prefs: DukePreferences; corrupted: boolean } {
  if (raw === null) return { prefs: defaultDukePreferences(), corrupted: false };
  try {
    const value = JSON.parse(raw);
    if (value?.version !== 2 || !validRules(value.rules) || !validChoices(value.manual) || !validChoices(value.remembered)) throw Error();
    return { prefs: { version: 2, rules: value.rules, manual: value.manual, remembered: value.remembered }, corrupted: false };
  } catch { return { prefs: corruptedDukePreferences(), corrupted: true }; }
}
export function parseDukePreferences(raw: string | null) { return decodeDukePreferences(raw).prefs; }
// v1 cannot tell automatic snapshots from deliberate choices, so its per-game values are cleared
// once, as the user approved (ORD-019). The default timeline carries over unchanged.
export function migrateLegacyDukePreferences(raw: string | null): { prefs: DukePreferences; corrupted: boolean; cleared: number } {
  if (raw === null) return { prefs: defaultDukePreferences(), corrupted: false, cleared: 0 };
  try {
    const value = JSON.parse(raw);
    if (value?.version !== 1 || !validRules(value.rules) || !validChoices(value.overrides)) throw Error();
    return { prefs: { version: 2, rules: value.rules, manual: {}, remembered: {} }, corrupted: false, cleared: Object.keys(value.overrides).length };
  } catch { return { prefs: corruptedDukePreferences(), corrupted: true, cleared: 0 }; }
}
// ESPN can report an in-progress 0–0 game at period 0, before the parser sees start evidence.
export function dukeStarted(game: Game) { return game.started || game.state === "live" || game.state === "final"; }
function automaticDukeHidden(game: Game, prefs: DukePreferences) {
  const started = dukeStarted(game), kickoff = Date.parse(game.date);
  if (started && !Number.isFinite(kickoff)) return true;
  // Until play starts the newest default applies, even past a delayed kickoff time. A started game
  // keeps the default in effect at kickoff, which also protects games this device never loaded.
  const mode = prefs.rules.filter(rule => rule.from <= (started ? kickoff : Infinity)).at(-1)?.mode ?? "away";
  // Missing venue metadata cannot prove an away game (ORD-019), so it stays visible.
  return mode === "hide" || (mode === "away" && started && game.teams[0].id === DUKE_ID && game.neutralSite === false);
}
export function dukeHidden(game: Game, prefs: DukePreferences | null) {
  if (!isDuke(game)) return false;
  if (!prefs) return true;
  if (Object.hasOwn(prefs.manual, game.id)) return prefs.manual[game.id];
  if (Object.hasOwn(prefs.remembered, game.id)) return prefs.remembered[game.id];
  return automaticDukeHidden(game, prefs);
}
export function changeDukeDefault(prefs: DukePreferences, mode: DukeMode, now: number): DukePreferences {
  // A timeline also protects past events that this device has never loaded.
  const from = Math.max(now, prefs.rules.at(-1)!.from + 1);
  return { ...prefs, rules: [...prefs.rules, { from, mode }] };
}
// Once play starts, the automatic decision is frozen so a later default change or status correction
// cannot reveal the result. Never before play, whatever the scheduled time, and never while the venue
// is unknown: that would freeze a visible result before metadata could confirm an away game.
export function rememberDukeGames(prefs: DukePreferences, games: Game[]): DukePreferences {
  const remembered = { ...prefs.remembered }; let changed = false;
  for (const game of games) if (isDuke(game) && dukeStarted(game) && typeof game.neutralSite === "boolean" && !Object.hasOwn(remembered, game.id)) {
    remembered[game.id] = automaticDukeHidden(game, prefs); changed = true;
  }
  return changed ? { ...prefs, remembered } : prefs;
}
export function protectDukeBoard(board: Scoreboard | null, prefs: DukePreferences | null): Scoreboard | null {
  if (!board) return null;
  return { ...board, games: board.games.filter(game => !dukeHidden(game, prefs)) };
}
