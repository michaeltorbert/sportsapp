import type { Game, Scoreboard } from "./football";
export const DUKE_ID = "150";
export const DUKE_STORAGE_KEY = "ss:duke-visibility:v2";
// v1 kept automatic snapshots and manual choices in one map. It is only read once, to migrate.
export const DUKE_LEGACY_STORAGE_KEY = "ss:duke-visibility:v1";
export type DukeMode = "away" | "hide" | "show";
type DukeRule = { from: number; mode: DukeMode };
// manual: the user's per-game choices. remembered: automatic decisions frozen once play started.
// waiting: how many default rules existed when this device last saw each game not yet started. It
// records an observation, not a decision, so a default chosen during a delay survives kickoff.
export type DukePreferences = { version: 2; rules: DukeRule[]; manual: Record<string, boolean>; remembered: Record<string, boolean>; waiting: Record<string, number> };
export const defaultDukePreferences = (): DukePreferences => ({ version: 2, rules: [{ from: 0, mode: "away" }], manual: {}, remembered: {}, waiting: {} });
const corruptedDukePreferences = (): DukePreferences => ({ version: 2, rules: [{ from: 0, mode: "hide" }], manual: {}, remembered: {}, waiting: {} });
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
function validWaiting(waiting: unknown, rules: DukeRule[]): waiting is Record<string, number> {
  return !!waiting && typeof waiting === "object" && !Array.isArray(waiting) && Object.entries(waiting).every(([id, seen]) => /^[A-Za-z0-9_-]+$/.test(id) && Number.isSafeInteger(seen) && seen >= 1 && seen <= rules.length);
}
export function decodeDukePreferences(raw: string | null): { prefs: DukePreferences; corrupted: boolean } {
  if (raw === null) return { prefs: defaultDukePreferences(), corrupted: false };
  try {
    const value = JSON.parse(raw);
    if (value?.version !== 2 || !validRules(value.rules) || !validChoices(value.manual) || !validChoices(value.remembered) || !validWaiting(value.waiting, value.rules)) throw Error();
    return { prefs: { version: 2, rules: value.rules, manual: value.manual, remembered: value.remembered, waiting: value.waiting }, corrupted: false };
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
    return { prefs: { version: 2, rules: value.rules, manual: {}, remembered: {}, waiting: {} }, corrupted: false, cleared: Object.keys(value.overrides).length };
  } catch { return { prefs: corruptedDukePreferences(), corrupted: true, cleared: 0 }; }
}
// ESPN can report an in-progress 0–0 game at period 0, before the parser sees start evidence.
export function dukeStarted(game: Game) { return game.started || game.state === "live" || game.state === "final"; }
function automaticDukeHidden(game: Game, prefs: DukePreferences) {
  const started = dukeStarted(game), kickoff = Date.parse(game.date), seen = prefs.waiting[game.id] ?? 0;
  // Until play starts the newest default applies, even past a delayed kickoff time. A started game
  // keeps the default in effect at kickoff, which also protects games this device never loaded, unless
  // a newer default was chosen while this device saw the game still waiting to start.
  let rule = started ? -1 : prefs.rules.length - 1;
  if (started) prefs.rules.forEach(({ from }, i) => { if (from <= kickoff || i < seen) rule = i; });
  // No usable kickoff time and never seen waiting: fail closed.
  const mode = prefs.rules[rule]?.mode ?? "hide";
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
// is unknown: that would freeze a visible result before metadata could confirm an away game. Before
// play, only the waiting observation is updated; the decision itself is still made at start.
export function rememberDukeGames(prefs: DukePreferences, games: Game[]): DukePreferences {
  const remembered = { ...prefs.remembered }, waiting = { ...prefs.waiting }; let changed = false;
  for (const game of games) if (isDuke(game)) {
    if (!dukeStarted(game)) {
      if (waiting[game.id] !== prefs.rules.length) { waiting[game.id] = prefs.rules.length; changed = true; }
    } else if (typeof game.neutralSite === "boolean" && !Object.hasOwn(remembered, game.id)) {
      remembered[game.id] = automaticDukeHidden(game, prefs); changed = true;
    }
  }
  return changed ? { ...prefs, remembered, waiting } : prefs;
}
export function protectDukeBoard(board: Scoreboard | null, prefs: DukePreferences | null): Scoreboard | null {
  if (!board) return null;
  return { ...board, games: board.games.filter(game => !dukeHidden(game, prefs)) };
}
