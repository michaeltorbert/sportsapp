import { validDate } from "./football";
import type { Filter } from "./scoreboard-views";

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
export function initialTab(search: string | null): Filter {
  const tab = new URLSearchParams(search || "").get("tab");
  return tab === "acc" || tab === "top25" || tab === "close" || tab === "upset" ? tab : "watch";
}
export function gameId(value: string | null): string {
  return value && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : "";
}
export function updateRestoration(search: string) {
  const p = new URLSearchParams(search), hide = p.get("_ss_hide_finals"), focus = p.get("_ss_focus");
  if (!validCommit(p.get("_ss_update")) || (hide !== "0" && hide !== "1") || (focus !== null && !gameId(focus))) return null;
  return { hideFinals: hide === "1", focusedGame: gameId(focus) };
}
export type UpdateView = { date: string; followToday: boolean; filter: Filter; hideFinals: boolean; focusedGame: string };
export function refreshUrl(href: string, commit: string, view: UpdateView): string {
  const url = new URL(href), identity = validCommit(commit);
  if (!identity) throw new Error("Invalid update identity");
  if (view.followToday) url.searchParams.delete("date");
  else if (validDate(view.date)) url.searchParams.set("date", view.date);
  else if (!validDate(url.searchParams.get("date") || "")) url.searchParams.delete("date");
  url.searchParams.set("tab", initialTab(`?tab=${view.filter}`));
  url.searchParams.set("_ss_update", identity);
  url.searchParams.set("_ss_hide_finals", view.hideFinals ? "1" : "0");
  const focus = gameId(view.focusedGame);
  if (focus) url.searchParams.set("_ss_focus", focus); else url.searchParams.delete("_ss_focus");
  if (/^#game-[A-Za-z0-9_-]+$/.test(url.hash)) url.hash = "";
  return url.href;
}
