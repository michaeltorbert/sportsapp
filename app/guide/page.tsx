"use client";
import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight, RefreshCw, Signal } from "lucide-react";
import { AppNavigation } from "@/components/app-navigation";
import { AppUpdateNotice } from "@/components/app-update";
import { GuideTimeline } from "@/components/guide-timeline";
import { useGuideState } from "@/lib/use-guide-state";
import { useScoreboard } from "@/lib/use-scoreboard";
import { useAppUpdate, LOADED_COMMIT } from "@/lib/use-app-update";
import { easternDate, shiftDate } from "@/lib/football";

export default function Guide() {
  const selection = useGuideState();
  const { date, today, data, dailyError, overnightError, online, refreshing, now, refresh, followToday } = useScoreboard("daily", true, selection.date);
  const update = useAppUpdate({ page: "guide", date, followToday, view: selection.view });
  const age = data ? Math.max(0, Math.floor((now - Date.parse(data.fetchedAt)) / 1000)) : 0;
  const stale = !!data && (!!dailyError || !!data.stale || age > 90 || !online);
  const warnings = [...new Set([dailyError, ...(data?.warnings || []), data?.stale ? "ESPN is unavailable. Showing the last successful schedule." : "", data && age > 90 ? "Waiting for a fresh schedule update." : "", !online ? "You're offline. Reconnect to refresh the schedule." : ""].filter(Boolean))];
  const dateLabel = date ? new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`)) : "Today";
  const chooseDate = (value: string | null) => selection.choose({ date: value, view: selection.view });
  return <main className="app-shell guide-shell" data-app-commit={LOADED_COMMIT}>
    <header className="app-header"><Link className="wordmark" href="/" aria-label="Saturday Signal home"><span className="brand-icon"><Signal size={22} /></span><span>saturday<span className="brand-light">signal</span></span></Link><button className={`icon-button ${refreshing ? "refreshing" : ""}`} aria-label="Refresh guide" onClick={refresh} disabled={refreshing || !date}><RefreshCw size={20} /></button></header>
    <AppNavigation active="guide" date={date} followToday={followToday} />
    <div className="guide-controls"><div className="date-navigation"><button className="icon-button" aria-label="Previous day" disabled={!date} onClick={() => chooseDate(shiftDate(date, -1))}><ChevronLeft size={19} /></button><label className="date-picker"><CalendarDays size={15} /><span>{dateLabel}</span><input type="date" value={date} onChange={event => { if (event.target.value) chooseDate(event.target.value); }} aria-label="Guide date, Eastern time" /></label><button className="icon-button" aria-label="Next day" disabled={!date} onClick={() => chooseDate(shiftDate(date, 1))}><ChevronRight size={19} /></button></div><button className={`today-button ${followToday ? "is-today" : ""}`} disabled={!today} onClick={() => { chooseDate(null); if (followToday) refresh(); }}>Today</button></div>
    <div className="guide-heading"><h1>Guide</h1><div className="guide-modes" role="group" aria-label="Guide games"><button aria-pressed={selection.view === "all"} onClick={() => selection.choose({ date: selection.date, view: "all" })}>All games</button><button aria-pressed={selection.view === "watch"} onClick={() => selection.choose({ date: selection.date, view: "watch" })}>Watchlist only</button></div></div>
    <div className="guide-feed" role="status"><span className={`feed-dot ${stale || !online ? "feed-warning" : !data ? "feed-loading" : ""}`} /><span>{!online ? "Offline" : data ? `${stale ? "Last update" : "Updated"} ${age < 15 ? "just now" : `${Math.floor(age / 60)}m ago`}` : dailyError ? "Schedule unavailable" : "Connecting to ESPN…"}</span><span>All times Eastern</span></div>
    {followToday && today && today !== easternDate() && <p className="overnight-note">Late games are still on. Today is staying on {today}.</p>}
    {followToday && overnightError && <p className="guide-overnight" role="status">{overnightError}</p>}
    {warnings.length > 0 && <div className="feed-banner" role="alert"><div>{warnings.map(w => <p key={w}>{w}</p>)}</div><button onClick={refresh} disabled={refreshing}>Retry</button></div>}
    <AppUpdateNotice update={update} />
    {!data && !dailyError && online && <div className="guide-loading" role="status" aria-label="Loading guide"><div /><div /><div /><div /></div>}
    {!data && (!!dailyError || !online) && <div className="guide-empty"><h2>Schedule temporarily unavailable</h2><p>Reconnect or try again to load this day.</p><button className="solid-button" onClick={refresh} disabled={refreshing}>Try again</button></div>}
    {data && <GuideTimeline board={data} mode={selection.view} now={now} followToday={followToday} />}
    <footer className="app-footer guide-footer"><a href={`https://www.espn.com/college-football/scoreboard/_/date/${date.replaceAll("-", "")}/group/80`} target="_blank" rel="noopener noreferrer">Schedule via ESPN ↗</a><span>Refreshes every 30s</span><button className="text-link" onClick={update.check}>Check app update</button></footer>
  </main>;
}
