import type { Game, Team } from "../../lib/football";
import { alertText } from "./rules";

// Issue #103 device sample. Every value is a fixed synthetic fixture, never a
// live game: no game ID, score lookup, event row or game link is involved.
// The names are the saved ESPN feed's normalized names for teams 98 and 324,
// as a real alert shows them; the matchup, ranks and scores are made up.
const team = (id: string, name: string, rank: number, score: number): Team => ({ id, name, abbreviation: id, logo: null, score, rank, rankKnown: true, record: "", conferenceId: null });
const fixture: Game = {
  id: "sample", date: "2026-01-01T00:00:00Z", timeValid: true, state: "live", status: "4th", period: 4, clock: 0, started: true,
  teams: [team("sample-away", "Western KY", 21, 24), team("sample-home", "Coastal", 4, 27)],
  broadcast: "", possession: null, downDistance: "", redZone: false, url: "",
};
// Built once through the production formatter so its lines match a real one-score alert.
const text = alertText(fixture, "one-score-fourth");
export const SAMPLE_KIND = "one-score";
export const sampleText = Object.freeze({ title: `SAMPLE · ${text.title}`, body: text.body });
export function samplePayload(testId: string, origin: string) {
  return { title: sampleText.title, body: sampleText.body, eventId: `test:${testId}`, url: `${origin}/` };
}
