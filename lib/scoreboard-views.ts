import { classify, sortGames, type Scoreboard } from "./football";

export type Filter = "watch" | "acc" | "top25" | "close" | "upset";

// Each badge uses the same scope and visibility rules as its destination tab.
export function viewGames(board: Scoreboard | null, filter: Filter, hideFinals = false, focusedGame = "") {
  return sortGames((board?.games || []).filter(game => {
    if (hideFinals && game.state === "final") return false;
    const categories = classify(game);
    return filter === "watch"
      ? game.id === focusedGame || Object.values(categories).some(Boolean)
      : categories[filter];
  }));
}

export function matchingBoard(board: Scoreboard | null, start: string, end = start) {
  return board?.date === start && (board.endDate || board.date) === end ? board : null;
}
