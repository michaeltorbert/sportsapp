import type { Game } from "./football";
import { dukeHidden, dukeStarted, type DukePreferences } from "./duke-visibility";
import type { LeadersPrivacyGame, LeadersSnapshot } from "./leaders-browser";
export function privacyAsGame(g: LeadersPrivacyGame): Game {
  const teams = [...g.teams].sort((a,b) => a.homeAway === "away" ? -1 : b.homeAway === "away" ? 1 : 0).map(t => ({ id: t.id, name: t.name, abbreviation: "", logo: null, conferenceId: null, score: null, rank: null, record: "" })) as Game["teams"];
  return { id: g.id, date: g.date, timeValid: g.timeValid, neutralSite: g.neutralSite, state: g.state === "unknown" ? "other" : g.state, started: g.started === true, status: "", period: 0, clock: 0, teams, broadcast: "", broadcasts: [], possession: null, downDistance: "", redZone: false, url: "" };
}
export function leadersPrivacy(snapshot: LeadersSnapshot, prefs: DukePreferences | null) {
  if (!prefs) return { ready: false, reason: "Checking your Duke settings…", excluded: new Set<string>() };
  if (!snapshot.privacy) return { ready: false, reason: "Season statistics can’t be checked against your Duke settings right now.", excluded: new Set<string>() };
  const excluded = new Set<string>();
  for (const g of snapshot.privacy.games) {
    // Unknown may already contribute; protect both teams regardless of guessed start/venue.
    if (g.state === "unknown") { g.teams.forEach(t => excluded.add(t.id)); continue; }
    const game = privacyAsGame(g);
    if (dukeStarted(game) && dukeHidden(game,prefs)) g.teams.forEach(t => excluded.add(t.id));
  }
  return { ready: true, reason: "", excluded };
}
