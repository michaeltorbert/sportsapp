import type { Game, AlertExpectation } from "../../lib/football";
import { teamRank } from "../../lib/upset";

// Product policy, not measured predictive thresholds.
export const MIN_UPSET_SPREAD = 7;
export const MIN_UPSET_RANK_GAP = 10;
export function retainExpectation(game: Game, previous: Game | undefined, now: number): Game {
  const matches = previous?.id === game.id && previous.date === game.date && previous.teams.every((team, i) => team.id === game.teams[i].id);
  const saved = matches ? previous?.alertExpectation : undefined;
  const oldLine = matches && !previous?.started ? previous?.pregameLine : undefined;
  let evidence = saved;
  if (!previous?.started || !matches) {
    const unstarted = !game.started && (game.state === "upcoming" || game.state === "delayed");
    const line = unstarted ? game.pregameLine || oldLine : oldLine;
    if (unstarted && game.pregameEvidenceInvalid) evidence = { version: 1, gameId: game.id, teamIds: game.teams.map(t => t.id) as [string, string], date: game.date, observedAt: now, state: "invalid" };
    else if (line) evidence = { version: 1, gameId: game.id, teamIds: game.teams.map(t => t.id) as [string, string], date: game.date, observedAt: now, state: line.favoriteId === null ? "pickem" : "line", line };
  }
  if (!evidence) evidence = { version: 1, gameId: game.id, teamIds: game.teams.map(t => t.id) as [string, string], date: game.date, observedAt: now, state: "absent" };
  return { ...game, alertExpectation: evidence };
}
export function meaningfulUpset(game: Game) {
  const [a, b] = game.teams;
  if (!game.teams.every(t => typeof t.score === "number" && Number.isFinite(t.score) && t.score >= 0)) return false;
  const evidence: AlertExpectation | undefined = game.alertExpectation;
  if (evidence && (evidence.gameId !== game.id || evidence.date !== game.date || evidence.teamIds.some((id, i) => id !== game.teams[i].id))) return false;
  if (evidence?.state === "invalid" || evidence?.state === "pickem") return false;
  let favorite;
  if (evidence?.state === "line") {
    const line = evidence.line;
    if (!line || !Number.isFinite(line.spread) || line.spread < MIN_UPSET_SPREAD) return false;
    favorite = game.teams.find(t => t.id === line.favoriteId && t.rankKnown === true && teamRank(t) !== null);
  } else {
    if (!game.teams.every(t => t.rankKnown === true && (t.rank === null || teamRank(t) !== null))) return false;
    const ar = teamRank(a), br = teamRank(b);
    if (ar !== null && (br === null || br - ar >= MIN_UPSET_RANK_GAP)) favorite = a;
    else if (br !== null && (ar === null || ar - br >= MIN_UPSET_RANK_GAP)) favorite = b;
  }
  if (!favorite) return false;
  const underdog = favorite === a ? b : a;
  return underdog.score! >= favorite.score! - 8;
}
