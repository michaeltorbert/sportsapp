import type { Game } from "./football";
import { ACC, SEC, gameExpectation, teamRank } from "./upset";

function gameMargin(game: Game) {
  const [a, b] = game.teams;
  return a.score === null || b.score === null ? Infinity : Math.abs(a.score - b.score);
}

// Verified ESPN college-football team IDs; display-name changes must not unpin them.
export function isPinnedGame(game: Game) {
  return game.teams.some(team => team.id === "150" || team.id === "259");
}

export function teamRelevance(game: Game) {
  const acc = game.teams.filter(t => t.conferenceId === ACC).length;
  const ranks = game.teams.map(teamRank).filter((r): r is number => r !== null);
  const best = ranks.length ? Math.min(...ranks) : Infinity;
  return Math.min(50, (acc ? 20 : 0) + (acc === 2 ? 2 : 0)
    + (game.teams.some(t => t.conferenceId === SEC) ? 4 : 0)
    + (best <= 5 ? 30 : best <= 10 ? 26 : best <= 25 ? 14 : 0)
    + (ranks.length === 2 ? 4 : 0));
}

export function urgencyStage(game: Game) {
  if (game.state !== "live" || !game.started || !Number.isInteger(game.period)) return 0;
  if (game.period > 4) return 6;
  if (game.period === 4) return game.clockKnown === true && !game.intermission && game.clock >= 0 && game.clock <= 300 ? 5 : 4;
  return game.period >= 1 && game.period <= 3 ? game.period : 0;
}

// Quarter-end intermissions and the following kickoff share the same elapsed time.
// Without a trustworthy clock, use the start of the reported quarter.
function elapsedQuarters(game: Game, stage: number) {
  if (!stage) return 0;
  if (game.period > 4) return 4;
  const elapsed = game.intermission ? 1
    : game.clockKnown === true && Number.isFinite(game.clock) && game.clock >= 0 && game.clock <= 900
      ? 1 - game.clock / 900 : 0;
  return game.period - 1 + elapsed;
}

/** Product weights calibrated by the pairwise scenarios in watch-priority.test.mjs. */
export function gamePriority(game: Game) {
  const stage = urgencyStage(game), margin = gameMargin(game);
  // Beyond one score, taper relevance toward 35% over 22 points at kickoff,
  // narrowing to 14 points at regulation's end. Missing scores are not blowouts.
  const elapsed = elapsedQuarters(game, stage);
  const taperWidth = 22 - 2 * elapsed;
  const comfort = Number.isFinite(margin) ? Math.min(1, Math.max(0, margin - 8) / taperWidth) : 0;
  const relevance = teamRelevance(game) * (1 - 0.65 * comfort);
  // A multi-score lead offers less drama as comeback time runs out.
  const dramaCutoff = 20 - 2 * Math.max(0, elapsed - 2);
  const drama = Number.isFinite(margin)
    ? stage * 6 * Math.min(1, Math.max(0, (dramaCutoff - margin) / (dramaCutoff - 8))) + (stage >= 5 && margin <= 3 ? 4 : 0)
    : 0;
  let upset = 0;
  const expected = gameExpectation(game);
  if (stage && expected && expected.team.score !== null && expected.opponent.score !== null) {
    const difference = expected.team.score - expected.opponent.score;
    const rank = teamRank(expected.team), otherRank = teamRank(expected.opponent);
    // A ranked favorite tying remains compelling, below a comparable active upset.
    const stateWeight = difference < 0 ? 1 : difference === 0 && rank !== null ? 0.75
      : difference <= 3 && stage >= 5 ? 0.5 : 0;
    const rankSignificance = rank === null ? 0 : (rank <= 5 ? 12 : rank <= 10 ? 9 : 6)
      + (otherRank === null && expected.opponent.rankKnown === true ? 8 : otherRank !== null && otherRank - rank >= 10 ? 4 : 0);
    const lineSignificance = expected.spread === null ? 0 : expected.spread >= 14 ? 16 : expected.spread >= 7 ? 12 : 8;
    const significance = Math.min(20, Math.max(rankSignificance, lineSignificance, expected.basis === "conference" ? 8 : 0));
    const stageWeight = stage === 1 ? 0.25 : stage === 2 ? 0.5 : stage === 3 ? 0.75 : 1;
    const marginWeight = margin <= 8 ? 1 : margin <= 16 ? 0.75 : stage >= 3 ? 0.25 : 0.5;
    // Rank-based interest follows the state weight: full when trailing, most
    // retained on a tie, and half for a narrow lead only during a late finish.
    // Stage and margin scaling still limit early deficits and blowouts.
    const rankedInterest = rank !== null ? 24 * (1 - comfort) : 0;
    upset = (significance + rankedInterest) * stateWeight * stageWeight * marginWeight;
  }
  const finishBand = stage === 5 ? game.clock <= 60 ? 3 : game.clock <= 120 ? 2 : 1 : 0;
  return { total: relevance + drama + upset, relevance, drama, upset, stage, finishBand };
}
