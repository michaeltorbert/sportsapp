import { classify, easternDate, type Game, type Scoreboard } from "./football";

export const HOUR = 3_600_000;
export const WINDOW_MS = 3.5 * HOUR;
export const LANE_HEIGHT = 44;
export const NETWORK_ORDER = ["ABC", "FOX", "CBS", "NBC", "ESPN", "ESPN2", "ESPNU", "SECN", "SEC NETWORK", "ACCN", "ACC NETWORK", "BTN", "FS1", "CW", "CBSSN", "ESPN+", "SECN+"];
export const PALETTE = ["#a91646", "#0854bf", "#7630b8", "#08764e", "#ad3e0a", "#9e2469", "#256478", "#6848aa"];
export type GuideMode = "all" | "watch";
export type Placement = { game: Game; start: number; end: number; track: number };
export type NetworkLane = { key: string; name: string; tracks: number; games: Placement[] };
export const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
export function kickoff(game: Game) { const time = Date.parse(game.date); return game.timeValid && Number.isFinite(time) ? time : null; }
export function watched(game: Game) { return Object.values(classify(game)).some(Boolean); }
export function gameColor(id: string) { let hash = 2166136261; for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619); return PALETTE[(hash >>> 0) % PALETTE.length]; }
export function networks(game: Game) {
  const values = Array.isArray(game.broadcasts) ? game.broadcasts : [game.broadcast];
  const unique = new Map<string, string>();
  for (const value of values) if (typeof value === "string" && value.trim()) {
    const name = value.trim(), key = name.toLowerCase();
    if (!unique.has(key)) unique.set(key, name);
  }
  return unique.size ? [...unique.values()] : ["Network TBD"];
}
export function networkOrder(a: string, b: string) {
  const rank = (v: string) => v.toLowerCase() === "network tbd" ? Number.MAX_SAFE_INTEGER : NETWORK_ORDER.indexOf(v.toUpperCase()) < 0 ? NETWORK_ORDER.length : NETWORK_ORDER.indexOf(v.toUpperCase());
  return rank(a) - rank(b) || compareText(a.toLowerCase(), b.toLowerCase()) || compareText(a, b);
}
function compareGames(a: Game, b: Game) {
  const left = kickoff(a), right = kickoff(b);
  if (left === null && right === null) {
    const primary = (game: Game) => networks(game).sort(networkOrder)[0];
    return networkOrder(primary(a), primary(b)) || compareText(a.teams.map(t => t.name).join(" at "), b.teams.map(t => t.name).join(" at ")) || compareText(a.id, b.id);
  }
  return (left ?? Infinity) - (right ?? Infinity) || compareText(a.id, b.id);
}
export function coordinate(time: number, start: number, scale: number) { return (time - start) / HOUR * scale; }
export function guideBoard(board: Scoreboard | null, mode: GuideMode) {
  const all = [...new Map((board?.games || []).map(game => [game.id, game])).values()];
  const times = all.map(kickoff).filter((time): time is number => time !== null);
  const start = times.length ? Math.floor(Math.min(...times) / HOUR) * HOUR : null;
  const end = times.length ? Math.ceil((Math.max(...times) + WINDOW_MS) / HOUR) * HOUR : null;
  const games = all.filter(game => mode === "all" || watched(game)).sort(compareGames);
  const lanes = new Map<string, NetworkLane>();
  for (const game of games) {
    const time = kickoff(game); if (time === null) continue;
    for (const name of networks(game)) {
      const key = name.toLowerCase();
      const lane = lanes.get(key) || { key, name, tracks: 1, games: [] };
      let track = 0;
      while (lane.games.some(p => p.track === track && p.end > time)) track++;
      lane.games.push({ game, start: time, end: time + WINDOW_MS, track });
      lane.tracks = Math.max(lane.tracks, track + 1); lanes.set(key, lane);
    }
  }
  return { allCount: all.length, games, start, end, lanes: [...lanes.values()].sort((a, b) => networkOrder(a.name, b.name)), tbd: games.filter(game => kickoff(game) === null) };
}
// Construct ICU formatters only when a formatted label is actually requested.
let timeFormatter: Intl.DateTimeFormat | undefined;
let accessibleTimeFormatter: Intl.DateTimeFormat | undefined;
let tickFormatter: Intl.DateTimeFormat | undefined;
export function guideTime(time: number) {
  timeFormatter ??= new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
  return timeFormatter.format(time);
}
export function tickLabel(time: number) {
  tickFormatter ??= new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", timeZoneName: "short" });
  return tickFormatter.format(time);
}
function accessibleTime(time: number) {
  accessibleTimeFormatter ??= new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  return accessibleTimeFormatter.format(time);
}
export function matchup(game: Game) { return game.teams.map(team => team.abbreviation || team.name).join(" @ "); }
export function fullGameLabel(game: Game) { const time = kickoff(game); return `${game.teams.map(t => t.name).join(" at ")}, ${easternDate(new Date(game.date))}, ${time === null ? "Time TBD" : accessibleTime(time) + " (Eastern)"}, ${game.state === "upcoming" ? "Scheduled" : game.status}, listed on ${networks(game).join(" / ")}${watched(game) ? ", Watchlist" : ""}`; }
