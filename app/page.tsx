"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, CalendarDays, ChevronLeft, ChevronRight, CircleHelp, CloudOff, Radio, RefreshCw, Signal, TriangleAlert, Tv, Zap } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useScoreboard } from "@/lib/use-scoreboard";
import { upsetExplanation, upsetWatch } from "@/lib/upset";
import { VERSION, releases } from "@/lib/releases";
import { Alerts } from "@/components/alerts";
import { accWeek, classify, easternDate, shiftDate, type Game, type Team } from "@/lib/football";
import { scoreboardScope, viewGames, type Filter } from "@/lib/scoreboard-views";

import { initialTab, updateRestoration, gameId } from "@/lib/app-update";
import { useInitialSearch } from "@/lib/browser-state";
import { useAppUpdate, LOADED_COMMIT, type AppUpdate } from "@/lib/use-app-update";
import { AppUpdateNotice } from "@/components/app-update";

const filters: { id: Filter; label: string }[] = [{ id: "watch", label: "Watchlist" }, { id: "acc", label: "ACC" }, { id: "top25", label: "Top 25" }, { id: "close", label: "One score" }, { id: "upset", label: "Upsets" }];
const headings = { watch: "Your watchlist.", acc: "ACC this week.", top25: "Top 25 this week.", close: "One-score games.", upset: "Upset watch." };
const summaries = { watch: "ACC · Top 25 · One-score games · Upset watch", acc: "Thursday through Monday, including nonconference games", top25: "Thursday through Monday, with either team ranked in ESPN’s Top 25", close: "FBS games tied or within 8 points, plus retained finals", upset: "Ranked and ACC/SEC upset situations, plus retained finals" };
function localTime(date: string) { return Number.isFinite(Date.parse(date)) ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(date)) : "Time TBD"; }

function TeamRow({ team, game, opponent }: { team: Team; game: Game; opponent: Team }) {
  const leading = team.score !== null && opponent.score !== null && team.score > opponent.score;
  const [failed, setFailed] = useState(false);
  return <div className={`team-row ${leading ? "leading" : ""}`}>
    <div className="team-logo">{team.logo && !failed ? <img src={team.logo} width="32" height="32" alt="" loading="lazy" onError={() => setFailed(true)} /> : <span>{team.abbreviation.slice(0, 3)}</span>}</div>
    <div className="team-identity"><div className="team-name">{team.rank !== null && <span className="rank">{team.rank}</span>}<span>{team.name}</span></div><div className="team-record">{team.record || team.abbreviation}{game.possession === team.id && game.state === "live" && <span className="possession">◆ Possession</span>}</div></div>
    <span className={`score ${team.changed ? "score-changed" : ""}`} aria-label={`${team.name}: ${game.started && team.score !== null ? team.score : "no score yet"}`}>{game.started && team.score !== null ? team.score : "–"}</span>
  </div>;
}
function GameCard({ game, showDate = false }: { game: Game; showDate?: boolean }) {
  const tags = classify(game), result = classify({ ...game, retainedCategories: undefined }), [away, home] = game.teams;
  const margin = away.score !== null && home.score !== null ? Math.abs(away.score - home.score) : null;
  const explanation = upsetExplanation(game), watch = upsetWatch(game);
  return <article id={`game-${game.id}`} className={`game-card ${tags.upset ? "upset-card" : ""} ${game.state === "final" ? "final-card" : ""}`}>
    <div className="card-topline">{showDate && <span className="game-day-label">{new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/New_York" }).format(new Date(game.date))}</span>}<span className={`game-status status-${game.state}`}>{game.state === "live" && <span className="live-dot" />}{game.state === "delayed" && <TriangleAlert size={14} />}{game.state === "upcoming" && game.timeValid ? localTime(game.date) : game.status}</span><span className="broadcast">{game.broadcast && <><Tv size={13} /><span>{game.broadcast}</span></>}</span></div>
    <div className="teams"><TeamRow team={away} opponent={home} game={game} /><TeamRow team={home} opponent={away} game={game} /></div>
    {result.upset && <div className="upset-reason"><Zap size={14} fill="currentColor" /><span>{explanation}</span></div>}
    {game.state === "live" && game.downDistance && <div className={`drive ${game.redZone ? "red-zone" : ""}`}>{game.redZone && <span>RED ZONE</span>}{game.downDistance}</div>}
    {game.state === "delayed" && <div className="delay-note">{game.started ? "Play paused. Watching for an update." : "Kickoff delayed. Watching for an update."}</div>}
    <div className="card-bottom"><div className="badges">{tags.acc && <span className="badge acc-badge">ACC</span>}{tags.top25 && <span className="badge top25-badge">Top 25</span>}{tags.close && <span className="badge close-badge">{margin === 0 ? "Tied" : margin !== null && margin <= 8 ? `${margin}-point game` : "One-score watch"}</span>}{tags.upset && <span className="badge upset-badge">{game.state === "final" && !result.upset ? "Earlier upset watch" : watch?.basis === "conference" ? "Conference watch" : game.state === "final" ? "Upset final" : "Upset watch"}</span>}</div><a href={game.url} target="_blank" rel="noopener noreferrer" className="gamecast" aria-label={`Open ${away.name} vs ${home.name} on ESPN`}>Gamecast<ArrowUpRight size={14} /></a></div>
  </article>;
}
function LoadingCards() { return <div className="game-grid" role="status" aria-label="Loading scores">{[0, 1, 2].map(i => <div className="loading-card" key={i}><Skeleton className="h-4 w-28 mb-6" /><Skeleton className="h-8 w-full mb-4" /><Skeleton className="h-8 w-full mb-6" /><Skeleton className="h-4 w-2/3" /></div>)}</div>; }
function Help({ update }: { update: AppUpdate }) { return <Sheet><SheetTrigger asChild><button className="icon-button" aria-label="How this scoreboard works"><CircleHelp size={21} /></button></SheetTrigger><SheetContent side="bottom" className="help-sheet"><SheetHeader><SheetTitle>How your watchlist works</SheetTitle><SheetDescription>The right games, automatically.</SheetDescription></SheetHeader><div className="help-body"><dl><div><dt>ACC</dt><dd>Either team belongs to the ACC. The ACC tab covers the current football week, Thursday through Monday.</dd></div><div><dt>Top 25</dt><dd>Either team has an ESPN curated ranking from 1 through 25.</dd></div><div><dt>One score</dt><dd>A live FBS game, in any quarter or at halftime, tied or within 8 points.</dd></div><div><dt>Upset watch</dt><dd>A pregame favorite trails in a ranked matchup, or an ACC/SEC favorite trails even when unranked. Available ESPN pregame lines take precedence over rankings. Without a line, we use known rankings; unranked ACC/SEC teams trailing American, C-USA, MAC, Mountain West, or Sun Belt opponents appear as a labeled conference watch. Conference membership does not prove who was favored. Games paused after kickoff keep their upset watch in Delayed. Ties get close-game attention, not a trailing label. Unranked watches appear in the list. Push alerts use rankings alone, so a ranked betting underdog can trigger an upset alert without an upset badge here.</dd></div></dl><p>The Watchlist combines all four categories without repeating games. Live games combine team relevance, live drama, and upset significance. ACC interest and rankings add together; close fourth quarters, the final five minutes, and overtime rise. Major upsets can outrank ACC blowouts. Top 10 close finishes outrank comparable unranked ACC games. Early ties get little urgency, and large late margins reduce priority. Meaningful time bands keep the order steady. Upcoming games remain chronological.</p><p>Finals keep their last observed category and any category matching the final score for that game day. A delay after kickoff preserves the last live One-score observation for the final, without labeling the delayed game One score. Resumed live play replaces that observation. Hide finals remembers your choice on this device.</p><p>Today stays on the previous Eastern day while its games are unfinished, including games continuing past midnight. It moves forward after the last game finishes. A date you pick manually stays selected.</p><p>Scores refresh every 30 seconds while the app is open. ESPN clocks may lag the broadcast. Failed refreshes keep the last displayed scores with a warning.</p><p>Refresh scores checks the games. Refresh app loads a confirmed app update only when you choose it.</p><button className="text-link" onClick={update.check}>Check for app update</button><p role="status">{update.status}</p><div className="install-tip"><h3>Keep it on your iPhone</h3><p>In Safari, tap Share, then Add to Home Screen. Keep Open as Web App enabled if offered. Open that icon to set up alerts.</p></div><h3 className="history-heading">Version history</h3><ol className="release-history">{releases.map(r => <li key={r.version}><strong>v{r.version}</strong><span>{r.date}</span><p>{r.changes}</p></li>)}</ol><a href="https://www.espn.com/college-football/scoreboard" target="_blank" rel="noopener noreferrer" className="source-link">ESPN college football scoreboard <ArrowUpRight size={15} /></a></div></SheetContent></Sheet>; }

export default function Home() {
  const search = useInitialSearch();
  const [selectedFilter, setFilter] = useState<Filter | null>(null);
  const filter = selectedFilter ?? initialTab(search);
  const scope = scoreboardScope(filter), weekly = scope !== "daily";
  const { date, today, data, boards, error, refreshing, online, now, timezone, refresh, setDate, followToday } = useScoreboard(scope);
  const [hideFinals, setHideFinals] = useState(false);
  const [focusedGame, setFocusedGame] = useState("");
  const focusedOnce = useRef(false);
  useEffect(() => {
    const restore = updateRestoration(location.search);
    if (restore) {
      setHideFinals(restore.hideFinals); setFocusedGame(restore.focusedGame); focusedOnce.current = true;
    } else {
      const target = gameId(/^#game-([A-Za-z0-9_-]+)$/.exec(location.hash)?.[1] || "");
      setFocusedGame(target);
      try { setHideFinals(!target && localStorage.getItem("ss:hide-finals") === "true"); } catch { /* Optional. */ }
    }
    const url = new URL(location.href);
    for (const key of ["_ss_update", "_ss_hide_finals", "_ss_focus"]) url.searchParams.delete(key);
    if (url.href !== location.href) history.replaceState(history.state, "", url);

  }, []);
  useEffect(() => { if (data && focusedGame && !focusedOnce.current) { const card = document.getElementById(`game-${focusedGame}`); if (card) { card.scrollIntoView({ block: "center" }); focusedOnce.current = true; } } }, [data, focusedGame]);
  const update = useAppUpdate({ date, followToday, filter, hideFinals, focusedGame });
  const toggleFinals = (value: boolean) => { setHideFinals(value); try { localStorage.setItem("ss:hide-finals", String(value)); } catch { /* Optional. */ } };
  const boardFor = (f: Filter) => boards[scoreboardScope(f)];
  const qualifying = (f: Filter) => viewGames(boardFor(f), f, hideFinals, focusedGame);
  const visible = qualifying(filter);
  const week = today ? accWeek(today) : null;
  const shortDate = (d: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));
  const overnight = followToday && today && today !== easternDate();
  const age = data ? Math.max(0, Math.floor((now - Date.parse(data.fetchedAt)) / 1000)) : 0;
  const stale = !!data && (age > 90 || !!data.stale || !!error || !online);
  const dateText = date ? new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`)) : "Today";
  const warning = error || (data?.stale ? "ESPN is unavailable. Showing the last successful scores." : age > 90 ? "Waiting for a fresh score update." : data?.warnings?.join(" "));
  const section = (title: string, state: Game["state"]) => {
    const list = visible.filter(g => g.state === state);
    return list.length > 0 && <section className="score-section"><div className="section-label"><h2>{state === "live" && <span className="live-dot" />}{title}</h2><span>{list.length} {list.length === 1 ? "game" : "games"}</span></div><div className="game-grid">{list.map(g => <GameCard key={g.id} game={g} showDate={weekly} />)}</div></section>;
  };
  return <main className="app-shell" data-app-commit={LOADED_COMMIT}>
    <header className="app-header"><Link className="wordmark" href="/" onClick={() => { setDate(null); setFilter("watch"); setFocusedGame(""); }} aria-label="Saturday Signal home"><span className="brand-icon"><Signal size={22} strokeWidth={3} /></span><span>saturday<span className="brand-light">signal</span><span className="sport-label">COLLEGE FOOTBALL</span></span></Link><div className="header-actions"><button className={`icon-button ${refreshing ? "refreshing" : ""}`} aria-label="Refresh scores" onClick={refresh} disabled={refreshing || !date}><RefreshCw size={20} /></button><Help update={update} /></div></header>
    <div className="date-bar">{weekly ? <div className="week-label"><CalendarDays size={16} /><span>{week ? `${shortDate(week.start)} – ${shortDate(week.end)}` : "This football week"}</span><span className="week-note">THU–MON · ET</span></div> : <><div className="date-navigation"><button className="icon-button" aria-label="Previous day" disabled={!date} onClick={() => setDate(shiftDate(date, -1))}><ChevronLeft size={19} /></button><label className="date-picker"><CalendarDays size={15} /><span>{dateText}</span><input type="date" value={date} onChange={e => { if (e.target.value) setDate(e.target.value); }} aria-label="Scoreboard date, Eastern time" /></label><button className="icon-button" aria-label="Next day" disabled={!date} onClick={() => setDate(shiftDate(date, 1))}><ChevronRight size={19} /></button></div><button className={`today-button ${followToday ? "is-today" : ""}`} onClick={() => { setDate(null); if (followToday) refresh(); }} disabled={!today}>Today</button></>}</div>
    {overnight && !weekly && <p className="overnight-note">Late games are still on. Today is staying on {shortDate(today)}.</p>}
    <Tabs value={filter} onValueChange={v => setFilter(v as Filter)} className="score-tabs">
      <TabsList className="filter-tabs" aria-label="Game categories">{filters.map(f => <TabsTrigger className={`filter-tab filter-${f.id}`} value={f.id} key={f.id}><span>{f.label}</span><span className="tab-count">{boardFor(f.id) ? qualifying(f.id).length : "–"}</span></TabsTrigger>)}</TabsList>
      <div className="watch-header"><h1>{headings[filter]}</h1><p>{summaries[filter]}</p><div className="feed-status" role="status"><span className={`feed-dot ${stale || !online || error ? "feed-warning" : !data ? "feed-loading" : ""}`} />{!online ? "Offline" : error && !data ? "Scores unavailable" : data ? `${stale ? "Last update" : "Updated"} ${age < 15 ? "just now" : age < 60 ? `${age}s ago` : `${Math.floor(age / 60)}m ago`}` : "Connecting to ESPN…"}{data && <span className="refresh-note">{stale ? "Checking for new scores" : "Auto-refresh on"}</span>}</div></div>
      <div className="score-options"><Alerts /><label className="toggle-label"><input type="checkbox" checked={hideFinals} onChange={e => toggleFinals(e.target.checked)} /><span>Hide finals</span></label></div>
      <AppUpdateNotice update={update} />
      {warning && <div className="feed-banner" role="alert"><CloudOff size={18} /><span>{warning}{data && " Displayed scores may be out of date."}</span><button onClick={refresh} disabled={refreshing}>Retry</button></div>}
      {filters.map(f => <TabsContent key={f.id} value={f.id} className="score-content">
        {!data && !error && <LoadingCards />}
        {!data && error && <Empty className="empty-card"><EmptyHeader><EmptyMedia variant="icon"><CloudOff /></EmptyMedia><EmptyTitle>Scores are temporarily unavailable</EmptyTitle><EmptyDescription>We&apos;ll try again in 30 seconds. You can also check the source directly.</EmptyDescription></EmptyHeader><div className="empty-actions"><button className="solid-button" onClick={refresh} disabled={refreshing}>Try again</button><a className="text-link" href={`https://www.espn.com/college-football/scoreboard/_/date/${date.replaceAll("-", "")}/group/80`} target="_blank" rel="noopener noreferrer">Open ESPN <ArrowUpRight size={15} /></a></div></Empty>}
        {data && <>{section("On now", "live")}{section("Delayed", "delayed")}{section("Coming up", "upcoming")}{section("Schedule updates", "other")}{section("Final", "final")}{visible.length === 0 && <Empty className="empty-card"><EmptyHeader><EmptyMedia variant="icon">{filter === "upset" ? <Zap /> : <Radio />}</EmptyMedia><EmptyTitle>{filter === "upset" ? "No upsets brewing." : filter === "close" ? "No one-score games right now." : filter === "acc" ? "No ACC games this week." : filter === "top25" ? "No Top 25 games this week." : "A quiet scoreboard."}</EmptyTitle><EmptyDescription>{filter === "upset" ? "Ranked upsets, trailing ACC/SEC pregame favorites, and labeled ACC/SEC conference watches appear here, including unranked games." : filter === "close" ? "Live games appear here when the margin is 8 points or fewer, including ties." : weekly ? "New qualifying games appear automatically as the schedule updates." : "Choose another date to check the schedule. New qualifying games appear automatically."}</EmptyDescription></EmptyHeader></Empty>}</>}
      </TabsContent>)}
    </Tabs>
    <footer className="app-footer"><div><span className="footer-brand">SS<span> / </span></span><a href="https://www.espn.com/college-football/scoreboard" target="_blank" rel="noopener noreferrer">Scores via ESPN <ArrowUpRight size={12} /></a></div><p>Refreshes every 30s · Kickoff times in {timezone}</p><p>Dates use Eastern time. One game can match several categories.</p><p className="version-label">Saturday Signal v{VERSION} · History in Help</p></footer>
  </main>;
}
