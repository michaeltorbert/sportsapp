import { validDate } from "./football";
import { normalizeSelection, type ScoreboardView } from "./scoreboard-views";

export function validCommit(value: unknown): string | null {
  return typeof value === "string" && /^[a-f0-9]{40}$/i.test(value) ? value.toLowerCase() : null;
}
export function metadata(value: unknown): { commit: string; version: string } | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>, commit = validCommit(v.commit);
  return commit && typeof v.version === "string" && v.version.trim() ? { commit, version: v.version } : null;
}
export type Candidate = { commit: string; since: number; confirmed: boolean } | null;
export function observe(current: Candidate, loaded: string, commit: string, now: number): Candidate {
  if (commit === loaded) return null;
  if (current?.commit !== commit) return { commit, since: now, confirmed: false };
  return { ...current, confirmed: current.confirmed || now - current.since >= 10_000 };
}
// Legacy single-tab links keep their meaning: ACC and Top 25 were weekly views,
// the rest daily. An explicit `cats` replaces `tab`; an explicit `period` replaces
// the period a legacy tab implies.
export function initialView(search: string | null): ScoreboardView {
  const params = new URLSearchParams(search || ""), cats = params.get("cats"), period = params.get("period"), tab = params.get("tab");
  const legacy: ScoreboardView = tab === "acc" || tab === "top25" ? { selection: [tab], period: "week" } : tab === "close" || tab === "upset" ? { selection: [tab], period: "day" } : { selection: [], period: "day" };
  return {
    selection: cats === null ? legacy.selection : normalizeSelection(cats.split(",")),
    period: period === null ? (cats === null ? legacy.period : "day") : period === "week" ? "week" : "day",
  };
}
export function viewSearch(url: URL, view: ScoreboardView) {
  url.searchParams.delete("tab");
  if (view.selection.length) url.searchParams.set("cats", normalizeSelection(view.selection).join(",")); else url.searchParams.delete("cats");
  if (view.period === "week") url.searchParams.set("period", "week"); else url.searchParams.delete("period");
}
export function gameId(value: string | null): string {
  return value && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : "";
}
export function updateRestoration(search: string) {
  const p = new URLSearchParams(search), hide = p.get("_ss_hide_finals"), focus = p.get("_ss_focus");
  if (!validCommit(p.get("_ss_update")) || (hide !== "0" && hide !== "1") || (focus !== null && !gameId(focus))) return null;
  return { hideFinals: hide === "1", focusedGame: gameId(focus) };
}
export type ScoresUpdateView = ScoreboardView & { date: string; followToday: boolean; hideFinals: boolean; focusedGame: string };
export type UpdateView = ScoresUpdateView | { page: "guide"; date: string; followToday: boolean; view: "all" | "watch" };
export function refreshUrl(href: string, commit: string, view: UpdateView): string {
  const url = new URL(href), identity = validCommit(commit);
  if (!identity) throw new Error("Invalid update identity");
  if (view.followToday) url.searchParams.delete("date");
  else if (validDate(view.date)) url.searchParams.set("date", view.date);
  else if (!validDate(url.searchParams.get("date") || "")) url.searchParams.delete("date");
  if ("page" in view && view.page === "guide") {
    if (view.view === "watch") url.searchParams.set("view", "watch"); else url.searchParams.delete("view");
    for (const key of ["tab", "cats", "period", "_ss_hide_finals", "_ss_focus"]) url.searchParams.delete(key);
    url.searchParams.set("_ss_update", identity);
    return url.href;
  }
  const scores = view as ScoresUpdateView;
  viewSearch(url, scores);
  url.searchParams.set("_ss_update", identity);
  url.searchParams.set("_ss_hide_finals", scores.hideFinals ? "1" : "0");
  const focus = gameId(scores.focusedGame);
  if (focus) url.searchParams.set("_ss_focus", focus); else url.searchParams.delete("_ss_focus");
  if (/^#game-[A-Za-z0-9_-]+$/.test(url.hash)) url.hash = "";
  return url.href;
}
