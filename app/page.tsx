"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, CalendarDays, ChevronLeft, ChevronRight, CircleHelp, CloudOff, Radio, RefreshCw, Signal, TriangleAlert, Tv, Zap } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { classify, easternDate, shiftDate, sortGames, type Game, type Scoreboard, type Team } from "@/lib/football";

type Filter = "watch" | "acc" | "close" | "upset";
const filters: { id: Filter; label: string }[] = [{ id: "watch", label: "Watchlist" }, { id: "acc", label: "ACC" }, { id: "close", label: "One score" }, { id: "upset", label: "Upsets" }];
const headings = { watch: "Your watchlist.", acc: "ACC scoreboard.", close: "One-score games.", upset: "Upset watch." };
const summaries = { watch: "ACC · One-score games · Top 25 upset watch", acc: "Every ACC matchup, including nonconference games", close: "Live FBS games tied or separated by 8 points or fewer", upset: "A lower-ranked or unranked team leads a Top 25 team" };
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
function GameCard({ game }: { game: Game }) {
  const tags = classify(game), [away, home] = game.teams;
  const margin = away.score !== null && home.score !== null ? Math.abs(away.score - home.score) : null;
  const leader = (away.score ?? -1) > (home.score ?? -1) ? away : home;
  const trailing = leader.id === away.id ? home : away;
  return <article className={`game-card ${tags.upset ? "upset-card" : ""} ${game.state === "final" ? "final-card" : ""}`}>
    <div className="card-topline"><span className={`game-status status-${game.state}`}>{game.state === "live" && <span className="live-dot" />}{game.state === "delayed" && <TriangleAlert size={14} />}{game.state === "upcoming" && game.timeValid ? localTime(game.date) : game.status}</span><span className="broadcast">{game.broadcast && <><Tv size={13} /><span>{game.broadcast}</span></>}</span></div>
    <div className="teams"><TeamRow team={away} opponent={home} game={game} /><TeamRow team={home} opponent={away} game={game} /></div>
    {tags.upset && <div className="upset-reason"><Zap size={14} fill="currentColor" /><span>{leader.name} leads No. {trailing.rank} {trailing.name}</span></div>}
    {game.state === "live" && game.downDistance && <div className={`drive ${game.redZone ? "red-zone" : ""}`}>{game.redZone && <span>RED ZONE</span>}{game.downDistance}</div>}
    {game.state === "delayed" && <div className="delay-note">{game.started ? "Play paused. Watching for an update." : "Kickoff delayed. Watching for an update."}</div>}
    <div className="card-bottom"><div className="badges">{tags.acc && <span className="badge acc-badge">ACC</span>}{tags.close && <span className="badge close-badge">{margin === 0 ? "Tied" : `${margin}-point game`}</span>}{tags.upset && <span className="badge upset-badge">Upset watch</span>}</div><a href={game.url} target="_blank" rel="noopener noreferrer" className="gamecast" aria-label={`Open ${away.name} vs ${home.name} on ESPN`}>Gamecast<ArrowUpRight size={14} /></a></div>
  </article>;
}
function LoadingCards() { return <div className="game-grid" role="status" aria-label="Loading scores">{[0, 1, 2].map(i => <div className="loading-card" key={i}><Skeleton className="h-4 w-28 mb-6" /><Skeleton className="h-8 w-full mb-4" /><Skeleton className="h-8 w-full mb-6" /><Skeleton className="h-4 w-2/3" /></div>)}</div>; }
function Help() { return <Sheet><SheetTrigger asChild><button className="icon-button" aria-label="How this scoreboard works"><CircleHelp size={21} /></button></SheetTrigger><SheetContent side="bottom" className="help-sheet"><SheetHeader><SheetTitle>How your watchlist works</SheetTitle><SheetDescription>The right games, automatically.</SheetDescription></SheetHeader><div className="help-body"><dl><div><dt><span className="badge acc-badge">ACC</span></dt><dd>Any game involving an ACC football team, including nonconference opponents. Upcoming games and final scores stay in the ACC schedule.</dd></div><div><dt><span className="badge close-badge">One score</span></dt><dd>FBS games currently in progress, including halftime, tied or within 8 points. Games that have not kicked off and final scores do not count.</dd></div><div><dt><span className="badge upset-badge">Upset watch</span></dt><dd>A team ranked outside the Top 25, or with a lower ranking, is leading a Top 25 opponent. A tie is not an upset. Rankings come from ESPN's scoreboard, not betting odds.</dd></div></dl><p>The Watchlist combines all three without repeating games. Delayed games remain visible when they qualify, but are labeled separately from live play.</p><p>Scores refresh every 30 seconds while the app is open. Clocks reflect ESPN's latest report. If a refresh fails, the last successful scores remain visible with a warning.</p><div className="install-tip"><h3>Keep it on your iPhone</h3><p>Open in Safari, tap Share, then Add to Home Screen. If offered, keep Open as Web App enabled.</p></div><a href="https://www.espn.com/college-football/scoreboard" target="_blank" rel="noopener noreferrer" className="source-link">ESPN college football scoreboard <ArrowUpRight size={15} /></a></div></SheetContent></Sheet>; }

export default function Home() {
  const [date, setDate] = useState(""), [today, setToday] = useState("");
  const [filter, setFilter] = useState<Filter>("watch");
  const [data, setData] = useState<Scoreboard | null>(null);
  const [refreshing, setRefreshing] = useState(false), [error, setError] = useState("");
  const [online, setOnline] = useState(true), [now, setNow] = useState(0), [timezone, setTimezone] = useState("local time");
  const previous = useRef<Scoreboard | null>(null), controller = useRef<AbortController | null>(null), selectedDate = useRef("");
  useEffect(() => {
    const d = easternDate(); setDate(d); setToday(d); setOnline(navigator.onLine); setNow(Date.now());
    setTimezone(new Intl.DateTimeFormat(undefined, { timeZoneName: "short" }).formatToParts(new Date()).find(p => p.type === "timeZoneName")?.value || "local time");
    const ticker = window.setInterval(() => { setNow(Date.now()); setToday(easternDate()); }, 15000);
    return () => window.clearInterval(ticker);
  }, []);
  const refresh = useCallback(async () => {
    if (!date || document.hidden || controller.current) return;
    const c = new AbortController(); controller.current = c; setRefreshing(true);
    const timeout = window.setTimeout(() => c.abort(), 20000);
    try {
      const r = await fetch(`/api/scores?date=${date}`, { cache: "no-store", signal: c.signal });
      if (!r.ok) throw new Error("Unavailable");
      const next: Scoreboard = await r.json();
      if (next.date !== date || !Array.isArray(next.games) || !Number.isFinite(Date.parse(next.fetchedAt))) throw new Error("Invalid update");
      if (selectedDate.current !== date || controller.current !== c) return;
      const old = previous.current?.date === date ? previous.current : null;
      next.games = next.games.map(g => ({ ...g, teams: g.teams.map(t => ({ ...t, changed: !!old && old.games.some(p => p.id === g.id && p.teams.some(o => o.id === t.id && o.score !== null && o.score !== t.score)) })) as [Team, Team] }));
      previous.current = next; setData(next); setError(""); setNow(Date.now());
    } catch { if (selectedDate.current === date && controller.current === c) setError(navigator.onLine ? "Could not refresh scores. Retrying automatically." : "You're offline. Reconnect to refresh scores."); }
    finally { window.clearTimeout(timeout); if (controller.current === c) { controller.current = null; setRefreshing(false); } }
  }, [date]);
  useEffect(() => {
    controller.current?.abort(); controller.current = null; selectedDate.current = date;
    setData(null); previous.current = null; setError(""); refresh();
    const interval = window.setInterval(refresh, 30000);
    const resume = () => { setOnline(navigator.onLine); if (!document.hidden && navigator.onLine) refresh(); };
    const offline = () => { setOnline(false); setError("You're offline. Reconnect to refresh scores."); };
    document.addEventListener("visibilitychange", resume); window.addEventListener("online", resume); window.addEventListener("offline", offline);
    return () => { window.clearInterval(interval); controller.current?.abort(); controller.current = null; document.removeEventListener("visibilitychange", resume); window.removeEventListener("online", resume); window.removeEventListener("offline", offline); };
  }, [date, refresh]);
  const games = data?.games || [];
  const qualifying = (f: Filter) => sortGames(games.filter(g => { const c = classify(g); return f === "watch" ? c.acc || c.close || c.upset : c[f]; }));
  const visible = qualifying(filter);
  const age = data ? Math.max(0, Math.floor((now - Date.parse(data.fetchedAt)) / 1000)) : 0;
  const stale = !!data && (age > 90 || !!data.stale || !!error || !online);
  const dateText = date ? new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`)) : "Today";
  const warning = error || (data?.stale ? "ESPN is unavailable. Showing the last successful scores." : age > 90 ? "Waiting for a fresh score update." : data?.warnings?.join(" "));
  const section = (title: string, state: Game["state"]) => {
    const list = visible.filter(g => g.state === state);
    return list.length > 0 && <section className="score-section"><div className="section-label"><h2>{state === "live" && <span className="live-dot" />}{title}</h2><span>{list.length} {list.length === 1 ? "game" : "games"}</span></div><div className="game-grid">{list.map(g => <GameCard key={g.id} game={g} />)}</div></section>;
  };
  return <main className="app-shell">
    <header className="app-header"><a className="wordmark" href="/" aria-label="Saturday Signal home"><span className="brand-icon"><Signal size={22} strokeWidth={3} /></span><span>saturday<span className="brand-light">signal</span><span className="sport-label">COLLEGE FOOTBALL</span></span></a><div className="header-actions"><button className={`icon-button ${refreshing ? "refreshing" : ""}`} aria-label="Refresh scores" onClick={refresh} disabled={refreshing || !date}><RefreshCw size={20} /></button><Help /></div></header>
    <div className="date-bar"><div className="date-navigation"><button className="icon-button" aria-label="Previous day" disabled={!date} onClick={() => setDate(shiftDate(date, -1))}><ChevronLeft size={19} /></button><label className="date-picker"><CalendarDays size={15} /><span>{dateText}</span><input type="date" value={date} onChange={e => { if (e.target.value) setDate(e.target.value); }} aria-label="Scoreboard date, Eastern time" /></label><button className="icon-button" aria-label="Next day" disabled={!date} onClick={() => setDate(shiftDate(date, 1))}><ChevronRight size={19} /></button></div><button className={`today-button ${date === today ? "is-today" : ""}`} onClick={() => setDate(today)} disabled={!today}>Today</button></div>
    <Tabs value={filter} onValueChange={v => setFilter(v as Filter)} className="score-tabs">
      <TabsList className="filter-tabs" aria-label="Game categories">{filters.map(f => <TabsTrigger className={`filter-tab filter-${f.id}`} value={f.id} key={f.id}><span>{f.label}</span><span className="tab-count">{data ? qualifying(f.id).length : "·"}</span></TabsTrigger>)}</TabsList>
      <div className="watch-header"><h1>{headings[filter]}</h1><p>{summaries[filter]}</p><div className="feed-status" role="status"><span className={`feed-dot ${stale || !online || error ? "feed-warning" : !data ? "feed-loading" : ""}`} />{!online ? "Offline" : error && !data ? "Scores unavailable" : data ? `${stale ? "Last update" : "Updated"} ${age < 15 ? "just now" : age < 60 ? `${age}s ago` : `${Math.floor(age / 60)}m ago`}` : "Connecting to ESPN…"}{data && <span className="refresh-note">{stale ? "Checking for new scores" : "Auto-refresh on"}</span>}</div></div>
      {warning && <div className="feed-banner" role="alert"><CloudOff size={18} /><span>{warning}{data && " Displayed scores may be out of date."}</span><button onClick={refresh} disabled={refreshing}>Retry</button></div>}
      {filters.map(f => <TabsContent key={f.id} value={f.id} className="score-content">
        {!data && !error && <LoadingCards />}
        {!data && error && <Empty className="empty-card"><EmptyHeader><EmptyMedia variant="icon"><CloudOff /></EmptyMedia><EmptyTitle>Scores are temporarily unavailable</EmptyTitle><EmptyDescription>We'll try again in 30 seconds. You can also check the source directly.</EmptyDescription></EmptyHeader><div className="empty-actions"><button className="solid-button" onClick={refresh} disabled={refreshing}>Try again</button><a className="text-link" href={`https://www.espn.com/college-football/scoreboard/_/date/${date.replaceAll("-", "")}/group/80`} target="_blank" rel="noopener noreferrer">Open ESPN <ArrowUpRight size={15} /></a></div></Empty>}
        {data && <>{section("On now", "live")}{section("Delayed", "delayed")}{section("Coming up · ACC", "upcoming")}{section("Final · ACC", "final")}{section("Schedule updates", "other")}{visible.length === 0 && <Empty className="empty-card"><EmptyHeader><EmptyMedia variant="icon">{filter === "upset" ? <Zap /> : <Radio />}</EmptyMedia><EmptyTitle>{filter === "upset" ? "No upsets brewing." : filter === "close" ? "No one-score games right now." : filter === "acc" ? "No ACC games on this date." : "A quiet scoreboard."}</EmptyTitle><EmptyDescription>{filter === "upset" ? "When a lower-ranked team takes the lead over a Top 25 opponent, that game appears here." : filter === "close" ? "Live games appear here when the margin is 8 points or fewer, including ties." : "Choose another date to check the schedule. New qualifying games appear automatically."}</EmptyDescription></EmptyHeader></Empty>}</>}
      </TabsContent>)}
    </Tabs>
    <footer className="app-footer"><div><span className="footer-brand">SS<span> / </span></span><a href="https://www.espn.com/college-football/scoreboard" target="_blank" rel="noopener noreferrer">Scores via ESPN <ArrowUpRight size={12} /></a></div><p>Refreshes every 30s · Kickoff times in {timezone}</p><p>Dates use Eastern time. One game can match several categories.</p></footer>
  </main>;
}
