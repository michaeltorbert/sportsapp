"use client";
import { useState, type MouseEvent, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, CloudOff, RefreshCw, Signal, Tv } from "lucide-react";
import type { DukePreferences } from "@/lib/duke-visibility";
import { scheduleGameHidden, seasonAggregates, TEAM_STAT_ROWS, type ScheduleEntry, type ScheduleSection, type TeamSeason, type TeamSeasonTeam } from "@/lib/team-season";
// Relative, like the page's own import, so page tests bundle the real game screen helpers.
import { gameDay } from "./game-screen";

function localTime(date: string) { return Number.isFinite(Date.parse(date)) ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(date)) : "Time TBD"; }
let checkedFormat: Intl.DateTimeFormat | undefined;
function checkedTime(iso: string) {
  checkedFormat ??= new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
  return `${checkedFormat.format(new Date(iso))} ET`;
}
function recordWords(record: string) {
  const [wins, losses, ties] = record.split("-");
  return `${wins} ${wins === "1" ? "win" : "wins"}, ${losses} ${losses === "1" ? "loss" : "losses"}${ties ? `, ${ties} ${ties === "1" ? "tie" : "ties"}` : ""}`;
}
const plainClick = (event: MouseEvent) => event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

function TeamLogo({ team }: { team: TeamSeasonTeam }) {
  const [failed, setFailed] = useState(false);
  // Real logos keep the light tile the game screen uses; the fallback is the abbreviation.
  return <span className={`mh-logo team-logo-tile ${team.logo && !failed ? "has-image" : ""}`} aria-hidden="true">{team.logo && !failed ? <img src={team.logo} width="40" height="40" alt="" onError={() => setFailed(true)} /> : <span>{(team.abbreviation || team.shortName).slice(0, 4)}</span>}</span>;
}
function Value({ value }: { value: string | null }) {
  return value === null ? <span className="stat-missing" aria-label="Unavailable">—</span> : <>{value}</>;
}
function Notice({ title, children, warning = false, action }: { title: string; children: ReactNode; warning?: boolean; action?: ReactNode }) {
  return <div className={`stats-notice ${warning ? "warning" : ""}`}><strong>{title}</strong><p>{children}</p>{action}</div>;
}

// One schedule game. A game hidden by the Duke settings shows only its date: no opponent, status,
// score, result or link, visibly or to assistive technology.
function Row({ entry, team, hidden, next, href, onOpen }: { entry: ScheduleEntry; team: string; hidden: boolean; next: boolean; href: string; onOpen: () => void }) {
  const game = entry.game, day = gameDay(game.date) ?? "Date not announced";
  if (hidden) return <li className="sched-item"><div className="sched-row is-hidden"><span className="s-when"><span className="s-date">{day}</span></span><span className="s-opp">Duke game hidden by your settings</span><span className="s-out"><span className="s-muted">Hidden</span></span></div></li>;
  const self = game.teams.find(t => t.id === team)!, other = game.teams.find(t => t.id !== team)!;
  const home = game.teams[1].id === team;
  const where = game.neutralSite === true ? "vs" : home ? "vs" : "at";
  const whereWords = game.neutralSite === true ? "versus" : home ? "home versus" : "at";
  const scored = game.started && self.score !== null && other.score !== null;
  let when: string, out: ReactNode = null, spoken = "";
  if (game.state === "final" && scored) {
    const [letter, kind, word] = self.score! > other.score! ? ["W", "w", "Won"] : self.score! < other.score! ? ["L", "l", "Lost"] : ["T", "t", "Tied"];
    when = game.status;
    out = <span className={`s-res ${kind}`} aria-hidden="true"><b>{letter}</b> {self.score}–{other.score}</span>;
    spoken = `${word} ${self.score} to ${other.score}`;
  } else if ((game.state === "live" || game.state === "delayed") && game.started) {
    when = game.status;
    out = scored ? <span className={`s-live ${game.state}`} aria-hidden="true">{game.state === "live" && <span className="live-dot" />}{self.score}–{other.score}</span> : null;
    spoken = scored ? `${game.state === "live" ? "In progress" : "Paused"}, ${self.score} to ${other.score}` : "";
  } else if (game.state === "upcoming") {
    when = game.timeValid ? localTime(game.date) : "Time TBD";
    out = <>{next && <span className="s-next">Next</span>}{game.broadcast && <span className="s-tv"><Tv size={14} aria-hidden="true" /><span className="sr-only">on </span>{game.broadcast}</span>}</>;
  } else when = game.status;
  const special = game.state === "other" || game.state === "delayed";
  return <li className="sched-item"><a className="sched-row" href={href} data-focus-key={`sched-${game.id}`} onClick={event => { if (!plainClick(event)) return; event.preventDefault(); onOpen(); }}>
    <span className="s-when"><span className="s-date">{day}</span><span className={`s-time ${special ? "s-status" : ""}`}><span className="sr-only">, </span>{when}</span></span>
    <span className="s-opp"><span className="s-ha" aria-hidden="true">{where}</span><span className="sr-only">, {whereWords} </span><span className="s-tile" aria-hidden="true">{(other.abbreviation || entry.opponent.name).slice(0, 4)}</span><span className="s-name">{entry.opponent.name}{game.neutralSite === true && <small>Neutral site</small>}</span></span>
    <span className="s-out">{spoken && <span className="sr-only">, {spoken}</span>}{out}</span>
    <ChevronRight className="s-chev" size={16} aria-hidden="true" />
  </a></li>;
}
function Section({ title, section, team, prefs, now, nextId, gameHref, onOpenGame, onRetry, pending }: { title: string; section: ScheduleSection; team: string; prefs: DukePreferences | null; now: number; nextId: string | undefined; gameHref: (id: string) => string; onOpenGame: (id: string) => void; onRetry: () => void; pending: boolean }) {
  const lower = title.toLowerCase();
  if (section.status === "unavailable") return <><h3 className="group-title"><span>{title}</span></h3><Notice title={`${title} games couldn’t be loaded`} warning action={<button type="button" data-focus-key={`retry-${lower}`} onClick={onRetry} disabled={pending}><RefreshCw size={13} aria-hidden="true" />{pending ? "Retrying…" : "Retry"}</button>}>The rest of this page is still available.</Notice></>;
  const list = section.entries;
  return <>
    <h3 className="group-title"><span>{title}</span>{list.length > 0 && <span className="count">{list.length} {list.length === 1 ? "game" : "games"}</span>}</h3>
    {list.length ? <ol className="sched">{list.map(entry => <Row key={entry.game.id} entry={entry} team={team} hidden={scheduleGameHidden(entry.game, prefs, now)} next={entry.game.id === nextId} href={gameHref(entry.game.id)} onOpen={() => onOpenGame(entry.game.id)} />)}</ol>
      : <p className="sched-empty">No {lower} games are listed yet.</p>}
  </>;
}

export type TeamScreenProps = {
  teamId: string; season: TeamSeason | null; pending: boolean; failed: boolean; online: boolean; prefs: DukePreferences | null;
  back: { title: string; detail: string; label: string }; onBack: () => void; onRetry: () => void;
  gameHref: (id: string) => string; onOpenGame: (id: string) => void; timezone: string; now: number; notice?: ReactNode;
};
/** A team's current season: record, regular-season averages and the full published schedule. */
export function TeamScreen({ teamId, season, pending, failed, online, prefs, back, onBack, onRetry, gameHref, onOpenGame, timezone, now, notice }: TeamScreenProps) {
  const backButton = <button type="button" className="back-button" data-focus-key="back" aria-label={back.label} onClick={onBack}><ChevronLeft size={22} aria-hidden="true" /><span className="back-text" aria-hidden="true"><span>{back.title}</span><small>{back.detail}</small></span></button>;
  const bar = <header className="game-bar">{backButton}<span className="team-bar-title" aria-hidden="true">{season?.team.abbreviation}</span><span className="bar-brand" aria-hidden="true"><span className="brand-icon"><Signal size={17} strokeWidth={3} /></span></span></header>;
  if (!season) {
    const waiting = pending || (!failed && online);
    return <div className="game-screen team-screen">{bar}{notice}
      <div className={`stats-empty unavailable team-unavailable`} role={waiting ? "status" : undefined}>
        <h1 className="team-title" tabIndex={-1}>{waiting ? "Loading team…" : "This team isn’t available"}</h1>
        {!waiting && <><p>{online ? "Its season couldn’t be loaded. Try again." : "You’re offline. It will load when you reconnect."}</p>
          <div className="team-actions"><button type="button" className="notice-button" data-focus-key="team-retry" onClick={onRetry} disabled={!online}>Retry</button><button type="button" className="notice-button" data-focus-key="back-2" onClick={onBack}>Back to {back.title === "Scores" ? "scores" : back.title.toLowerCase()}</button></div></>}
      </div>
    </div>;
  }
  const aggregates = seasonAggregates(season, prefs), team = season.team;
  const nextId = [...(season.regular.status === "complete" ? season.regular.entries : []), ...(season.postseason.status === "complete" ? season.postseason.entries : [])].find(entry => entry.game.state === "upcoming" && !scheduleGameHidden(entry.game, prefs, now))?.game.id;
  const record = !aggregates.shown
    ? <span className="team-record">Record <b className="withheld">{aggregates.reason === "checking" ? "checking…" : aggregates.reason === "hidden" ? "hidden" : "not shown yet"}</b></span>
    : season.record ? <span className="team-record"><span aria-hidden="true">Record <b>{season.record.replaceAll("-", "–")}</b></span><span className="sr-only">Record: {recordWords(season.record)}</span></span>
    : <span className="team-record">Record unavailable</span>;
  let averages: ReactNode;
  if (!aggregates.shown) averages = aggregates.reason === "checking" ? <div className="stats-loading" role="status"><p>Checking your Duke settings…</p></div>
    : aggregates.reason === "hidden" ? <Notice title="Record and averages hidden">They include a Duke game your settings are hiding.</Notice>
    : <Notice title="Record and averages not shown yet">Part of this schedule couldn’t be loaded, so we can’t yet confirm they leave out Duke games you’ve hidden.</Notice>;
  else if (!season.stats) averages = <Notice title="Season averages unavailable" action={<button type="button" data-focus-key="retry-stats" onClick={onRetry} disabled={pending}><RefreshCw size={13} aria-hidden="true" />{pending ? "Retrying…" : "Retry"}</button>}>They couldn’t be loaded. The record and schedule are still available.</Notice>;
  else {
    const stats = season.stats, missing = Object.values(stats).some(([a, b]) => a === null || b === null);
    averages = <>
      <table className="stats-table team-averages">
        <caption>Regular season · per game</caption>
        <thead><tr><th scope="col"><span className="sr-only">Statistic</span></th><th scope="col" className="c-team">{team.shortName}<span className="sr-only"> ({team.name})</span></th><th scope="col" className="c-opp">Opponents</th></tr></thead>
        <tbody>{TEAM_STAT_ROWS.map(([key, label]) => <tr key={key}><th scope="row">{label}</th><td className="c-team"><Value value={stats[key][0]} /></td><td className="c-opp"><Value value={stats[key][1]} /></td></tr>)}</tbody>
      </table>
      <p className="stats-footnote">Opponents shows what {team.shortName} allowed per game.{missing && " — means a value is unavailable."}</p>
    </>;
  }
  const refreshFailed = failed || season.stale;
  return <div className="game-screen team-screen">{bar}{notice}
    <div className="team-body"><div className="team-cols">
      <div className="team-side">
        <header className="team-head"><TeamLogo team={team} /><div className="team-id"><h1 className="team-title" tabIndex={-1}>{team.name}</h1><p className="team-meta"><span>{season.season.year} season</span><span className="sep" aria-hidden="true">·</span>{record}</p></div></header>
        {refreshFailed && <div className="feed-banner game-feed" role="alert"><CloudOff size={18} aria-hidden="true" /><span>{online ? "Couldn’t refresh this team." : "You’re offline."} Showing the season checked {checkedTime(season.checkedAt)}.</span>{online && <button type="button" onClick={onRetry} disabled={pending}>Retry</button>}</div>}
        <section className="team-block" aria-labelledby="team-averages-h"><h2 id="team-averages-h">Season averages</h2>{averages}</section>
      </div>
      <div className="team-main">
        <section className="team-block" aria-labelledby="team-schedule-h">
          <h2 id="team-schedule-h">Schedule</h2>
          <p className="team-fresh"><span>Checked {checkedTime(season.checkedAt)}</span><span>Dates ET · Kickoffs {timezone}</span></p>
          <div className="sched-wrap">
            <Section title="Regular season" section={season.regular} team={teamId} prefs={prefs} now={now} nextId={nextId} gameHref={gameHref} onOpenGame={onOpenGame} onRetry={onRetry} pending={pending} />
            <Section title="Postseason" section={season.postseason} team={teamId} prefs={prefs} now={now} nextId={nextId} gameHref={gameHref} onOpenGame={onOpenGame} onRetry={onRetry} pending={pending} />
          </div>
        </section>
      </div>
    </div></div>
  </div>;
}
