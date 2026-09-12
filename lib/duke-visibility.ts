import type { Game, Scoreboard } from "./football";
export const DUKE_ID = "150";
export const DUKE_STORAGE_KEY = "ss:duke-visibility:v1";
export type DukeMode = "away" | "hide" | "show";
export type DukePreferences = { version: 1; rules: { from: number; mode: DukeMode }[]; overrides: Record<string, boolean> };
export const defaultDukePreferences = (): DukePreferences => ({ version: 1, rules: [{ from: 0, mode: "away" }], overrides: {} });
export function isDuke(game: Game) { return game.teams.some(team => team.id === DUKE_ID); }
export function decodeDukePreferences(raw: string | null): { prefs: DukePreferences; corrupted: boolean } {
  if (raw === null) return { prefs: defaultDukePreferences(), corrupted: false };
  try {
    const value = JSON.parse(raw);
    if (value?.version !== 1 || !Array.isArray(value.rules) || !value.rules.length || value.rules[0].from !== 0 || !value.overrides || typeof value.overrides !== "object" || Array.isArray(value.overrides)) throw Error();
    let previous = -1;
    for (const rule of value.rules) {
      if (!Number.isSafeInteger(rule.from) || rule.from < 0 || rule.from < previous || !["away", "hide", "show"].includes(rule.mode)) throw Error();
      previous = rule.from;
    }
    if (Object.entries(value.overrides).some(([id, hidden]) => !/^[A-Za-z0-9_-]+$/.test(id) || typeof hidden !== "boolean")) throw Error();
    return { prefs: value, corrupted: false };
  } catch { return { prefs: { version: 1, rules: [{ from: 0, mode: "hide" }], overrides: {} }, corrupted: true }; }
}
export function parseDukePreferences(raw: string | null) { return decodeDukePreferences(raw).prefs; }
export function dukeHidden(game: Game, prefs: DukePreferences | null) {
  if (!isDuke(game)) return false;
  if (!prefs) return true;
  if (Object.hasOwn(prefs.overrides, game.id)) return prefs.overrides[game.id];
  const kickoff = Date.parse(game.date);
  if (!Number.isFinite(kickoff)) return true;
  const time = !game.started && !game.timeValid ? Infinity : kickoff;
  const mode = prefs.rules.filter(rule => rule.from <= time).at(-1)?.mode ?? "away";
  // Missing/old venue metadata cannot prove that Duke is playing at home.
  return mode === "hide" || (mode === "away" && !(game.teams[1].id === DUKE_ID && game.neutralSite === false));
}
export function changeDukeDefault(prefs: DukePreferences, mode: DukeMode, now: number): DukePreferences {
  // A timeline also protects past events that this device has never loaded.
  const from = Math.max(now, prefs.rules.at(-1)!.from + 1);
  return { ...prefs, rules: [...prefs.rules, { from, mode }] };
}
export function rememberDukeGames(prefs: DukePreferences, games: Game[], now: number): DukePreferences {
  const overrides = { ...prefs.overrides }; let changed = false;
  for (const game of games) if (isDuke(game) && !Object.hasOwn(overrides, game.id) && (game.started || (game.timeValid && Date.parse(game.date) <= now))) {
    overrides[game.id] = dukeHidden(game, prefs); changed = true;
  }
  return changed ? { ...prefs, overrides } : prefs;
}
export function protectDukeBoard(board: Scoreboard | null, prefs: DukePreferences | null): Scoreboard | null {
  if (!board) return null;
  // Records update independently of selected dates. Omit them universally:
  // this device cannot establish that every older Duke result has been seen.
  return { ...board, games: board.games.filter(game => !dukeHidden(game, prefs)).map(game => ({ ...game, teams: game.teams.map(team => ({ ...team, record: "" })) as Game["teams"] })) };
}
