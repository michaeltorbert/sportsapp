import type { Game, Team } from "./football";
import { teamRank } from "./upset";

// NCAA's 2026 Power Four / Group of Six taxonomy, mapped to ESPN group IDs.
// This is relevance evidence, not a favorite or conference-watch inference.
const POWER_FOUR = new Set(["1", "4", "5", "8"]);
const GROUP_OF_SIX = new Set(["151", "12", "15", "17", "9", "37"]);
export function isPowerFour(team: Team) {
  return team.conferenceId !== null && POWER_FOUR.has(team.conferenceId);
}
export function twoUnrankedGroupOfSix(game: Game) {
  return game.teams.every(team => team.conferenceId !== null && GROUP_OF_SIX.has(team.conferenceId)
    && team.rankKnown === true && teamRank(team) === null);
}
