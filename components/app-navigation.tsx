import Link from "next/link";
export function AppNavigation({ active, date, followToday }: { active: "scores" | "guide"; date: string; followToday: boolean }) {
  const query = !followToday && date ? `?date=${date}` : "";
  return <nav className="destination-nav" aria-label="Main navigation"><Link href={`/${query}`} aria-current={active === "scores" ? "page" : undefined}>Scores</Link><Link href={`/guide${query}`} aria-current={active === "guide" ? "page" : undefined}>Guide</Link></nav>;
}
