import { classify, sortGames, type Game, type Scoreboard } from "./football";

export type Category = "acc" | "top25" | "close" | "upset";
export const categories: readonly Category[] = ["acc", "top25", "close", "upset"];
// Independently toggled categories in canonical order. An empty selection is
// All: the complete curated watchlist (ORD-011).
export type Selection = readonly Category[];
export type Period = "day" | "week";
export type BoardScope = "daily" | "week";
export type ScoreboardView = { selection: Selection; period: Period };

export function scoreboardScope(period: Period): BoardScope {
  return period === "week" ? "week" : "daily";
}

export function isCategory(value: unknown): value is Category {
  return typeof value === "string" && (categories as readonly string[]).includes(value);
}

// Unknown tokens are dropped and duplicates collapse; nothing valid means All.
export function normalizeSelection(values: Iterable<unknown>): Selection {
  const chosen = new Set<Category>();
  for (const value of values) if (isCategory(value)) chosen.add(value);
  return categories.filter(category => chosen.has(category));
}

// Turning the last selected category off restores All; turning one on from All
// selects it alone. Four manually selected categories stay selected, not All.
export function toggleCategory(selection: Selection, category: Category): Selection {
  return normalizeSelection(selection.includes(category) ? selection.filter(c => c !== category) : [...selection, category]);
}

export function matchesSelection(game: Game, selection: Selection, focusedGame = "") {
  const tags = classify(game);
  // The focused-game exception applies to All only; each category shows what it names.
  return selection.length === 0 ? game.id === focusedGame || categories.some(c => tags[c]) : selection.some(c => tags[c]);
}

// Selected categories combine with OR; each game appears once and sorting never
// sees the selection, so matching several categories adds no priority.
export function viewGames(board: Scoreboard | null, selection: Selection, hideFinals = false, focusedGame = "") {
  return sortGames((board?.games || []).filter(game => !(hideFinals && game.state === "final") && matchesSelection(game, selection, focusedGame)));
}

export function matchingBoard(board: Scoreboard | null, start: string, end = start) {
  return board?.date === start && (board.endDate || board.date) === end ? board : null;
}

// The weekly board is stored under `week:`; `top25:` is the pre-1.9 name for the same
// full-FBS weekly feed, and unprefixed weekly keys were the retired ACC-only feed.
export function boardKey(scope: BoardScope, start: string, end: string, legacy = false) {
  return `ss:board:${scope === "week" ? (legacy ? "top25:" : "week:") : ""}${start}:${end}`;
}

export function expiredBoardKey(key: string, oldestDate: string) {
  const range = /^ss:board:(?:top25:|week:)?(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/.exec(key);
  // A weekly board is still useful after its start date has passed.
  return !!range && range[2] < oldestDate;
}
