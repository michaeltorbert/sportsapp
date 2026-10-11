"use client";
import { useState, type ReactNode } from "react";
import { ChevronRight, RefreshCw } from "lucide-react";
import type { Game } from "@/lib/football";
import { expectedPhase, GAME_CORE, GAME_DETAILS, LIVE_STATS_ENABLED, PLAYER_CATEGORIES, playerColumns, SEASON_ROWS, statsDisplay, statsTtl, type GameStats, type Pair, type PlayerCategory, type StatsPhase } from "@/lib/game-stats";
import { statsGeneration, useGameStats, type StatsState } from "@/lib/use-game-stats";

type Rows = readonly (readonly [string, string])[];
const CATEGORY: Record<PlayerCategory, { title: string; columns: [string, string][] }> = {
  passing: { title: "Passing", columns: [["C/A", "completions/attempts"], ["YDS", "yards"], ["TD", "touchdowns"], ["INT", "interceptions"]] },
  rushing: { title: "Rushing", columns: [["ATT", "attempts"], ["YDS", "yards"], ["TD", "touchdowns"]] },
  receiving: { title: "Receiving", columns: [["REC", "receptions"], ["YDS", "yards"], ["TD", "touchdowns"]] },
};
// Inner disclosure choices survive board polls and card moves between sections.
const disclosures = new Map<string, { details: boolean; players: boolean }>();
let checkedFormat: Intl.DateTimeFormat | undefined;
function checkedTime(iso: string) {
  checkedFormat ??= new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", timeZone: "America/New_York" });
  return `${checkedFormat.format(new Date(iso))} ET`;
}
function ago(ms: number) { const s = Math.max(0, Math.floor(ms / 1000)); return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : `${Math.floor(s / 3600)}h ago`; }
function wait(ms: number) { const s = Math.max(1, Math.ceil(ms / 1000)); return s < 60 ? `${s}s` : `${Math.ceil(s / 60)}m`; }
function agoWords(ms: number) { const s = Math.max(0, Math.floor(ms / 1000)), m = Math.floor(s / 60); return s < 60 ? `${s} seconds ago` : m < 60 ? `${m} ${m === 1 ? "minute" : "minutes"} ago` : `${Math.floor(m / 60)} hours ago`; }

function Value({ value }: { value: string | null | undefined }) {
  return value == null ? <span className="stat-missing" aria-label="Unavailable">—</span> : <>{value}</>;
}
function Comparison({ game, rows, values, label, season = false }: { game: Game; rows: Rows; values: Record<string, Pair>; label: string; season?: boolean }) {
  const [away, home] = game.teams;
  return <table className="stats-table">
    <caption className="sr-only">{label} · {away.name}, away; {home.name}, home</caption>
    <thead><tr><th scope="col">{season ? "Season average" : "Team stat"}</th>{[away, home].map((team, i) => <th scope="col" key={team.id}><span>{team.abbreviation || team.name}</span><small>{i ? "home" : "away"}</small><span className="sr-only"> · {team.name}</span></th>)}</tr></thead>
    <tbody>{rows.map(([key, name]) => <tr key={key}><th scope="row">{name}{season && <span className="stat-unit">per game</span>}</th><td><Value value={values[key]?.[0]} /></td><td><Value value={values[key]?.[1]} /></td></tr>)}</tbody>
  </table>;
}
type Retry = { onRetry: () => void; pending: boolean; waitMs: number };
// Only the title and stable sentence are a polite live region. Changing age and
// countdown text sits outside it, so it never re-announces on a timer tick.
function Notice({ title, children, detail, warning = false, live = false, retry }: { title: string; children: ReactNode; detail?: ReactNode; warning?: boolean; live?: boolean; retry?: Retry }) {
  const waiting = !!retry && !retry.pending && retry.waitMs > 0;
  return <div className={`stats-notice ${warning ? "warning" : ""}`}>
    <div role={live ? "status" : undefined}><strong>{title}</strong><p>{children}</p></div>
    {detail && <p className="stats-notice-detail">{detail}</p>}
    {retry && <button type="button" data-focus-key="stats-retry" onClick={retry.onRetry} disabled={retry.pending || waiting}><RefreshCw size={13} aria-hidden="true" />{retry.pending ? "Retrying…" : waiting ? `Retry in ${wait(retry.waitMs)}` : "Retry"}</button>}
  </div>;
}
function Disclosure({ id, title, hint, label, open, onToggle, children }: { id: string; title: string; hint: string; label: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return <>
    <button type="button" className="stats-disclosure" data-focus-key={id} aria-expanded={open} aria-controls={id} onClick={onToggle}><span>{title}</span><span className="disclosure-hint">{hint}</span><ChevronRight size={14} aria-hidden="true" /></button>
    <div id={id} className="stats-region" role="region" aria-label={label} hidden={!open}>{open && children}</div>
  </>;
}
function Players({ game, stats }: { game: Game; stats: GameStats }) {
  const players = stats.players;
  if (!("teams" in players)) return <Notice title="Player stats unavailable">{players.unavailable === "too-large" ? "The player box score is too large to show here. Team stats remain available; open Gamecast for the full box score." : "Team stats remain available. Open Gamecast for the full box score."}</Notice>;
  // Negative source IDs are team-attributed entries; the source supplies their name.
  const teamEntry = players.teams.some(entry => "categories" in entry && PLAYER_CATEGORIES.some(c => { const rows = entry.categories[c]; return "rows" in rows && rows.rows.some(row => row.athleteId.startsWith("-")); }));
  // The completeness claim holds only when every category for both teams is listed.
  const complete = players.teams.every(entry => "categories" in entry && PLAYER_CATEGORIES.every(c => "rows" in entry.categories[c]));
  const groups = PLAYER_CATEGORIES.map(category => {
    const meta = CATEGORY[category], labels = playerColumns(category);
    return <section className="players-group" key={category}><h4>{meta.title}</h4><p>{meta.columns.map(([short, long]) => `${short}: ${long}`).join(" · ")}</p>{game.teams.map((team, i) => {
      const entry = players.teams[i], rows = "categories" in entry ? entry.categories[category] : entry;
      return <div key={team.id}>
        <div className="player-team-label">{team.name} <small>{i ? "home" : "away"}</small></div>
        {!("rows" in rows) ? <Notice title={`${team.name} ${category} unavailable`}>Team stats and the other player sections remain available.</Notice>
          : !rows.rows.length ? <p className="stats-footnote">No {category} entries supplied.</p>
          : <>
            <div className="player-table-wrap" role="region" aria-label={`${team.name} ${category} statistics`} tabIndex={0} data-focus-key={`stats-${category}-${i}`}>
              <table className="player-table"><caption className="sr-only">{team.name} · {meta.title}</caption>
                <thead><tr><th scope="col">Player</th>{meta.columns.map(([short, long]) => <th scope="col" key={short}><abbr title={long}>{short}</abbr></th>)}</tr></thead>
                <tbody>{rows.rows.map((row, r) => <tr key={`${row.athleteId}-${r}`}><th scope="row">{row.name ?? <span className="stat-missing">Name unavailable</span>}</th>{labels.map(label => <td key={label}><Value value={row.values[label]} /></td>)}</tr>)}</tbody>
              </table>
            </div>
            {rows.unaligned ? <p className="stats-footnote">These {category} values could not be matched to their columns, so they are shown as unavailable (—).</p>
              : rows.rows.some(row => Object.values(row.values).some(value => value === null)) && <p className="stats-footnote">— marks a value that is unavailable.</p>}
          </>}
      </div>;
    })}</section>;
  });
  return <>{groups}<p className="stats-footnote">{complete ? "All participants supplied for these categories are shown." : "All participants supplied are shown for the listed categories. Categories marked unavailable are not shown."}{teamEntry && " “Team” is a team-attributed entry from the source."}</p></>;
}

export function GameStatsPanel({ game, expanded }: { game: Game; expanded: boolean }) {
  const { state, now, online, retry } = useGameStats(game, expanded);
  const [open, setOpen] = useState(() => disclosures.get(game.id) || { details: false, players: false });
  if (!expanded) return null;
  const toggle = (key: "details" | "players") => { const next = { ...open, [key]: !open[key] }; disclosures.set(game.id, next); if (disclosures.size > 50) disclosures.delete(disclosures.keys().next().value!); setOpen(next); };
  return <GameStatsView game={game} state={state} now={now} online={online} retry={retry} open={open} toggle={toggle} />;
}

type ViewProps = { game: Game; state: StatsState | null; now: number; online: boolean; retry: () => void; open: { details: boolean; players: boolean }; toggle: (key: "details" | "players") => void };
/** Pure rendering of one expanded card's stats state. */
export function GameStatsView({ game, state, now, online, retry, open, toggle }: ViewProps) {
  const expected = expectedPhase(game), [away, home] = game.teams, matchup = `${away.name} vs ${home.name}`;
  // Exceptional states are status-first and make no stats request.
  if (expected === null) {
    const body = /postpon/i.test(game.status) ? "Check Gamecast for schedule updates." : /forfeit|no contest/i.test(game.status) ? "This is a reported game status. A played final is not implied." : /cancel/i.test(game.status) ? "This game will not be played as scheduled." : "Stats are not shown for this game status.";
    return <section className="stats-section" aria-label={`Game status for ${matchup}`}><div className="stats-empty"><h3>{game.status}</h3><p>{body}</p></div></section>;
  }
  const heading = expected === "pregame" ? "Season averages" : "Team stats";
  const phaseLabel = expected === "pregame" ? "Pregame" : expected === "final" ? "Final" : "This game";
  const intro = <div className="stats-heading"><h3>{heading}</h3><span className="stats-phase">{phaseLabel}</span></div>;
  const section = (content: ReactNode) => <section className="stats-section" aria-label={`${heading} for ${matchup}`}>{intro}{content}</section>;
  // The controller owns the gate; before its first state the constant decides, so no spinner flashes.
  // Rendered state must belong to this card's full generation; a snapshot must also match its identity.
  const current = state?.generation === statsGeneration(game) ? state : null;
  if (current ? current.mode === "disabled" : expected === "started" && !LIVE_STATS_ENABLED) return section(<div className="stats-empty" role="status"><h3>Live stats are not available yet</h3><p>Open Gamecast for live game statistics.</p></div>);
  const candidate = current?.snapshot ?? null;
  const snapshot = candidate && candidate.eventId === game.id && candidate.teamIds[0] === away.id && candidate.teamIds[1] === home.id ? candidate : null;
  const pending = current?.pending ?? null, failure = current?.failure ?? null;
  const retryState: Retry = { onRetry: retry, pending: !!pending, waitMs: Math.max(0, (current?.retryAt ?? 0) - (now || Date.now())) };
  if (!snapshot) {
    if (!online) return section(<Notice title="You’re offline" warning live>Stats will load when you reconnect. The score and game details are still available.</Notice>);
    if (failure && !pending) return section(<Notice title="Stats could not be loaded" warning live retry={retryState}>The score and game details are still available. Try again.</Notice>);
    return section(<div className="stats-loading" role="status"><p>{pending === "waiting" ? "Waiting to load team stats…" : "Loading team stats…"}</p>{Array.from({ length: 8 }, (_, i) => <div className="skeleton-row" aria-hidden="true" key={i}><span /><span /><span /></div>)}</div>);
  }
  return section(<StatsBody game={game} stats={snapshot} expected={expected} now={now} online={online} failure={!!failure} retry={retryState} open={open} toggle={toggle} />);
}

function StatsBody({ game, stats, expected, now, online, failure, retry, open, toggle }: { game: Game; stats: GameStats; expected: StatsPhase; now: number; online: boolean; failure: boolean; retry: Retry; open: { details: boolean; players: boolean }; toggle: (key: "details" | "players") => void }) {
  const pending = retry.pending;
  const display = statsDisplay(stats, expected), age = Math.max(0, (now || Date.parse(stats.checkedAt)) - Date.parse(stats.checkedAt));
  const matchup = `${game.teams[0].name} vs ${game.teams[1].name}`;
  const pastTtl = age > statsTtl(expected);
  const warnings = <>
    {failure && online && <Notice title="Stats may be out of date" warning live retry={retry} detail={<>Showing stats checked {agoWords(age)}. Scores refresh separately.</>}>Refresh failed. Showing the last loaded stats.</Notice>}
    {!online && <Notice title="Offline · saved stats" warning live detail={<>Showing stats checked {agoWords(age)}.</>}>Showing the last loaded game stats. They may be out of date.</Notice>}
  </>;
  // Retrieval time is the only timestamp shown; the source's own status is reported separately.
  const freshness = <p className="stats-freshness"><span>Stats checked at {checkedTime(stats.checkedAt)}</span>{expected !== "pregame" && stats.sourceStatus.detail && <span>Source reports {stats.sourceStatus.detail}</span>}{pastTtl && !failure && online && <span className="stats-age">Checked {ago(age)}</span>}{pastTtl && !failure && online && expected !== "started" && <button type="button" className="stats-refresh" data-focus-key="stats-refresh" onClick={retry.onRetry} disabled={pending || retry.waitMs > 0}>{pending ? "Checking…" : "Check again"}</button>}</p>;
  if (display.mode === "catching-up") return <>{warnings}<Notice title="Stats catching up" live>{display.reason === "season-only" ? "Game stats are not available yet. The source is still reporting pregame information." : "The stats source has not caught up with the current game status yet."}</Notice>{freshness}</>;
  if (display.mode === "empty") return <>{warnings}<div className="stats-empty" role="status"><h3>No stats available yet</h3><p>Check again shortly, or open Gamecast for more game information.</p></div>{freshness}</>;
  const team = "kind" in stats.team ? stats.team : null;
  const partial = !!team && Object.values(team.rows).some(pair => pair[0] === null || pair[1] === null);
  const paused = game.state === "delayed" && game.started;
  return <>
    {warnings}
    {/* The scoreboard reports the pause; nothing proves when the source recorded these totals. */}
    {paused && <Notice title="Play is paused" detail={<>Stats checked {agoWords(age)}.</>}>Showing the latest game stats the source provided.</Notice>}
    {freshness}
    {team ? <Comparison game={game} rows={team.kind === "season" ? SEASON_ROWS : GAME_CORE} values={team.rows} label={heading(team.kind)} season={team.kind === "season"} />
      : <Notice title="Team stats unavailable">Player stats below remain available.</Notice>}
    {partial && <p className="stats-footnote">— means this value is unavailable. Supplied zeros remain zero.</p>}
    {team?.kind === "season" && <p className="stats-footnote">Season averages supplied before kickoff. These are not game totals.</p>}
    {team?.kind === "game" && <Disclosure id={`stats-${game.id}-details`} title="Team details" hint="7 more stats" label={`Team details for ${matchup}`} open={open.details} onToggle={() => toggle("details")}>
      <Comparison game={game} rows={GAME_DETAILS} values={team.rows} label="Additional team stats" />
      <p className="stats-footnote">Conversions are made / attempted. 0-0 means no attempts; it is not a calculated percentage.</p>
    </Disclosure>}
    {expected !== "pregame" && <Disclosure id={`stats-${game.id}-players`} title="Players" hint="Passing · rushing · receiving" label={`Players for ${matchup}`} open={open.players} onToggle={() => toggle("players")}>
      <Players game={game} stats={stats} />
    </Disclosure>}
  </>;
}
function heading(kind: "game" | "season") { return kind === "season" ? "Season averages" : "Team stats"; }
