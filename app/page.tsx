"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, CalendarDays, ChevronLeft, ChevronRight, CircleHelp, CloudOff, Radio, RefreshCw, Signal, TriangleAlert, Tv, Zap } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Sheet, SheetTrigger } from "@/components/ui/sheet";
import { AppPanelContent } from "@/components/app-panel";
import { useScoreboard } from "@/lib/use-scoreboard";
import { upsetWatch } from "@/lib/upset";
import { VERSION, releases } from "@/lib/releases";
import { HalftimeStatus } from "@/components/halftime-status";
import { Alerts } from "@/components/alerts";
import { accWeek, classify, easternDate, shiftDate, validDate, type Game, type Scoreboard, type Team } from "@/lib/football";
import { categories, categoryCounts, scoreboardScope, toggleCategory, upsetCounts, viewGames, type Category, type CategoryCounts, type Period, type Selection } from "@/lib/scoreboard-views";

import { initialView, updateRestoration, gameId } from "@/lib/app-update";
import { boardUrl, createRouteHistory, gameHref, gameUrl, newKey, parseGameRoute, parseTeamRoute, readEntry, sectionUrl, teamHref, teamParam, teamUrl, type BoardSnapshot, type BoardView, type GameRoute, type RouteHistory, type Section, type Traversal } from "@/lib/game-route";
import { useInitialSearch } from "@/lib/browser-state";
import { useAppUpdate, LOADED_COMMIT, type AppUpdate } from "@/lib/use-app-update";
import { DukeSettings, DukeGameControls } from "@/components/duke-settings";
import { useDukeVisibility } from "@/lib/use-duke-visibility";
import { dukeHidden, protectDukeBoard } from "@/lib/duke-visibility";
import { findScheduleGame, withBoardGames } from "@/lib/team-season";
import { useTeamSeason } from "@/lib/use-team-season";
import { AppNavigation } from "@/components/app-navigation";
import { AppUpdateNotice } from "@/components/app-update";
// Relative so page tests bundle the real game screen and its stats view.
import { GameScreen, linePlacement, points } from "../components/game-screen";
import { TeamScreen } from "../components/team-screen";

const labels: Record<Category, string> = { acc: "ACC", top25: "Top 25", close: "One score", upset: "Upsets" };
const names: Record<Category, string> = { acc: "ACC", top25: "Top 25", close: "One-score", upset: "Upset watch" };
function listNames(selection: Selection) { const n = selection.map(c => names[c]); return n.length > 2 ? `${n.slice(0, -1).join(", ")}, and ${n.at(-1)}` : n.join(" and "); }
// Headings and empty states describe the selected categories and the displayed period together.
function heading(selection: Selection, period: Period) { return `${selection.length ? listNames(selection) : "Your watchlist"}${period === "week" ? " this week" : ""}.`; }
function emptyTitle(selection: Selection, period: Period) {
  const when = period === "week" ? " this week" : "";
  if (selection.length > 1) return `Nothing matches these categories${when}.`;
  switch (selection[0]) {
    case "upset": return `No upsets brewing${when}.`;
    case "close": return period === "week" ? "No one-score games this week." : "No one-score games right now.";
    case "acc": return period === "week" ? "No ACC games this week." : "No ACC games on this day.";
    case "top25": return period === "week" ? "No Top 25 games this week." : "No Top 25 games on this day.";
    default: return period === "week" ? "A quiet football week." : "A quiet scoreboard.";
  }
}
// Games in progress, then the parenthesized total; dashes while counts are unknown.
function CountPair({ counts }: { counts: CategoryCounts | null }) { return <span className="tab-count count-pair" aria-hidden="true">{counts ? <>{counts.current} <span className="count-total">({counts.total})</span></> : "– (–)"}</span>; }
function localTime(date: string) { return Number.isFinite(Date.parse(date)) ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(date)) : "Time TBD"; }

function TeamRow({ team, game, opponent }: { team: Team; game: Game; opponent: Team }) {
  const leading = team.score !== null && opponent.score !== null && team.score > opponent.score;
  const [failed, setFailed] = useState(false);
  const line = game.pregameLine?.favoriteId === team.id && game.pregameLine.spread > 0 ? game.pregameLine : null;
  return <span className={`team-row ${leading ? "leading" : ""}`}>
    <span className={`team-logo ${team.logo && !failed ? "" : "team-logo-fallback"}`} aria-hidden="true">{team.logo && !failed ? <img src={team.logo} width="32" height="32" alt="" loading="lazy" onError={() => setFailed(true)} /> : <span>{team.abbreviation.slice(0, 3)}</span>}</span>
    <span className="team-identity"><span className="team-name">{team.rank !== null && <span className="rank">{team.rank}</span>}<span className="team-label">{team.name}</span>{line && linePlacement(game) !== null && <span className="team-line" title={`Pregame line · ${line.source}`}><span className="sr-only">Pregame betting line: favored by {points(line.spread)}, {line.source}</span><span className="team-line-visible" aria-hidden="true">−{line.spread}</span></span>}{game.possession === team.id && game.state === "live" && <span className="possession" role="img" aria-label="Possession">◆</span>}</span>{team.record && <span className="team-record" aria-hidden="true">{team.record}</span>}</span>
    <span className={`score ${team.changed ? "score-changed" : ""}`} aria-label={`${team.name}${team.record ? `, ${team.record}` : ""}: ${game.started && team.score !== null ? team.score : "no score yet"}`}>{game.started && team.score !== null ? team.score : "–"}</span>
  </span>;
}
// A state change can move a card to another section, remounting it. Keyboard
// focus returns to the same control only when it was inside this event's card
// and was lost with the removed card; a deliberate blur or other focus is kept.
let cardFocus: { gameId: string; key: string; element: Element } | null = null, trackingFocus = false;
function trackCardFocus() {
  if (trackingFocus) return;
  trackingFocus = true;
  document.addEventListener("focusin", event => {
    const target = event.target instanceof Element ? event.target : null;
    const control = target?.closest("[data-focus-key]"), card = target?.closest("article.game-card");
    cardFocus = control && card ? { gameId: card.id.slice("game-".length), key: control.getAttribute("data-focus-key")!, element: control } : null;
  });
  // After focus settles: a control still connected was blurred deliberately and is not restorable.
  document.addEventListener("focusout", () => {
    const left = cardFocus?.element;
    queueMicrotask(() => { if (left && cardFocus?.element === left && left.isConnected && document.activeElement !== left) cardFocus = null; });
  });
}
function restoreCardFocus(card: HTMLElement | null, gameId: string) {
  trackCardFocus();
  const saved = cardFocus, active = document.activeElement;
  // A card moving on the hidden scoreboard never takes focus from the game screen.
  if (!card || card.closest("[hidden]") || saved?.gameId !== gameId || saved.element.isConnected || (active && active !== document.body)) return;
  const target = [...card.querySelectorAll<HTMLElement>("[data-focus-key]")].find(element => element.dataset.focusKey === saved.key);
  if (!target) return;
  target.focus({ preventScroll: true });
  const box = target.getBoundingClientRect();
  // Scroll only as far as needed to keep the restored control visible.
  if (box.top < 0 || box.bottom > innerHeight) target.scrollIntoView({ block: "nearest" });
}
// A card is a link to its game screen. A plain activation opens it in place; a
// modified click or middle click keeps the browser's own link behavior.
function GameCard({ game, board, scopeError, showDate = false, href, onOpen }: { game: Game; board: Scoreboard; scopeError: boolean; showDate?: boolean; href: string; onOpen: () => void }) {
  const cardRef = useRef<HTMLElement>(null);
  useEffect(() => restoreCardFocus(cardRef.current, game.id), [game.id]);
  const tags = classify(game), [away, home] = game.teams;
  const watch = upsetWatch(game);
  const upsetLabel = watch?.basis === "conference" ? "Conference watch" : game.state === "final" ? "Upset final" : "Upset watch";
  const lineLocation = linePlacement(game);
  return <article ref={cardRef} id={`game-${game.id}`} className={`game-card ${tags.upset ? "upset-card" : ""} ${game.state === "final" ? "final-card" : ""}`}>
      <a className="game-summary" href={href} data-focus-key="summary" onClick={event => { if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); onOpen(); }}>
        <span className="sr-only">Game details: </span>
        <span className="game-overview"><span className="teams"><TeamRow team={away} opponent={home} game={game} /><TeamRow team={home} opponent={away} game={game} /></span>
        <span className="game-meta">{showDate && <span className="game-day-label">{new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/New_York" }).format(new Date(game.date))}</span>}<span className={`game-status status-${game.state}`}>{game.state === "live" && <span className="live-dot" />}{game.state === "delayed" && <TriangleAlert size={14} />}{game.state === "upcoming" && game.timeValid ? localTime(game.date) : game.halftime && game.state === "live" ? <HalftimeStatus game={game} board={board} scopeError={scopeError} /> : game.status}</span>{lineLocation !== null && game.pregameLine?.favoriteId === null && game.pregameLine.spread === 0 && <span className="pickem-line" title={`Pregame line · ${game.pregameLine.source}`}><span className="sr-only">Pregame pick’em line, {game.pregameLine.source}</span><span aria-hidden="true">PK</span></span>}<span className="broadcast">{game.broadcast && <><Tv size={13} /><span>{game.broadcast}</span></>}</span>{tags.upset && <span className="compact-upset">{upsetLabel}</span>}{game.state === "live" && game.redZone && <span className="compact-red-zone">RED ZONE</span>}</span>
        </span>
        <ChevronRight className="details-chevron" size={14} aria-hidden="true" />
      </a>
  </article>;
}
function LoadingCards() { return <div className="game-grid" role="status" aria-label="Loading scores">{[0, 1, 2].map(i => <div className="loading-card" key={i}><Skeleton className="h-6 w-full mb-2" /><Skeleton className="h-6 w-2/3" /></div>)}</div>; }
function Help({ update }: { update: AppUpdate }) { return <Sheet><SheetTrigger asChild><button className="icon-button" aria-label="How this scoreboard works"><CircleHelp size={21} /></button></SheetTrigger><AppPanelContent className="help-sheet" bodyClassName="help-body" title="How your watchlist works" description="The right games, automatically." bodyLabel="How it works"><dl><div><dt>ACC</dt><dd>Either team belongs to the ACC.</dd></div><div><dt>Top 25</dt><dd>Either team has an ESPN curated ranking from 1 through 25.</dd></div><div><dt>Day and Week</dt><dd>Day shows the selected Eastern date. Week shows the current football week, Thursday through Monday, for every selected category.</dd></div><div><dt>Halftime countdown</dt><dd>The countdown estimates a 20-minute break from ESPN’s recorded end of the second quarter. Seconds are approximate, and games can remain at halftime after it reaches zero. “Awaiting 3rd quarter” means ESPN still reports halftime. Missing or stale timing, being offline, or returning to the app can temporarily leave just Halftime. Device clock accuracy affects the estimate.</dd></div><div><dt>One score</dt><dd>A live FBS game, in any quarter or at halftime, tied or within 8 points.</dd></div><div><dt>Upset watch</dt><dd>The first Upsets number is games brewing now; the number in parentheses adds completed games that finished as upsets for the selected Day or Week. Brewing includes live games and games delayed after kickoff. Finished games appear in Upsets only when the final score is an upset; earlier watches where the favorite recovered leave this category. Hide finals removes completed upsets from the total. Any trailing pregame favorite, including an unranked team outside ACC/SEC, or trailing known higher-ranked team qualifies, even when the line favors the leader or is pick’em. Without either, unranked ACC/SEC teams trailing American, C-USA, MAC, Mountain West, or Sun Belt opponents appear as a labeled conference watch. Conference membership does not prove who was favored. Games paused after kickoff keep their upset watch in Delayed. Ties get close-game attention, not a trailing label. Unranked watches appear in the list. Phone alerts are separate from these display categories. Game alerts are off when ESPN confirms both teams are unranked and from Group-of-Six conferences. Unknown rankings or conferences do not count as confirmed. Selected categories do not filter notifications. Duke notifications are always off. Choose each type in Alerts; upset watch uses a selective late-game rule, and its definition can differ from this list.</dd></div></dl><p>All combines the four categories without repeating games. Each count shows that category’s games in progress, live or delayed after kickoff, then in parentheses every game it lists for the selected Day or Week, including upcoming, delayed and finished games. Choose any combination of ACC, Top 25, One score and Upsets to show games matching any of them; turning the last one off returns to All. Live games combine team relevance, live drama, and upset significance. ACC interest, bounded Power Four relevance, rankings and separate rank-disruption interest add together; close fourth quarters, the final five minutes, and overtime rise. Major upsets can outrank ACC blowouts. Top 10 close finishes outrank comparable unranked ACC games. Early ties get little urgency. Comfortable leads gradually lose priority, even in the first half, with a stronger reduction as time passes. Equal priorities use stable tiebreakers. Duke and Virginia Tech lead each state group when visible. Upcoming games remain chronological within those pin tiers. In Final, games between two known unranked Group-of-Six teams follow other finished games within a pin tier; other finals remain in kickoff order.</p><p>Finals keep their last observed One-score category and any category matching the final score for that game day. A past upset watch alone does not keep a recovered favorite in Upsets. A delay after kickoff preserves the last live One-score observation for the final, without labeling the delayed game One score. Resumed live play replaces that observation. Hide finals remembers your choice on this device.</p><p>Today stays on the previous Eastern day while its games are unfinished, including games continuing past midnight. It moves forward after the last game finishes. A date you pick manually stays selected.</p><p>Dates and football weeks use Eastern time. Kickoff times use your device’s timezone. One game can match several categories.</p><p>Scores refresh every 30 seconds while the app is open. ESPN clocks may lag the broadcast. When scores are stale, offline, or more than 90 seconds old, any previously loaded game cards remain visible with a warning, while category counts show dashes instead of fresh numbers. Counts return after a successful refresh.</p><p>Refresh scores checks the games. Refresh app loads a confirmed app update only when you choose it.</p><button className="text-link" onClick={update.check}>Check for app update</button><p role="status">{update.status}</p><div className="install-tip"><h3>Keep it on your iPhone</h3><p>In Safari, tap Share, then Add to Home Screen. Keep Open as Web App enabled if offered. Open that icon to set up alerts.</p></div><h3 className="history-heading">Version history</h3><ol className="release-history">{releases.map(r => <li key={r.version}><strong>v{r.version}</strong><span>{r.date}</span><p>{r.changes}</p></li>)}</ol><a href="https://www.espn.com/college-football/scoreboard" target="_blank" rel="noopener noreferrer" className="source-link">ESPN college football scoreboard <ArrowUpRight size={15} /></a></AppPanelContent></Sheet>; }

// Per-document memory of where each scoreboard entry was left and each game entry's scroll.
// History entries carry the same scoreboard snapshot for cross-document returns.
const boardSnapshots = new Map<string, BoardSnapshot>(), gameScroll = new Map<string, number>(), teamScroll = new Map<string, number>();
let documentMounted = false;
// The history entry each document showed when it was left. Arriving on a different entry is a history
// traversal; arriving on the same one is a reload, which keeps the URL and saved-preference behavior.
// The navigation timing type is the fallback when session storage is unavailable.
const LEFT_ENTRY_KEY = "ss:left-entry";
function leftEntry() { try { return sessionStorage.getItem(LEFT_ENTRY_KEY); } catch { return null; } }
function navigationType() {
  try { return (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined)?.type; } catch { return undefined; }
}
function returnedByHistory(key: string) {
  const left = leftEntry();
  return left !== null ? left !== key : navigationType() === "back_forward";
}
// A team page restores focus to the schedule game it was left for (`focus`) when that row is still a link.
type Restore = { kind: "game"; id: string; scrollY: number } | { kind: "team"; team: string; scrollY: number; focus?: string } | { kind: "board"; scrollY: number; origin: string; fallback?: boolean; waitForData?: boolean };
const sameSelection = (a: Selection, b: Selection) => a.length === b.length && a.every((c, i) => c === b[i]);

export default function Home() {
  const search = useInitialSearch();
  const [selectedCategories, setSelection] = useState<Selection | null>(null);
  const [selectedPeriod, setPeriod] = useState<Period | null>(null);
  // A fresh, ordinary Today entry may choose Week once after its real daily feed arrives.
  // User navigation and restored views cancel this pending choice synchronously.
  const automaticWeekPending = useRef<boolean | null>(null);
  const initial = useMemo(() => initialView(search), [search]);
  const selection = selectedCategories ?? initial.selection, period = selectedPeriod ?? initial.period;
  const scope = scoreboardScope(period), weekly = period === "week";
  const { date, today, data, boards, error, scopeError, dailyError, overnightError, refreshing, online, now, timezone, refresh, setDate, followToday } = useScoreboard(scope);
  const dukeGames = useMemo(() => Object.values(boards).flatMap(board => board?.games || []), [boards]);
  const duke = useDukeVisibility(dukeGames);
  const protectedBoards = useMemo(() => ({ daily: protectDukeBoard(boards.daily, duke.prefs), week: protectDukeBoard(boards.week, duke.prefs) }), [boards, duke.prefs]);
  const [hideFinals, setHideFinals] = useState(false);
  const [focusedGame, setFocusedGame] = useState("");
  // The open game screen. Until chosen here, the initial URL decides.
  const [chosenRoute, setRoute] = useState<GameRoute | null | undefined>(undefined);
  // One-shot request to open a game from a notification link or app update. Membership (focusedGame) never opens anything.
  const [openIntent, setOpenIntent] = useState("");
  const route = chosenRoute === undefined ? parseGameRoute(search) : chosenRoute;
  // The open team page, chosen together with the game route. `teamOrigin` is the game screen directly
  // behind it (its Back target), "" when that game is unknown, null when Back leads to the scoreboard.
  const [chosenTeam, setChosenTeam] = useState<string | null | undefined>(undefined);
  const [teamOrigin, setTeamOrigin] = useState<string | null>(null);
  const teamPage = chosenTeam === undefined ? (route ? null : parseTeamRoute(search)?.team ?? null) : chosenTeam;
  const show = (game: GameRoute | null, team: string | null = null, origin: string | null = null) => { setRoute(game); setChosenTeam(game ? null : team); setTeamOrigin(game ? null : origin); };
  // The season of the open team page, or of the schedule a game was opened from (its context).
  const teamSeason = useTeamSeason(teamPage ?? route?.team ?? null);
  const focusedOnce = useRef(false);
  const initialRestore = useRef<ReturnType<typeof updateRestoration> | undefined>(undefined);
  const cancelAutomaticWeek = () => { automaticWeekPending.current = false; };
  const choosePeriod = (next: Period) => { cancelAutomaticWeek(); setPeriod(next); };
  const chooseDate = (next: string | null) => { cancelAutomaticWeek(); setDate(next); };
  useEffect(() => {
    if (search === null || automaticWeekPending.current !== null) return;
    const params = new URLSearchParams(search), tab = params.get("tab");
    const legacyTab = tab === "acc" || tab === "top25" || tab === "close" || tab === "upset";
    const entry = readEntry(history.state);
    automaticWeekPending.current = initial.period === "day"
      && !params.has("date") && !params.has("period") && !legacyTab
      && !parseGameRoute(search) && !parseTeamRoute(search)
      && !updateRestoration(search) && !/^#game-[A-Za-z0-9_-]+$/.test(location.hash)
      && !initialRestore.current && !(entry?.kind === "board" && (entry.snapshot || entry.consumed));
  }, [search, initial.period]);
  useEffect(() => {
    if (initialRestore.current === undefined) initialRestore.current = updateRestoration(location.search);
    const restore = initialRestore.current;
    if (restore) {
      setHideFinals(restore.hideFinals); setFocusedGame(restore.focusedGame); setOpenIntent(restore.openGame); focusedOnce.current = true;
    } else {
      const target = gameId(/^#game-([A-Za-z0-9_-]+)$/.exec(location.hash)?.[1] || "");
      // A consumed notification link keeps its Watchlist membership but never reopens.
      const entry = readEntry(history.state), consumed = entry?.kind === "board" ? entry.consumed ?? "" : "";
      setFocusedGame(target || consumed); setOpenIntent(target);
      try { setHideFinals(!(target || consumed) && localStorage.getItem("ss:hide-finals") === "true"); } catch { /* Optional. */ }
    }
    const url = new URL(location.href);
    for (const key of ["_ss_update", "_ss_hide_finals", "_ss_focus", "_ss_open"]) url.searchParams.delete(key);
    if (url.href !== location.href) history.replaceState(history.state, "", url);

  }, []);
  useEffect(() => {
    if (!data || !focusedGame || focusedOnce.current) return;
    // A game screen or team page opened by its own URL has no notification landing to scroll to.
    if (route || teamPage) { focusedOnce.current = true; return; }
    const card = document.getElementById(`game-${focusedGame}`); if (card) { card.scrollIntoView({ block: "center" }); focusedOnce.current = true; }
  }, [data, focusedGame, route, teamPage]);
  const urlView = { date, followToday, selection, period };
  const update = useAppUpdate({ date, followToday, selection, period, hideFinals, focusedGame, openGame: openIntent });

  // Navigation between the scoreboard and the game screen. The scoreboard stays mounted
  // (one poller, its state and DOM) and is only hidden while a game is open.
  const routeHistory = useRef<RouteHistory | null>(null);
  const restoreJob = useRef<Restore | null>(null);
  const traverse = useRef<(traversal: Traversal) => void>(() => {});
  const snapshotNow = (origin: string): BoardSnapshot => ({ date: followToday ? null : validDate(date) ? date : null, selection: [...selection], period, hideFinals, scrollY: Math.round(window.scrollY), origin });
  // A restored snapshot owns the scoreboard view. Categories, period and a manual date may currently be
  // read from the URL being left (a reloaded game URL carries them); the scoreboard entry's URL may not,
  // so equal values are still pinned as explicit state rather than left to the URL.
  const applyView = (view: BoardView) => {
    cancelAutomaticWeek();
    setSelection(sameSelection(view.selection, selection) ? selection : view.selection);
    setPeriod(view.period);
    if (view.hideFinals !== hideFinals) setHideFinals(view.hideFinals);
    // The date the scoreboard hook would otherwise take from the current URL.
    const query = new URLSearchParams(location.search).get("date"), urlDate = query && validDate(query) ? query : null;
    // Pinning the same manual date keeps the hook's selected value, so polling does not restart;
    // only a real change of day, or of Today versus a manual day, restarts it.
    if (view.date === null ? !followToday || urlDate !== null : followToday || view.date !== date || urlDate !== view.date) setDate(view.date);
  };
  const openGame = (id: string, consume = false) => {
    const controller = routeHistory.current;
    if (!controller) return;
    setOpenIntent("");
    // Replace the scoreboard entry with its snapshot, then push the game: Back always has a safe scoreboard behind it.
    const prior = controller.current(), key = prior?.kind === "board" ? prior.key : newKey(), snapshot = snapshotNow(id);
    boardSnapshots.set(key, snapshot);
    const here = new URL(location.href);
    if (consume && /^#game-/.test(here.hash)) here.hash = "";
    const consumed = consume ? id : prior?.kind === "board" ? prior.consumed : undefined;
    controller.replace({ v: 1, kind: "board", key, snapshot, ...(consumed ? { consumed } : {}) }, here.href, snapshot.scrollY);
    controller.push({ v: 1, kind: "game", key: newKey(), id, section: "team", from: true }, gameUrl(location.href, { id, section: "team" }, urlView), 0);
    show({ id, section: "team" });
    restoreJob.current = { kind: "game", id, scrollY: 0 };
  };
  // A team link on the game screen pushes a genuine team entry above the genuine game entry.
  const openTeam = (team: string) => {
    const controller = routeHistory.current;
    if (!controller || !route) return;
    const entry = controller.current();
    if (entry?.kind === "game") gameScroll.set(entry.key, Math.round(window.scrollY));
    else controller.replace({ v: 1, kind: "game", key: newKey(), id: route.id, section: route.section, from: false, ...(route.team ? { team: route.team } : {}) }, location.href);
    controller.push({ v: 1, kind: "team", key: newKey(), team, from: true, origin: route.id }, teamUrl(location.href, team, urlView), 0);
    show(null, team, route.id);
    restoreJob.current = { kind: "team", team, scrollY: 0 };
  };
  // A schedule row pushes a game entry that carries its team as context, above the team entry.
  const openScheduleGame = (id: string) => {
    const controller = routeHistory.current;
    if (!controller || !teamPage) return;
    const entry = controller.current();
    if (entry?.kind === "team") teamScroll.set(entry.key, Math.round(window.scrollY));
    else controller.replace({ v: 1, kind: "team", key: newKey(), team: teamPage, from: false }, location.href);
    const next: GameRoute = { id, section: "team", team: teamPage };
    controller.push({ v: 1, kind: "game", key: newKey(), ...next, from: true }, gameUrl(location.href, next, urlView), 0);
    show(next);
    restoreJob.current = { kind: "game", id, scrollY: 0 };
  };
  const goBack = () => {
    const controller = routeHistory.current, entry = controller?.current();
    if (entry?.kind === "game" && entry.from) { history.back(); return; }
    // A schedule game opened directly falls back to its team page, never leaving the app.
    if (route?.team) {
      controller?.replace({ v: 1, kind: "team", key: newKey(), team: route.team, from: false }, teamUrl(location.href, route.team, urlView), 0);
      restoreJob.current = { kind: "team", team: route.team, scrollY: 0, focus: route.id };
      show(null, route.team);
      return;
    }
    // No scoreboard entry of ours behind this one (a direct link): open the scoreboard here, never leaving the app.
    controller?.replace({ v: 1, kind: "board", key: newKey() }, boardUrl(location.href, urlView), 0);
    restoreJob.current = { kind: "board", scrollY: 0, origin: route?.id ?? "", fallback: true };
    show(null);
  };
  const goBackFromTeam = () => {
    const controller = routeHistory.current, entry = controller?.current();
    if (entry?.kind === "team" && entry.from) { history.back(); return; }
    controller?.replace({ v: 1, kind: "board", key: newKey() }, boardUrl(location.href, urlView), 0);
    restoreJob.current = { kind: "board", scrollY: 0, origin: "", fallback: true };
    show(null);
  };
  // Team/Player switches replace the entry, so Back still returns straight to the scoreboard (or team page).
  const changeSection = (section: Section) => {
    if (!route) return;
    const controller = routeHistory.current, entry = controller?.current();
    controller?.replace(entry?.kind === "game" ? { ...entry, section } : { v: 1, kind: "game", key: newKey(), id: route.id, section, from: false, ...(route.team ? { team: route.team } : {}) }, sectionUrl(location.href, section));
    show({ ...route, section });
  };
  useEffect(() => {
    traverse.current = ({ target, source, owned }) => {
      // Someone else's traversal on this path: the framework handles it; the screen follows the URL.
      if (!owned || !target) { restoreJob.current = null; const game = parseGameRoute(location.search); show(game, game ? null : parseTeamRoute(location.search)?.team ?? null); return; }
      if (source?.kind === "board") boardSnapshots.set(source.key, snapshotNow(target.kind === "game" ? target.id : ""));
      else if (source?.kind === "game") gameScroll.set(source.key, Math.round(window.scrollY));
      else if (source?.kind === "team") teamScroll.set(source.key, Math.round(window.scrollY));
      if (target.kind === "game") {
        restoreJob.current = { kind: "game", id: target.id, scrollY: gameScroll.get(target.key) ?? 0 };
        show({ id: target.id, section: target.section, ...(target.team ? { team: target.team } : {}) });
      } else if (target.kind === "team") {
        restoreJob.current = { kind: "team", team: target.team, scrollY: teamScroll.get(target.key) ?? 0, focus: source?.kind === "game" ? source.id : undefined };
        show(null, target.team, target.from ? target.origin ?? "" : null);
      } else {
        const snapshot = boardSnapshots.get(target.key) ?? target.snapshot;
        if (snapshot) applyView(snapshot);
        restoreJob.current = { kind: "board", scrollY: snapshot?.scrollY ?? 0, origin: snapshot?.origin ?? "" };
        show(null);
      }
    };
    // A framework push since the last render leaves an entry without our record.
    routeHistory.current?.resync();
  });
  useEffect(() => {
    const controller = createRouteHistory(window, traversal => traverse.current(traversal));
    controller.install();
    routeHistory.current = controller;
    const entry = readEntry(history.state), initialRoute = parseGameRoute(location.search), initialTeam = initialRoute ? null : parseTeamRoute(location.search);
    if (initialRoute) {
      controller.replace({ v: 1, kind: "game", key: entry?.key ?? newKey(), ...initialRoute, from: entry?.kind === "game" && entry.id === initialRoute.id && entry.team === initialRoute.team && entry.from }, location.href, 0);
      restoreJob.current = { kind: "game", id: initialRoute.id, scrollY: 0 };
    } else if (initialTeam) {
      // A reloaded team page keeps the game behind it; a new tab or direct link has none.
      const kept = entry?.kind === "team" && entry.team === initialTeam.team && entry.from ? entry : null;
      controller.replace({ v: 1, kind: "team", key: entry?.key ?? newKey(), team: initialTeam.team, from: !!kept, ...(kept?.origin ? { origin: kept.origin } : {}) }, location.href, 0);
      if (kept) setTeamOrigin(kept.origin ?? "");
      restoreJob.current = { kind: "team", team: initialTeam.team, scrollY: 0 };
    } else {
      const board = entry?.kind === "board" ? entry : null, snapshot = board?.snapshot;
      // A cross-document return, such as Back after reloading a game, restores the scoreboard as it was left.
      // A reload keeps the URL and saved-preference behavior; a return from the Guide is the framework's.
      if (board && snapshot && !documentMounted && returnedByHistory(board.key)) {
        applyView(snapshot);
        restoreJob.current = { kind: "board", scrollY: snapshot.scrollY, origin: snapshot.origin, waitForData: true };
      }
      controller.replace({ v: 1, kind: "board", key: board?.key ?? newKey(), ...(snapshot ? { snapshot } : {}), ...(board?.consumed ? { consumed: board.consumed } : {}) }, location.href);
    }
    documentMounted = true;
    // Only real input cancels a restoration still waiting for scores; scroll events never do.
    const cancel = () => { if (restoreJob.current?.kind === "board" && restoreJob.current.waitForData) restoreJob.current = null; };
    const inputs = ["pointerdown", "touchstart", "wheel", "keydown"];
    for (const type of inputs) addEventListener(type, cancel, { capture: true, passive: true });
    const leave = () => { try { sessionStorage.setItem(LEFT_ENTRY_KEY, readEntry(history.state)?.key ?? ""); } catch { /* Optional. */ } };
    addEventListener("pagehide", leave);
    return () => {
      for (const type of inputs) removeEventListener(type, cancel, { capture: true });
      removeEventListener("pagehide", leave);
      controller.dispose();
      if (routeHistory.current === controller) routeHistory.current = null;
    };
    // Mount-only: the initial entry is stamped once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Focus first (without scrolling), then the saved absolute scroll position, clamped. The origin
  // card may have moved while the game was open; the position is never re-anchored to it.
  useLayoutEffect(() => {
    const job = restoreJob.current;
    if (!job) return;
    if (job.kind === "game") {
      if (route?.id !== job.id) return;
      restoreJob.current = null;
      document.querySelector<HTMLElement>(".game-screen .game-title")?.focus({ preventScroll: true });
      window.scrollTo(0, job.scrollY);
      return;
    }
    if (job.kind === "team") {
      if (route || teamPage !== job.team) return;
      // Wait for the season (or its unavailable state), so focus lands on the heading that stays.
      if (teamSeason.season?.team.id !== job.team && !teamSeason.failure && teamSeason.online) return;
      restoreJob.current = null;
      const row = job.focus ? document.querySelector<HTMLElement>(`.team-screen [data-focus-key="sched-${CSS.escape(job.focus)}"]`) : null;
      (row ?? document.querySelector<HTMLElement>(".team-screen .team-title"))?.focus({ preventScroll: true });
      window.scrollTo(0, Math.max(0, Math.min(job.scrollY, document.documentElement.scrollHeight - innerHeight)));
      if (row && !job.scrollY) row.scrollIntoView({ block: "center" });
      return;
    }
    if (route || teamPage || (job.waitForData && !data)) return;
    restoreJob.current = null;
    const link = job.origin ? document.getElementById(`game-${job.origin}`)?.querySelector<HTMLElement>('[data-focus-key="summary"]') : null;
    (link ?? document.getElementById("scoreboard-heading"))?.focus({ preventScroll: true });
    if (job.fallback && link) link.scrollIntoView({ block: "center" });
    else window.scrollTo(0, Math.max(0, Math.min(job.scrollY, document.documentElement.scrollHeight - innerHeight)));
  });
  // The displayed board has loaded, or this period's refresh has failed. Until then a notification waits,
  // so the landing scroll above sees its card first whichever board arrives first; a failure still opens it.
  const boardSettled = !!data || !!scopeError || (!refreshing && !!error);
  useEffect(() => {
    if (automaticWeekPending.current !== true) return;
    const daily = boards.daily, fetchedAt = daily ? Date.parse(daily.fetchedAt) : NaN;
    const dailyAge = Number.isFinite(fetchedAt) ? Math.max(0, now - fetchedAt) : Infinity;
    const healthyToday = !!daily && !!today && followToday && date === today && daily.date === today
      && (daily.endDate === undefined || daily.endDate === today)
      && !daily.stale && !daily.warnings?.length && !dailyError && !overnightError && online
      // Match the existing feed/count freshness boundary: older scores are already shown as stale.
      && dailyAge <= 90_000;
    if (!healthyToday) return;
    // The first healthy daily result consumes the decision. Later polls, filters and failures
    // cannot switch the view; emptiness is measured before display/category filtering.
    automaticWeekPending.current = false;
    if (daily.games.length === 0) setPeriod("week");
  }, [boards.daily, today, followToday, date, dailyError, overnightError, online, now]);
  // Auto-open once: an explicit event wins; real input before the game appears cancels the request.
  useEffect(() => {
    if (!openIntent) return;
    if (route || teamPage) { setOpenIntent(""); return; }
    if (!boardSettled) return;
    if (Object.values(protectedBoards).some(board => board?.games.some(game => game.id === openIntent))) openGame(openIntent, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openIntent, protectedBoards, route, teamPage, boardSettled]);
  useEffect(() => {
    if (!openIntent) return;
    const cancel = () => setOpenIntent("");
    const inputs = ["pointerdown", "touchstart", "wheel", "keydown"];
    for (const type of inputs) addEventListener(type, cancel, { capture: true, passive: true });
    return () => { for (const type of inputs) removeEventListener(type, cancel, { capture: true }); };
  }, [openIntent]);
  const toggleFinals = (value: boolean) => { setHideFinals(value); try { localStorage.setItem("ss:hide-finals", String(value)); } catch { /* Optional. */ } };
  // Every count describes the displayed period; the All count is the deduplicated union.
  const board = protectedBoards[scope], loaded = !!boards[scope];
  const visible = viewGames(board, selection, hideFinals, focusedGame);
  const week = today ? accWeek(today) : null;
  const shortDate = (d: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));
  const overnight = followToday && today && today !== easternDate();
  const age = data ? Math.max(0, Math.floor((now - Date.parse(data.fetchedAt)) / 1000)) : 0;
  const stale = !!data && (age > 90 || !!data.stale || !!error || !online);
  const counts = (chosen: Selection) => loaded && !stale ? categoryCounts(board, chosen, hideFinals, focusedGame) : null;
  const countLabel = (label: string, pair: CategoryCounts | null) => pair ? `${label}, ${pair.current} in progress, ${pair.total} total` : stale ? `${label}, counts unavailable while scores are stale` : `${label}, counts loading`;
  const allCounts = counts([]);
  const upset = loaded && !stale ? upsetCounts(board, hideFinals) : null;
  const dateText = date ? new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`)) : "Today";
  const warning = error || (data?.stale ? "ESPN is unavailable. Showing the last successful scores." : age > 90 ? "Waiting for a fresh score update." : data?.warnings?.join(" "));
  const section = (title: string, state: Game["state"]) => {
    const list = visible.filter(g => g.state === state);
    return list.length > 0 && <section className="score-section"><div className={state === "live" ? "sr-only" : "section-label"}><h2>{title}</h2>{state !== "live" && <span>{list.length} {list.length === 1 ? "game" : "games"}</span>}</div><div className="game-grid">{list.map(g => <GameCard key={g.id} game={g} board={data!} scopeError={!!scopeError} showDate={weekly} href={gameHref({ id: g.id, section: "team" }, urlView)} onOpen={() => openGame(g.id)} />)}</div></section>;
  };
  // The screen's game is looked up on the Duke-protected boards at every render, so a game hidden
  // while open (or never visible) shows only the generic unavailable screen, with no stats work.
  const screen = route ? [protectedBoards[scope], protectedBoards.daily, protectedBoards.week].map(b => ({ board: b, game: b?.games.find(g => g.id === route.id) })).find(found => found.game) : undefined;
  // Outside the board, a game opened with team context is found only by exact membership in that
  // team's validated schedule, and only while the Duke settings show it. The board's copy wins when both exist.
  // Only a season for the team actually in context; with none (the scoreboard, or the prerendered home) there is none.
  const contextTeam = teamPage ?? route?.team ?? null, loadedSeason = teamSeason.season;
  const season = contextTeam && loadedSeason && loadedSeason.team.id === contextTeam ? withBoardGames(loadedSeason, dukeGames) : null;
  const scheduled = route?.team && !screen ? findScheduleGame(season, route.id) : null;
  const scheduleGame = scheduled && !dukeHidden(scheduled.game, duke.prefs) ? scheduled.game : null;
  const screenGame = screen?.game ?? scheduleGame;
  const screenLoading = !!route && !screenGame && (route.team ? duke.prefs === null || (!season && !teamSeason.failure && teamSeason.online) : !error && (duke.prefs === null || !data));
  const seasonName = season?.team.shortName ?? "Team";
  const gameBack = route?.team ? { title: seasonName, detail: "Schedule", label: `Back to ${seasonName} schedule` } : undefined;
  const teamLinks = screenGame ? screenGame.teams.filter(team => teamParam(team.id)).map(team => ({ id: team.id, name: team.name, href: teamHref(team.id, urlView) })) : undefined;
  const checked = season ? new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(new Date(season.checkedAt)) : "";
  const scheduleNotice = scheduleGame && <p className="schedule-source">From the {seasonName} schedule, checked {checked} ET. {scheduleGame.state === "live" || scheduleGame.state === "delayed" ? "It updates about once a minute, not as live as Scores." : "It updates every few minutes."}</p>;
  // The team page's Back target: the game screen behind it, or the scoreboard for a direct link.
  const originGame = teamOrigin ? [protectedBoards.daily, protectedBoards.week].flatMap(b => b?.games ?? []).find(g => g.id === teamOrigin) ?? (() => { const found = findScheduleGame(season, teamOrigin); return found && !dukeHidden(found.game, duke.prefs) ? found.game : null; })() : null;
  const teamBack = teamOrigin !== null
    ? { title: "Game", detail: originGame ? `${originGame.teams[0].abbreviation || originGame.teams[0].name} at ${originGame.teams[1].abbreviation || originGame.teams[1].name}` : "Back", label: originGame ? `Back to game, ${originGame.teams[0].name} at ${originGame.teams[1].name}` : "Back to game" }
    : { title: "Scores", detail: weekly ? "This week" : dateText, label: `Back to scores, ${weekly ? "This week" : dateText}` };
  return <>
  <main className="app-shell compact-scoreboard" data-app-commit={LOADED_COMMIT}>
    <div className="scores-view" hidden={!!route || !!teamPage}>
    <header className="app-header"><Link className="wordmark" href="/" onClick={() => { cancelAutomaticWeek(); setDate(null); setSelection([]); setPeriod("day"); setFocusedGame(""); }} aria-label="Saturday Signal home"><span className="brand-icon"><Signal size={22} strokeWidth={3} /></span><span>saturday<wbr /><span className="brand-light">signal</span><span className="sport-label">COLLEGE FOOTBALL</span></span></Link><div className="header-actions"><Alerts iconOnly /><button className={`icon-button ${refreshing ? "refreshing" : ""}`} aria-label="Refresh scores" onClick={refresh} disabled={refreshing || !date}><RefreshCw size={20} /></button><Help update={update} /><DukeSettings games={data?.games || []} visibility={duke} /></div></header>
    <AppNavigation active="scores" date={date} followToday={followToday} />
    <div className="date-bar">{weekly ? <div className="week-label"><CalendarDays size={16} /><span>{week ? `${shortDate(week.start)} – ${shortDate(week.end)}` : "This football week"}</span><span className="week-note">THU–MON</span></div> : <><div className="date-navigation"><button className="icon-button" aria-label="Previous day" disabled={!date} onClick={() => chooseDate(shiftDate(date, -1))}><ChevronLeft size={19} /></button><label className="date-picker"><CalendarDays size={15} /><span>{dateText}</span><input type="date" value={date} onChange={e => { if (e.target.value) chooseDate(e.target.value); }} aria-label="Scoreboard date, Eastern time" /></label><button className="icon-button" aria-label="Next day" disabled={!date} onClick={() => chooseDate(shiftDate(date, 1))}><ChevronRight size={19} /></button></div><button className={`today-button ${followToday ? "is-today" : ""}`} onClick={() => { chooseDate(null); if (followToday) refresh(); }} disabled={!today}>Today</button></>}<div className="period-modes" role="group" aria-label="Scoreboard period"><button aria-pressed={!weekly} onClick={() => choosePeriod("day")}>Day</button><button aria-pressed={weekly} onClick={() => choosePeriod("week")}>Week</button></div></div>
    <p className="timezone-cue">Dates ET · Kickoffs {timezone}</p>
    {overnight && !weekly && <p className="overnight-note">Late games are still on. Today is staying on {shortDate(today)}.</p>}
    <div className="score-tabs">
      <div className="filter-tabs" role="group" aria-label="Game categories">
        <button type="button" className="filter-tab filter-watch" aria-pressed={selection.length === 0} aria-label={countLabel("All", allCounts)} onClick={() => setSelection([])}><span>All</span><CountPair counts={allCounts} /></button>
        {categories.map(c => { const pair = c === "upset" ? null : counts([c]); return <button type="button" className={`filter-tab filter-${c}`} aria-pressed={selection.includes(c)} aria-label={c === "upset" ? upset ? `Upsets, ${upset.brewing} brewing, ${upset.total} brewing or completed upsets` : stale ? "Upsets, counts unavailable while scores are stale" : "Upsets, counts loading" : countLabel(labels[c], pair)} onClick={() => setSelection(toggleCategory(selection, c))} key={c}><span>{labels[c]}</span>{c === "upset" ? <span className="tab-count upset-count" aria-hidden="true">{upset ? <>{upset.brewing} <span className="upset-total">({upset.total})</span></> : "– (–)"}</span> : <CountPair counts={pair} />}</button>; })}
      </div>
      <div className="watch-header"><h1 className="sr-only" id="scoreboard-heading" tabIndex={-1}>{heading(selection, period)}</h1><div className="feed-status" role="status"><span className={`feed-dot ${stale || !online || error ? "feed-warning" : !data ? "feed-loading" : ""}`} />{!online ? "Offline" : error && !data ? "Scores unavailable" : data ? `${stale ? "Last update" : "Updated"} ${age < 15 ? "just now" : age < 60 ? `${age}s ago` : `${Math.floor(age / 60)}m ago`}` : "Connecting to ESPN…"}</div><DukeGameControls games={data?.games || []} visibility={duke} /><label className="toggle-label"><input type="checkbox" checked={hideFinals} onChange={e => toggleFinals(e.target.checked)} /><span>Hide finals</span></label></div>
      {duke.storageWarning && <p className="duke-storage-warning" role="alert">{duke.storageWarning}</p>}
      {!route && !teamPage && <AppUpdateNotice update={update} />}
      {warning && <div className="feed-banner" role="alert"><CloudOff size={18} /><span>{warning}{data && " Displayed scores may be out of date."}</span><button onClick={refresh} disabled={refreshing}>Retry</button></div>}
      <section className="score-content" aria-labelledby="scoreboard-heading">
        {data && <p className="sr-only" role="status">{visible.length} {visible.length === 1 ? "game" : "games"} shown.</p>}
        {!data && !error && <LoadingCards />}
        {!data && error && <Empty className="empty-card"><EmptyHeader><EmptyMedia variant="icon"><CloudOff /></EmptyMedia><EmptyTitle>Scores are temporarily unavailable</EmptyTitle><EmptyDescription>We&apos;ll try again in 30 seconds. You can also check the source directly.</EmptyDescription></EmptyHeader><div className="empty-actions"><button className="solid-button" onClick={refresh} disabled={refreshing}>Try again</button><a className="text-link" href={`https://www.espn.com/college-football/scoreboard/_/date/${date.replaceAll("-", "")}/group/80`} target="_blank" rel="noopener noreferrer">Open ESPN <ArrowUpRight size={15} /></a></div></Empty>}
        {data && <>{section("On now", "live")}{section("Delayed", "delayed")}{section("Coming up", "upcoming")}{section("Schedule updates", "other")}{section("Final", "final")}{visible.length === 0 && <Empty className="empty-card"><EmptyHeader><EmptyMedia variant="icon">{selection.length === 1 && selection[0] === "upset" ? <Zap /> : <Radio />}</EmptyMedia><EmptyTitle>{emptyTitle(selection, period)}</EmptyTitle><EmptyDescription>{selection.length === 1 && selection[0] === "upset" ? "Trailing pregame favorites, trailing known higher-ranked teams, and labeled ACC/SEC conference watches appear here, including unranked games." : selection.length === 1 && selection[0] === "close" ? "Live games appear here when the margin is 8 points or fewer, including ties." : weekly ? "New qualifying games appear automatically as the schedule updates." : "Choose another date to check the schedule. New qualifying games appear automatically."}</EmptyDescription></EmptyHeader></Empty>}</>}
      </section>
    </div>
    <footer className="app-footer"><div><span className="footer-brand">SS<span> / </span></span><a href="https://www.espn.com/college-football/scoreboard" target="_blank" rel="noopener noreferrer">Scores via ESPN <ArrowUpRight size={12} /></a></div><p className="version-label">v{VERSION}</p></footer>
    </div>
    {route && <GameScreen game={screenGame} board={screen?.board ?? null} loading={screenLoading} scopeError={!!scopeError} backLabel={weekly ? "This week" : dateText} section={route.section} onSection={changeSection} onBack={goBack} back={gameBack}
      warning={screen || !scheduleGame ? warning || undefined : teamSeason.failure || season?.stale ? "Couldn’t refresh this team’s schedule." : undefined}
      onRetryScores={screen || !scheduleGame ? refresh : teamSeason.retry} refreshing={screen || !scheduleGame ? refreshing : teamSeason.pending}
      teamLinks={teamLinks} onOpenTeam={openTeam} notice={<>{scheduleNotice}<AppUpdateNotice update={update} /></>} />}
    {teamPage && <TeamScreen key={teamPage} teamId={teamPage} season={season} pending={teamSeason.pending} failed={!!teamSeason.failure} online={teamSeason.online} prefs={duke.prefs}
      back={teamBack} onBack={goBackFromTeam} onRetry={teamSeason.retry} gameHref={id => gameHref({ id, section: "team", team: teamPage }, urlView)} onOpenGame={openScheduleGame} notice={<AppUpdateNotice update={update} />} />}
  </main></>;
}
