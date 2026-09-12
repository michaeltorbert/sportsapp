import { upsetWatch } from "./upset";
import { gamePriority, isPinnedGame, teamRelevance } from "./watch-priority";

export type Team = { id: string; name: string; abbreviation: string; logo: string | null; score: number | null; rank: number | null; rankKnown?: boolean; record: string; conferenceId: string | null; changed?: boolean };
export type Categories = { acc: boolean; top25: boolean; close: boolean; upset: boolean };
export type PregameLine = { favoriteId: string | null; spread: number; source: string };
export type AlertExpectation = { version: 1; gameId: string; teamIds: [string, string]; date: string; observedAt: number; state: "absent" | "line" | "pickem" | "invalid"; line?: PregameLine };
export type Game = { id: string; date: string; timeValid: boolean; neutralSite?: boolean; state: "live" | "delayed" | "upcoming" | "final" | "other"; status: string; period: number; clock: number; clockKnown?: boolean; intermission?: boolean; pregameLine?: PregameLine; pregameEvidenceInvalid?: boolean; alertExpectation?: AlertExpectation; started: boolean; teams: [Team, Team]; broadcast: string; broadcasts?: string[]; possession: string | null; downDistance: string; redZone: boolean; url: string; retainedCategories?: Categories; lastActiveClose?: boolean };
export type Scoreboard = { date: string; endDate?: string; fetchedAt: string; games: Game[]; stale?: boolean; warnings?: string[] };
// Reuse one formatter. Workers charge CPU for Intl.DateTimeFormat construction,
// and score normalization calls this once per event. Lazy so unused homepage
// SSR does not load ICU at module evaluation.
let easternDayFormat: Intl.DateTimeFormat | undefined;
export function easternDate(now = new Date()) {
  easternDayFormat ??= new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
  return easternDayFormat.format(now);
}
export function shiftDate(date: string, days: number) { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
export function validDate(date: string) { return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T12:00:00Z`)) && new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) === date; }
export function classify(game: Game): Categories {
  const [a, b] = game.teams;
  const acc = a.conferenceId === "1" || b.conferenceId === "1";
  const top25 = [a, b].some(t => t.rank !== null && t.rank >= 1 && t.rank <= 25);
  const active = game.state === "live" || game.state === "final";
  const upsetActive = active || (game.state === "delayed" && game.started);
  const kept = game.state === "final" ? game.retainedCategories : undefined;
  if (!upsetActive || a.score === null || b.score === null) return kept || { acc, top25, close: false, upset: false };
  const close = active && Math.abs(a.score - b.score) <= 8;
  if (a.score === b.score) return { acc, top25, close, upset: kept?.upset || false };
  const upset = upsetWatch(game) !== null;
  return { acc, top25, close: close || !!kept?.close, upset: upset || !!kept?.upset };
}
export function margin(game: Game) { const [a, b] = game.teams; return a.score === null || b.score === null ? Infinity : Math.abs(a.score - b.score); }
export function sortGames(games: Game[]) {
  const state = { live: 0, delayed: 1, upcoming: 2, other: 3, final: 4 };
  return [...games].sort((a, b) => {
    const byState = state[a.state] - state[b.state];
    if (byState) return byState;
    const byPin = Number(isPinnedGame(b)) - Number(isPinnedGame(a));
    if (byPin) return byPin;
    if (a.state === "live") {
      const ap = gamePriority(a), bp = gamePriority(b);
      const priority = bp.total - ap.total || bp.drama - ap.drama || bp.finishBand - ap.finishBand;
      if (priority) return priority;
    }
    return a.date.localeCompare(b.date)
      || (a.state === "upcoming" ? teamRelevance(b) - teamRelevance(a) : 0)
      || a.id.localeCompare(b.id);
  });
}
// Monday belongs to the football weekend that began the previous Thursday.
export function accWeek(date: string) {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  const offset = day === 0 ? -3 : day === 1 ? -4 : 4 - day;
  const start = shiftDate(date, offset);
  return { start, end: shiftDate(start, 4) };
}
export function unfinished(game: Game) { return game.state === "live" || game.state === "delayed" || game.state === "upcoming"; }
export function gameDay(now: Date, previous: Scoreboard | null, heldDate?: string) {
  const calendar = easternDate(now), yesterday = shiftDate(calendar, -1);
  if (previous?.date === yesterday && !previous.stale && !previous.warnings?.length)
    return previous.games.some(unfinished) ? yesterday : calendar;
  // A failed or incomplete refresh is not evidence that the last game ended.
  return heldDate === yesterday ? yesterday : calendar;
}
export function retainFinalCategories(next: Scoreboard, previous: Scoreboard | null): Scoreboard {
  const sameRange = previous?.date === next.date && (previous.endDate || previous.date) === (next.endDate || next.date);
  return { ...next, games: next.games.map(raw => {
    const game = { ...raw };
    // Only our matching prior observation can supply delay history.
    delete game.lastActiveClose;
    const old = sameRange ? previous?.games.find(g => g.id === game.id && g.teams.every((t, i) => t.id === game.teams[i].id)) : undefined;
    // Categories belong to the event; betting evidence also belongs to its scheduled matchup.
    if (!game.pregameLine && old?.pregameLine && old.date === game.date) game.pregameLine = old.pregameLine;
    const delayedClose = sameRange && old?.state === "delayed" && old.started ? old.lastActiveClose === true : false;
    if (sameRange && game.state === "delayed" && game.started && old) {
      if (old.state === "live") game.lastActiveClose = classify(old).close;
      else if (old.state === "delayed" && old.started && typeof old.lastActiveClose === "boolean") game.lastActiveClose = old.lastActiveClose;
    }
    if (game.state === "final" && old && (old.state === "live" || old.state === "final" || (old.state === "delayed" && old.started))) {
      const categories = classify(old);
      return { ...game, retainedCategories: { ...categories, close: categories.close || delayedClose } };
    }
    return game;
  }) };
}
