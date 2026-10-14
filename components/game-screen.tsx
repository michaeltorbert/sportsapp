"use client";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { ArrowUpRight, ChevronLeft, CloudOff, Signal, TriangleAlert, Tv, Zap } from "lucide-react";
import { classify, type Game, type Scoreboard, type Team } from "@/lib/football";
import { upsetExplanation, upsetWatch } from "@/lib/upset";
import { PLAYER_CATEGORIES, type PlayerCategory } from "@/lib/game-stats";
import type { Section } from "@/lib/game-route";
import { HalftimeStatus } from "@/components/halftime-status";
// Relative so page tests bundle the real stats view.
import { GameStatsScreen } from "./game-stats";

// A validated line sits on the scoreboard row before kickoff and in game details once play starts.
// Canceled, postponed, forfeited and no-contest games omit it: it priced a game not played as scheduled.
export function linePlacement(game: Game) { return game.state === "other" ? null : !game.started && game.state !== "live" && game.state !== "final" ? "summary" : "details"; }
export function points(spread: number) { return `${spread} ${spread === 1 ? "point" : "points"}`; }
function localTime(date: string) { return Number.isFinite(Date.parse(date)) ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(date)) : "Time TBD"; }
const label = (team: Team) => team.abbreviation || team.name;
// The game's own Eastern calendar day, in the scoreboard's game-day-label format. Omitted, never guessed, when invalid.
let dayFormat: Intl.DateTimeFormat | undefined;
export function gameDay(date: string) {
  if (!Number.isFinite(Date.parse(date))) return null;
  dayFormat ??= new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/New_York" });
  return dayFormat.format(new Date(date));
}

function MastLogo({ team }: { team: Team }) {
  const [failed, setFailed] = useState(false);
  // Real logos keep the scoreboard's light tile so dark marks stay legible; the fallback is the abbreviation.
  return <span className={`mh-logo ${team.logo && !failed ? "has-image" : ""}`}>{team.logo && !failed ? <img src={team.logo} width="40" height="40" alt="" onError={() => setFailed(true)} /> : <span>{label(team).slice(0, 4)}</span>}</span>;
}
function Masthead({ game, board, scopeError }: { game: Game; board: Scoreboard | null; scopeError: boolean }) {
  const [away, home] = game.teams, started = game.started;
  const leads = (team: Team, other: Team) => team.score !== null && other.score !== null && team.score > other.score;
  const score = (team: Team) => started && team.score !== null ? team.score : "–";
  const status = game.state === "live" ? <span className="mh-state live"><span className="live-dot" aria-hidden="true" />{game.halftime && board ? <HalftimeStatus game={game} board={board} scopeError={scopeError} /> : game.status}</span>
    : game.state === "delayed" ? <span className="mh-state delayed"><TriangleAlert size={15} aria-hidden="true" />{game.status}</span>
    : <span className="mh-state">{game.state === "upcoming" && game.timeValid ? `Kickoff ${localTime(game.date)}` : game.status}</span>;
  const team = (t: Team, side: "away" | "home") => <div className={`mh-team ${side}`}>
    <MastLogo team={t} />
    <span className="mh-text"><span className="mh-name">{t.rank !== null && <span className="rank">{t.rank}</span>}{t.name}{game.possession === t.id && game.state === "live" && <span className="possession">◆</span>}</span><span className="mh-meta">{t.record ? `${t.record} · ` : ""}{side === "away" ? "Away" : "Home"}</span></span>
  </div>;
  const spoken = [away, home].map(t => `${t.rank !== null ? `No. ${t.rank} ` : ""}${t.name}${t.record ? `, ${t.record}` : ""}, ${started && t.score !== null ? t.score : "no score yet"}`).join("; ")
    + "." + (game.state === "live" && game.possession === away.id ? ` ${away.name} has possession.` : game.state === "live" && game.possession === home.id ? ` ${home.name} has possession.` : "");
  // Situation, line and upset context keep their scoreboard wording.
  const line = game.pregameLine, placement = linePlacement(game);
  const favorite = line?.favoriteId === away.id ? away : line?.favoriteId === home.id ? home : null;
  const validLine = placement !== null && line && ((line.favoriteId === null && line.spread === 0) || (favorite && line.spread > 0));
  const result = classify({ ...game, retainedCategories: undefined });
  return <section className={`masthead state-${game.state}`} id="masthead" aria-label="Score">
    <div className="mh-status">{gameDay(game.date) && <span className="mh-date">{gameDay(game.date)}</span>}{status}{game.broadcast && <span className="mh-broadcast"><Tv size={14} aria-hidden="true" />{game.broadcast}</span>}</div>
    <p className="sr-only">{spoken}</p>
    <div className={`mh-grid ${started ? "" : "unstarted"}`} aria-hidden="true">
      {team(away, "away")}
      {started ? <>
        <span className={`mh-score away ${leads(away, home) ? "leading" : ""} ${away.changed ? "score-changed" : ""}`}>{score(away)}</span>
        <span className="mh-dash">–</span>
        <span className={`mh-score home ${leads(home, away) ? "leading" : ""} ${home.changed ? "score-changed" : ""}`}>{score(home)}</span>
      </> : <span className="mh-vs">at</span>}
      {team(home, "home")}
    </div>
    {game.state === "live" && game.downDistance && <div className="mh-situation"><p className={`drive ${game.redZone ? "red-zone" : ""}`}>{game.redZone && <span>RED ZONE</span>}{game.downDistance}</p></div>}
    {game.state === "delayed" && <div className="mh-situation"><p className="delay-note">{game.started ? "Play paused. Watching for an update." : "Kickoff delayed. Watching for an update."}</p></div>}
    {/* The user asked for the line without its bookmaker here; the source still gates which lines are valid. */}
    {validLine && <p className="detail-line"><span className="sr-only">{favorite ? `Pregame betting line: ${favorite.name} favored by ${points(line.spread)}` : "Pregame pick’em line"}</span><span aria-hidden="true">Line</span><strong aria-hidden="true">{favorite ? `${favorite.name} −${line.spread}` : "PK"}</strong></p>}
    {result.upset && <p className="upset-reason"><Zap size={14} fill="currentColor" aria-hidden="true" /><span>{upsetExplanation(game)}</span></p>}
  </section>;
}
function Context({ game }: { game: Game }) {
  const tags = classify(game), [away, home] = game.teams, watch = upsetWatch(game);
  const margin = away.score !== null && home.score !== null ? Math.abs(away.score - home.score) : null;
  const upsetLabel = watch?.basis === "conference" ? "Conference watch" : game.state === "final" ? "Upset final" : "Upset watch";
  return <div className="game-context">
    <div className="badges">{tags.acc && <span className="badge acc-badge">ACC</span>}{tags.top25 && <span className="badge top25-badge">Top 25</span>}{tags.close && <span className="badge close-badge">{margin === 0 ? "Tied" : margin !== null && margin <= 8 ? `${margin}-point game` : "One-score watch"}</span>}{tags.upset && <span className="badge upset-badge">{upsetLabel}</span>}</div>
    <a href={game.url} target="_blank" rel="noopener noreferrer" className="gamecast" data-focus-key="gamecast" aria-label={`Open ${away.name} vs ${home.name} on ESPN`}>Gamecast<ArrowUpRight size={15} aria-hidden="true" /></a>
  </div>;
}

type Layout = { compact: boolean; wide: boolean; stick: boolean };
// The approved side-by-side score header is used whenever every full name, record and score fits
// inside it; otherwise the header stacks into rows. Measured rather than a breakpoint, because
// name length, text size and zoom all decide it. The attribute is set only here, never by React.
function fitMasthead(root: HTMLElement | null, compact: boolean) {
  const mast = root?.querySelector<HTMLElement>(".masthead");
  if (!mast) return;
  mast.removeAttribute("data-stacked");
  let stack = compact;
  if (!stack) {
    const edge = mast.getBoundingClientRect();
    stack = [...mast.querySelectorAll<HTMLElement>(".mh-grid > *, .mh-name, .mh-meta")].some(el => {
      // A name or record must stay within its own team column (never under a score) and the header.
      const box = el.getBoundingClientRect(), column = (el.closest(".mh-team") ?? mast).getBoundingClientRect();
      return el.scrollWidth > el.clientWidth + 1 || box.left < Math.max(edge.left, column.left) - 1 || box.right > Math.min(edge.right, column.right) + 1;
    });
  }
  if (stack) mast.setAttribute("data-stacked", "");
}
function zoomOf(element: Element | null) { const z = element ? parseFloat(getComputedStyle(element).zoom) : 1; return z > 0 ? z : 1; }
// Layout follows the space actually available: CSS zoom shrinks the room for content without
// changing what width/height media queries see, so these use the viewport divided by the zoom.
// Only the slim bar and section navigation stick, and only with at least 600 CSS px of height
// and the two bars together taking no more than a third of the viewport.
function useLayout(root: RefObject<HTMLDivElement | null>, id: string | undefined) {
  const [layout, setLayout] = useState<Layout>({ compact: false, wide: false, stick: false });
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const measure = () => {
      const z = zoomOf(document.documentElement) * zoomOf(document.body), width = innerWidth / z, height = innerHeight / z;
      const bar = element.querySelector<HTMLElement>(".game-bar"), nav = element.querySelector<HTMLElement>(".view-nav");
      if (bar) element.style.setProperty("--bar-h", `${bar.offsetHeight}px`);
      const used = (bar?.getBoundingClientRect().height || 0) + (nav?.getBoundingClientRect().height || 0);
      const next = { compact: width < 360, wide: width >= 880, stick: height >= 600 && used <= innerHeight / 3 };
      setLayout(previous => previous.compact === next.compact && previous.wide === next.wide && previous.stick === next.stick ? previous : next);
      return next;
    };
    let frame = 0;
    const resized = () => fitMasthead(element, measure().compact);
    // A CSS zoom or text-size change fires no resize event but does resize these boxes. The header is
    // refit on the next frame, outside observer delivery, so its own change cannot loop the observer.
    const observed = () => { const { compact } = measure(); cancelAnimationFrame(frame); frame = requestAnimationFrame(() => fitMasthead(element, compact)); };
    resized();
    addEventListener("resize", resized);
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(observed) : null;
    for (const target of [document.documentElement, element.querySelector(".game-bar"), element.querySelector(".view-nav")]) if (target) observer?.observe(target);
    return () => { removeEventListener("resize", resized); observer?.disconnect(); cancelAnimationFrame(frame); };
  }, [root, id]);
  // Every render (a score or name change) refits synchronously, before paint.
  useLayoutEffect(() => fitMasthead(root.current, layout.compact));
  return layout;
}

export type GameScreenProps = {
  game: Game | null; loading: boolean; board: Scoreboard | null; scopeError: boolean; backLabel: string;
  section: Section; onSection: (section: Section) => void; onBack: () => void;
  warning?: string; onRetryScores?: () => void; refreshing?: boolean; notice?: ReactNode;
};
/** The dedicated game screen. It renders nothing about a game until that game is eligible on the protected boards. */
export function GameScreen({ game, loading, board, scopeError, backLabel, section, onSection, onBack, warning, onRetryScores, refreshing = false, notice }: GameScreenProps) {
  const root = useRef<HTMLDivElement>(null);
  const id = game?.id;
  const layout = useLayout(root, id);
  const [condensed, setCondensed] = useState(false);
  const [jump, setJump] = useState<PlayerCategory>("passing");
  const change = useRef<{ focus: boolean } | null>(null);
  const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const stickyOffset = () => {
    let offset = 0;
    for (const selector of [".game-bar", ".view-nav"]) { const el = root.current?.querySelector<HTMLElement>(selector); if (el && getComputedStyle(el).position === "sticky") offset += el.offsetHeight; }
    return offset;
  };
  // The bar condenses to the score once the masthead scrolls away under it.
  useEffect(() => {
    const mast = root.current?.querySelector("#masthead"), bar = root.current?.querySelector<HTMLElement>(".game-bar");
    if (!mast || !bar || typeof IntersectionObserver !== "function") return;
    const observer = new IntersectionObserver(([entry]) => setCondensed(!entry.isIntersecting && entry.boundingClientRect.top < 0), { rootMargin: `-${Math.round(bar.offsetHeight)}px 0px 0px 0px` });
    observer.observe(mast);
    return () => { observer.disconnect(); setCondensed(false); };
  }, [id]);
  // Scroll-spy: the jump link for the category under the sticky bars is current.
  useEffect(() => {
    if (section !== "players" || !id) return;
    let frame = 0;
    const spy = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!root.current?.querySelector("[data-jump]")) return;
        const line = stickyOffset() + 24;
        let current: PlayerCategory = "passing";
        for (const c of PLAYER_CATEGORIES) { const el = document.getElementById(`cat-${c}`); if (el && el.getBoundingClientRect().top <= line) current = c; }
        // At the end of the document the last category is current even if its heading cannot reach the line.
        const last = document.getElementById("cat-receiving");
        if (innerHeight + scrollY >= document.documentElement.scrollHeight - 2 && last && last.getBoundingClientRect().top < innerHeight) current = "receiving";
        setJump(current);
      });
    };
    addEventListener("scroll", spy, { passive: true });
    return () => { removeEventListener("scroll", spy); cancelAnimationFrame(frame); };
  }, [section, id]);
  // Switching sections keeps the section navigation in place: if it is stuck, the new section starts just under it.
  useLayoutEffect(() => {
    const pending = change.current;
    if (!pending) return;
    change.current = null;
    setJump("passing");
    const nav = root.current?.querySelector<HTMLElement>(".view-nav"), context = root.current?.querySelector(".game-context"), bar = root.current?.querySelector<HTMLElement>(".game-bar");
    if (nav && context && getComputedStyle(nav).position === "sticky") {
      const top = context.getBoundingClientRect().bottom + scrollY - (bar?.offsetHeight || 0);
      if (scrollY > top) scrollTo(0, top);
    }
    if (pending.focus) document.getElementById(section === "players" ? "players-h" : "team-h")?.focus({ preventScroll: true });
  }, [section]);
  const changeSection = (next: Section, focusHeading = false) => {
    if (next === section) { if (focusHeading) document.getElementById(next === "players" ? "players-h" : "team-h")?.focus({ preventScroll: true }); return; }
    change.current = { focus: focusHeading };
    onSection(next);
  };
  const toCategory = (category: PlayerCategory) => {
    const target = document.getElementById(`cat-${category}`);
    if (target) {
      scrollTo({ top: Math.max(0, target.getBoundingClientRect().top + scrollY - stickyOffset() - 10), behavior: reduceMotion() ? "auto" : "smooth" });
      document.getElementById(`cat-${category}-h`)?.focus({ preventScroll: true });
    }
    setJump(category);
  };

  const classes = `game-screen ${layout.compact ? "is-compact" : ""} ${layout.wide ? "is-wide" : ""} ${layout.stick ? "can-stick" : ""}`;
  const back = <button type="button" className="back-button" data-focus-key="back" aria-label={`Back to scores, ${backLabel}`} onClick={onBack}><ChevronLeft size={22} aria-hidden="true" /><span className="back-text" aria-hidden="true"><span>Scores</span><small>{backLabel}</small></span></button>;
  const brand = <span className="bar-brand" aria-hidden="true"><span className="brand-icon"><Signal size={17} strokeWidth={3} /></span></span>;
  let content: ReactNode;
  if (!game) {
    // Unknown, not yet loaded and privacy-hidden games share this generic output: no teams, score, title or stats work.
    content = <>
      <header className="game-bar">{back}<h1 className="game-title" tabIndex={-1}>{loading ? "Loading game" : "Game unavailable"}</h1>{brand}</header>
      {notice}
      <div className="game-body">{loading
        ? <div className="stats-loading unavailable" role="status"><p>Loading game…</p></div>
        : <div className="stats-empty unavailable"><h2>This game isn’t available</h2><p>It isn’t on the scoreboard, or it’s hidden by your settings.</p><button type="button" className="notice-button" data-focus-key="back-2" onClick={onBack}>Back to scores</button></div>}</div>
    </>;
  } else {
    const [away, home] = game.teams, scored = game.started && away.score !== null && home.score !== null;
    content = <>
      <header className={`game-bar ${condensed ? "condensed" : ""}`}>
        {back}
        <h1 className={`game-title ${scored ? "has-score" : ""}`} tabIndex={-1}>
          <span className="title-plain" aria-hidden="true">{label(away)} <i>at</i> {label(home)}</span>
          {scored && <span className="title-score" aria-hidden="true">{label(away)} <b>{away.score}</b><i>–</i><b>{home.score}</b> {label(home)}</span>}
          <span className="sr-only">{away.name} at {home.name}</span>
        </h1>
        {brand}
      </header>
      <Masthead game={game} board={board} scopeError={scopeError} />
      <Context game={game} />
      {notice}
      {warning && <div className="feed-banner game-feed" role="alert"><CloudOff size={18} aria-hidden="true" /><span>{warning} Displayed scores may be out of date.</span>{onRetryScores && <button type="button" onClick={onRetryScores} disabled={refreshing}>Retry</button>}</div>}
      <GameStatsScreen key={game.id} game={game} section={section} onSection={changeSection} jump={jump} onJump={toCategory} />
    </>;
  }
  return <div ref={root} className={classes.replace(/\s+/g, " ").trim()}>{content}</div>;
}
