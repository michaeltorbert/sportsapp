import Link from "next/link";
import { weekParam } from "@/lib/app-update";
// Both destinations carry Scores' chosen Week (#172); the Guide passes it along without reading it.
export function AppNavigation({ active, date, followToday, weekDate }: { active: "scores" | "guide" | "leaders"; date: string; followToday: boolean; weekDate?: string | null }) {
  const params = new URLSearchParams(), week = weekParam(weekDate);
  if (!followToday && date) params.set("date", date);
  if (week) params.set("weekDate", week);
  const query = params.toString() ? `?${params}` : "";
  return <nav className="destination-nav" aria-label="Main navigation"><Link href={`/${query}`} aria-current={active === "scores" ? "page" : undefined}>Scores</Link><Link href={`/guide${query}`} aria-current={active === "guide" ? "page" : undefined}>Guide</Link><Link href="/leaders?season=2026&category=passing&conference=all&team=all&page=1" aria-current={active === "leaders" ? "page" : undefined}>Leaders</Link></nav>;
}
