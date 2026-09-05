export type Team = { id: string; name: string; abbreviation: string; logo: string | null; score: number | null; rank: number | null; rankKnown?: boolean; record: string; conferenceId: string | null; changed?: boolean };
export type Categories = { acc: boolean; top25: boolean; close: boolean; upset: boolean };
export type Game = { id: string; date: string; timeValid: boolean; state: "live" | "delayed" | "upcoming" | "final" | "other"; status: string; period: number; clock: number; started: boolean; teams: [Team, Team]; broadcast: string; possession: string | null; downDistance: string; redZone: boolean; url: string; retainedCategories?: Categories };
export type Scoreboard = { date: string; endDate?: string; fetchedAt: string; games: Game[]; stale?: boolean; warnings?: string[] };
export function easternDate(now = new Date()) { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now); }
export function shiftDate(date: string, days: number) { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
export function validDate(date: string) { return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T12:00:00Z`)) && new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) === date; }
export function classify(game: Game): Categories {
  const [a, b] = game.teams;
  const acc = a.conferenceId === "1" || b.conferenceId === "1";
  const top25 = [a, b].some(t => t.rank !== null && t.rank >= 1 && t.rank <= 25);
  const active = game.state === "live" || game.state === "final";
  const kept = game.state === "final" ? game.retainedCategories : undefined;
  if (!active || a.score === null || b.score === null) return kept || { acc, top25, close: false, upset: false };
  const close = Math.abs(a.score - b.score) <= 8;
  if (a.score === b.score) return { acc, top25, close, upset: kept?.upset || false };
  const leader = a.score > b.score ? a : b;
  const trailer = leader.id === a.id ? b : a;
  const upset = leader.rankKnown !== false && trailer.rankKnown !== false && trailer.rank !== null && trailer.rank >= 1 && trailer.rank <= 25 && (leader.rank === null || leader.rank > trailer.rank);
  return { acc, top25, close: close || !!kept?.close, upset: upset || !!kept?.upset };
}
export function margin(game: Game) { const [a, b] = game.teams; return a.score === null || b.score === null ? Infinity : Math.abs(a.score - b.score); }
export function sortGames(games: Game[]) {
  const state = { live: 0, delayed: 1, upcoming: 2, other: 3, final: 4 };
  const group = (g: Game) => { const c = classify(g); return c.acc ? 0 : c.top25 ? 1 : 2; };
  return [...games].sort((a, b) => state[a.state] - state[b.state] || (a.state === "live" ? group(a) - group(b) || b.period - a.period || margin(a) - margin(b) || a.clock - b.clock : 0) || a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
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
  return { ...next, games: next.games.map(game => {
    const old = previous?.games.find(g => g.id === game.id);
    return game.state === "final" && old && (old.state === "live" || old.state === "final")
      ? { ...game, retainedCategories: classify(old) } : game;
  }) };
}
