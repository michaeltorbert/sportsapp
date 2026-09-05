export type Team = { id: string; name: string; abbreviation: string; logo: string | null; score: number | null; rank: number | null; rankKnown?: boolean; record: string; conferenceId: string | null; changed?: boolean };
export type Game = { id: string; date: string; timeValid: boolean; state: "live" | "delayed" | "upcoming" | "final" | "other"; status: string; period: number; clock: number; started: boolean; teams: [Team, Team]; broadcast: string; possession: string | null; downDistance: string; redZone: boolean; url: string };
export type Scoreboard = { date: string; fetchedAt: string; games: Game[]; stale?: boolean; warnings?: string[] };
export function easternDate(now = new Date()) { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now); }
export function shiftDate(date: string, days: number) { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
export function validDate(date: string) { return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T12:00:00Z`)) && new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) === date; }
export function classify(game: Game) {
  const [a, b] = game.teams;
  const acc = a.conferenceId === "1" || b.conferenceId === "1";
  const active = game.started && (game.state === "live" || game.state === "delayed");
  if (!active || a.score === null || b.score === null) return { acc, close: false, upset: false };
  const close = Math.abs(a.score - b.score) <= 8;
  if (a.score === b.score) return { acc, close, upset: false };
  const leader = a.score > b.score ? a : b;
  const trailer = leader.id === a.id ? b : a;
  return { acc, close, upset: leader.rankKnown !== false && trailer.rankKnown !== false && trailer.rank !== null && (leader.rank === null || leader.rank > trailer.rank) };
}
export function sortGames(games: Game[]) { return [...games].sort((a, b) => { const ca = classify(a), cb = classify(b); return Number(cb.upset) - Number(ca.upset) || Number(cb.acc) - Number(ca.acc) || b.period - a.period || a.clock - b.clock || a.date.localeCompare(b.date) || a.id.localeCompare(b.id); }); }
