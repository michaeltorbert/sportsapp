import { classify, easternDate, margin, type Game } from "../../lib/football";
export type Trigger = "one-score-fourth" | "ranked-trailing-fourth" | "upset-final" | "acc-kickoff";
export type Snapshot = { game: Game; observedAt: number };
export type AlertEvent = { id: string; gameId: string; gameDay: string; trigger: Trigger; createdAt: number; payload: { title: string; body: string; eventId: string; url: string } };

export function conditions(game: Game, now: number): Record<Trigger, boolean> {
  const tags = classify({ ...game, retainedCategories: undefined });
  const fourth = game.state === "live" && game.period === 4;
  const untilKickoff = Date.parse(game.date) - now;
  return {
    "one-score-fourth": fourth && tags.close,
    "ranked-trailing-fourth": fourth && tags.upset,
    "upset-final": game.state === "final" && tags.upset,
    "acc-kickoff": game.state === "upcoming" && game.timeValid && tags.acc && untilKickoff > 0 && untilKickoff <= 600000,
  };
}
export function transitions(previous: Snapshot | null, game: Game, now: number): AlertEvent[] {
  // Establish a baseline on first observation. Never replay old fourth-quarter or final alerts.
  if (!previous) return [];
  const before = conditions(previous.game, previous.observedAt), after = conditions(game, now);
  return (Object.keys(after) as Trigger[]).filter(trigger => after[trigger] && !before[trigger]).map(trigger => {
    const [away, home] = game.teams;
    const matchup = `${away.name} vs ${home.name}`;
    const score = `${away.abbreviation} ${away.score ?? "–"}, ${home.abbreviation} ${home.score ?? "–"}`;
    const title = trigger === "one-score-fourth" ? "One-score game · 4th quarter" : trigger === "ranked-trailing-fourth" ? "Upset watch · 4th quarter" : trigger === "upset-final" ? "Upset final" : "ACC kickoff in 10 minutes";
    const id = `${game.id}:${trigger}`, day = easternDate(new Date(game.date));
    const body = trigger === "acc-kickoff" ? `${matchup}${game.broadcast ? ` · ${game.broadcast}` : ""}` : `${score}${trigger === "one-score-fourth" ? ` · ${margin(game) === 0 ? "Tied" : `${margin(game)}-point game`}` : ""}`;
    return { id, gameId: game.id, gameDay: day, trigger, createdAt: now, payload: { title, body, eventId: id, url: `/?date=${day}#game-${game.id}` } };
  });
}
export function nextPollAt(games: Game[], now: number) {
  const relevant = games.filter(g => g.state === "live" || g.state === "delayed" || g.state === "upcoming");
  if (relevant.some(g => g.state === "live" || (g.state === "delayed" && g.started) || (Date.parse(g.date) >= now - 7 * 3600000 && Date.parse(g.date) <= now + 20 * 60000))) return now + 60000;
  const next = relevant.map(g => Date.parse(g.date) - 11 * 60000).filter(t => t > now);
  return Math.min(now + 15 * 60000, ...next);
}
