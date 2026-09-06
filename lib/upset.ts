import type { Game, Team } from "./football";

export const ACC = "1";
export const SEC = "8";
// ESPN FBS conference IDs; independents and unknown IDs are deliberately absent.
const OTHER_FBS_CONFERENCES = new Set(["151", "12", "15", "17", "37"]);
export type Expectation = { team: Team; opponent: Team; basis: "line" | "rank" | "conference"; spread: number | null };

export function teamRank(team: Team) {
  return team.rankKnown !== false && team.rank !== null && Number.isInteger(team.rank) && team.rank >= 1 && team.rank <= 25 ? team.rank : null;
}
export function preferredConference(team: Team) { return team.conferenceId === ACC || team.conferenceId === SEC; }

/** Pregame lines take precedence over rank; a pick'em supplies no favorite. */
export function gameExpectation(game: Game): Expectation | null {
  const [a, b] = game.teams, line = game.pregameLine;
  if (line) {
    if (line.favoriteId === null && line.spread === 0) return null;
    const favorite = game.teams.find(t => t.id === line.favoriteId);
    if (favorite && Number.isFinite(line.spread) && line.spread > 0) {
      if (!preferredConference(favorite) && !game.teams.some(t => teamRank(t) !== null)) return null;
      return { team: favorite, opponent: favorite === a ? b : a, basis: "line", spread: line.spread };
    }
  }
  const ar = teamRank(a), br = teamRank(b);
  if ((a.rankKnown !== true && ar === null) || (b.rankKnown !== true && br === null)) return null;
  if (ar !== null && (br === null || ar < br)) return { team: a, opponent: b, basis: "rank", spread: null };
  if (br !== null && (ar === null || br < ar)) return { team: b, opponent: a, basis: "rank", spread: null };
  // A conference watch is not a claimed betting favorite.
  if (ar !== null || br !== null || a.rankKnown !== true || b.rankKnown !== true) return null;
  for (const [team, opponent] of [[a, b], [b, a]]) {
    if (preferredConference(team) && opponent.conferenceId !== null && OTHER_FBS_CONFERENCES.has(opponent.conferenceId))
      return { team, opponent, basis: "conference", spread: null };
  }
  return null;
}

export function upsetWatch(game: Game) {
  if (game.state !== "live" && game.state !== "final") return null;
  const expected = gameExpectation(game);
  return expected && expected.team.score !== null && expected.opponent.score !== null && expected.team.score < expected.opponent.score ? expected : null;
}

/** Preserve the original notification contract independently of watchlist tuning. */
export function rankedUpset(game: Game) {
  if (game.state !== "live" && game.state !== "final") return false;
  const [a, b] = game.teams;
  if (a.score === null || b.score === null || a.score === b.score || a.rankKnown === false || b.rankKnown === false) return false;
  const leader = a.score > b.score ? a : b, trailer = leader === a ? b : a;
  const rank = teamRank(trailer), leaderRank = teamRank(leader);
  return rank !== null && (leaderRank === null || leaderRank > rank);
}

export function upsetExplanation(game: Game) {
  const watch = upsetWatch(game);
  if (!watch) return null;
  const rank = teamRank(watch.team);
  const team = rank === null ? watch.team.name : `No. ${rank} ${watch.team.name}`;
  const action = game.state === "final" ? "beat" : "leads";
  const context = watch.basis === "line" ? "pregame favorite" : watch.basis === "conference" ? `${watch.team.conferenceId === SEC ? "SEC" : "ACC"} conference watch` : "rank-based upset";
  return `${watch.opponent.name} ${action} ${team} · ${context}`;
}
