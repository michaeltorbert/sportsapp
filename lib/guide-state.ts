import { validDate } from "./football";
import { readWeek, weekSearch } from "./app-update";
import type { GuideMode } from "./guide";
// `weekDate` is Scores' chosen Week (#172), carried along for the return to Scores and never read by the Guide.
export type GuideSelection = { date: string | null; view: GuideMode; weekDate?: string | null };
export function parseGuide(search: string): GuideSelection {
  const params = new URLSearchParams(search), date = params.get("date"), weekDate = readWeek(params);
  return { date: date && validDate(date) ? date : null, view: params.get("view") === "watch" ? "watch" : "all", ...(weekDate ? { weekDate } : {}) };
}
export function guideUrl(href: string, selection: GuideSelection) {
  const url = new URL(href);
  if (selection.date) url.searchParams.set("date", selection.date); else url.searchParams.delete("date");
  if (selection.view === "watch") url.searchParams.set("view", "watch"); else url.searchParams.delete("view");
  weekSearch(url, selection.weekDate);
  for (const key of ["tab", "cats", "period", "_ss_update", "_ss_hide_finals", "_ss_focus"]) url.searchParams.delete(key);
  return url.pathname + url.search + url.hash;
}
