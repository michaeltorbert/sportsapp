import { validDate } from "./football";
import type { GuideMode } from "./guide";
export type GuideSelection = { date: string | null; view: GuideMode };
export function parseGuide(search: string): GuideSelection {
  const params = new URLSearchParams(search), date = params.get("date");
  return { date: date && validDate(date) ? date : null, view: params.get("view") === "watch" ? "watch" : "all" };
}
export function guideUrl(href: string, selection: GuideSelection) {
  const url = new URL(href);
  if (selection.date) url.searchParams.set("date", selection.date); else url.searchParams.delete("date");
  if (selection.view === "watch") url.searchParams.set("view", "watch"); else url.searchParams.delete("view");
  for (const key of ["tab", "_ss_update", "_ss_hide_finals", "_ss_focus"]) url.searchParams.delete(key);
  return url.pathname + url.search + url.hash;
}
