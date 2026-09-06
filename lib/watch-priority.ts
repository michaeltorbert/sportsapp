import type { Game } from "./football";
import { ACC, SEC, gameExpectation, teamRank } from "./upset";

function gameMargin(game: Game) {
  const [a, b] = game.teams;
  return a.score === null || b.score === null ? Infinity : Math.abs(a.score - b.score);
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

/** Product weights calibrated by the pairwise scenarios in watch-priority.test.mjs. */
export function gamePriority(game: Game) {
  const stage = urgencyStage(game), margin = gameMargin(game);
  const lopsidedLate = stage >= 3 && Number.isFinite(margin) && margin >= 17;
  const relevance = teamRelevance(game) * (lopsidedLate ? 0.35 : 1);
  const drama = stage * (margin <= 8 ? 6 : margin <= 16 ? 4 : 0) + (stage >= 5 && margin <= 3 ? 4 : 0);
  let upset = 0;
  const expected = gameExpectation(game);
  if (stage && expected && expected.team.score !== null && expected.opponent.score !== null) {
    const difference = expected.team.score - expected.opponent.score;
    const stateWeight = difference < 0 ? 1 : difference <= 3 && stage >= 5 ? 0.5 : 0;
    const rank = teamRank(expected.team), otherRank = teamRank(expected.opponent);
    const rankSignificance = rank === null ? 0 : (rank <= 5 ? 12 : rank <= 10 ? 9 : 6)
      + (otherRank === null && expected.opponent.rankKnown === true ? 8 : otherRank !== null && otherRank - rank >= 10 ? 4 : 0);
    const lineSignificance = expected.spread === null ? 0 : expected.spread >= 14 ? 16 : expected.spread >= 7 ? 12 : 8;
    const significance = Math.min(20, Math.max(rankSignificance, lineSignificance, expected.basis === "conference" ? 8 : 0));
    const stageWeight = stage === 1 ? 0.25 : stage === 2 ? 0.5 : stage === 3 ? 0.75 : 1;
    const marginWeight = margin <= 8 ? 1 : margin <= 16 ? 0.75 : stage >= 3 ? 0.25 : 0.5;
    upset = significance * stateWeight * stageWeight * marginWeight;
  }
  const finishBand = stage === 5 ? game.clock <= 60 ? 3 : game.clock <= 120 ? 2 : 1 : 0;
  return { total: relevance + drama + upset, relevance, drama, upset, stage, finishBand };
}
