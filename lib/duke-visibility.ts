import type { Game, Scoreboard } from "./football";
export const DUKE_ID = "150";
export const DUKE_STORAGE_KEY = "ss:duke-visibility:v2";
// v1 kept automatic snapshots and manual choices in one map. It is only read once, to migrate.
export const DUKE_LEGACY_STORAGE_KEY = "ss:duke-visibility:v1";
export type DukeMode = "away" | "hide" | "show";
type DukeRule = { from: number; mode: DukeMode };
// manual: the user's per-game choices. remembered: an entry means this device saw the game start; its
// true/false value is a retired automatic snapshot, kept only for older open tabs and never read (ORD-020).
// waiting: how many default rules existed when this device last saw each game not yet started. It
// records an observation, not a decision, so a default chosen during a delay survives kickoff.
export type DukePreferences = { version: 2; rules: DukeRule[]; manual: Record<string, boolean>; remembered: Record<string, boolean>; waiting: Record<string, number> };
export const defaultDukePreferences = (): DukePreferences => ({ version: 2, rules: [{ from: 0, mode: "away" }], manual: {}, remembered: {}, waiting: {} });
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
// Every deliberate default is a later rule with a positive time. The app only ever saved a first rule of
// "hide" as its damaged-data fallback, so that synthetic baseline becomes the automatic setting again.
// Later rules keep their positions, so waiting counts stay valid (ORD-020).
function repairBaseline(rules: DukeRule[]) {
  return rules[0].mode === "hide" ? { rules: [{ from: 0, mode: "away" as const }, ...rules.slice(1)], repaired: true } : { rules, repaired: false };
}
// Damaged data falls back to the automatic setting, flagged so the caller can warn and leave it unsaved.
export function decodeDukePreferences(raw: string | null): { prefs: DukePreferences; corrupted: boolean; repaired: boolean } {
  if (raw === null) return { prefs: defaultDukePreferences(), corrupted: false, repaired: false };
  try {
    const value = JSON.parse(raw);
    if (value?.version !== 2 || !validRules(value.rules) || !validChoices(value.manual) || !validChoices(value.remembered) || !validWaiting(value.waiting, value.rules)) throw Error();
    const { rules, repaired } = repairBaseline(value.rules);
    return { prefs: { version: 2, rules, manual: value.manual, remembered: value.remembered, waiting: value.waiting }, corrupted: false, repaired };
  } catch { return { prefs: defaultDukePreferences(), corrupted: true, repaired: false }; }
}
export function parseDukePreferences(raw: string | null) { return decodeDukePreferences(raw).prefs; }
// v1 cannot tell automatic snapshots from deliberate choices, so its per-game values are cleared
// once, as the user approved (ORD-019). The default timeline carries over, with its baseline repaired.
export function migrateLegacyDukePreferences(raw: string | null): { prefs: DukePreferences; corrupted: boolean; cleared: number; repaired: boolean } {
  if (raw === null) return { prefs: defaultDukePreferences(), corrupted: false, cleared: 0, repaired: false };
  try {
    const value = JSON.parse(raw);
    if (value?.version !== 1 || !validRules(value.rules) || !validChoices(value.overrides)) throw Error();
    const { rules, repaired } = repairBaseline(value.rules);
    return { prefs: { version: 2, rules, manual: {}, remembered: {}, waiting: {} }, corrupted: false, cleared: Object.keys(value.overrides).length, repaired };
  } catch { return { prefs: defaultDukePreferences(), corrupted: true, cleared: 0, repaired: false }; }
}
// ESPN can report an in-progress 0–0 game at period 0, before the parser sees start evidence.
export function dukeStarted(game: Game) { return game.started || game.state === "live" || game.state === "final"; }
function automaticDukeHidden(game: Game, prefs: DukePreferences) {
  // A game this device saw start keeps that history even if a later status correction drops the evidence.
  const started = dukeStarted(game) || Object.hasOwn(prefs.remembered, game.id), kickoff = Date.parse(game.date), seen = prefs.waiting[game.id] ?? 0;
  // Until play starts the newest default applies, even past a delayed kickoff time. A started game
  // keeps the default in effect at kickoff, which also protects games this device never loaded, unless
  // a newer default was chosen while this device saw the game still waiting to start.
  let rule = started ? -1 : prefs.rules.length - 1;
  if (started) prefs.rules.forEach(({ from }, i) => { if (from <= kickoff || i < seen) rule = i; });
  // No usable kickoff time and never seen waiting: hide only if the user has ever chosen Always hide.
  const mode = prefs.rules[rule]?.mode ?? (prefs.rules.some(r => r.mode === "hide") ? "hide" : "away");
  // The automatic setting hides only while play is under way: live, including halftime and overtime, or
  // paused after it started. Finals and called-off games show again (ORD-020). Missing venue metadata
  // cannot prove an away game (ORD-019), so it stays visible.
  const underway = game.state === "live" || (game.state === "delayed" && started);
  return mode === "hide" || (mode === "away" && underway && game.teams[0].id === DUKE_ID && game.neutralSite === false);
}
export function dukeHidden(game: Game, prefs: DukePreferences | null) {
  if (!isDuke(game)) return false;
  if (!prefs) return true;
  if (Object.hasOwn(prefs.manual, game.id)) return prefs.manual[game.id];
  return automaticDukeHidden(game, prefs);
}
export function changeDukeDefault(prefs: DukePreferences, mode: DukeMode, now: number): DukePreferences {
  // A timeline also protects past events that this device has never loaded.
  const from = Math.max(now, prefs.rules.at(-1)!.from + 1);
  return { ...prefs, rules: [...prefs.rules, { from, mode }] };
}
// Once play starts with a known venue, the game is marked as seen started, so a later default change
// or a status correction back to a delay cannot move it to a newer default. Never while the venue is
// unknown (ORD-019). Before play, only the waiting observation is updated, and never again for a game
// already seen started. The stored value is only for older open tabs (ORD-020).
export function rememberDukeGames(prefs: DukePreferences, games: Game[]): DukePreferences {
  const remembered = { ...prefs.remembered }, waiting = { ...prefs.waiting }; let changed = false;
  for (const game of games) if (isDuke(game)) {
    const seenStarted = Object.hasOwn(remembered, game.id);
    if (!dukeStarted(game)) {
      if (!seenStarted && waiting[game.id] !== prefs.rules.length) { waiting[game.id] = prefs.rules.length; changed = true; }
    } else if (typeof game.neutralSite === "boolean" && !seenStarted) {
      remembered[game.id] = automaticDukeHidden(game, prefs); changed = true;
    }
  }
  return changed ? { ...prefs, remembered, waiting } : prefs;
}
export function protectDukeBoard(board: Scoreboard | null, prefs: DukePreferences | null): Scoreboard | null {
  if (!board) return null;
  return { ...board, games: board.games.filter(game => !dukeHidden(game, prefs)) };
}
