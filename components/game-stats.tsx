"use client";
import type { ReactNode } from "react";
import { ChevronRight, RefreshCw } from "lucide-react";
import type { Game } from "@/lib/football";
import type { Section } from "@/lib/game-route";
import { expectedPhase, GAME_CORE, GAME_DETAILS, LIVE_STATS_ENABLED, PLAYER_CATEGORIES, playerColumns, SEASON_ROWS, statsDisplay, statsTtl, type GameStats, type Pair, type PlayerCategory, type StatsPhase } from "@/lib/game-stats";
import { statsGeneration, useGameStats, type StatsState } from "@/lib/use-game-stats";

type Rows = readonly (readonly [string, string])[];
export const CATEGORY: Record<PlayerCategory, { title: string; columns: [string, string][] }> = {
  passing: { title: "Passing", columns: [["C/A", "completions/attempts"], ["YDS", "yards"], ["TD", "touchdowns"], ["INT", "interceptions"]] },
  rushing: { title: "Rushing", columns: [["ATT", "attempts"], ["YDS", "yards"], ["TD", "touchdowns"]] },
  receiving: { title: "Receiving", columns: [["REC", "receptions"], ["YDS", "yards"], ["TD", "touchdowns"]] },
};
// Neutral share bars: plain yard counts only, both present and non-negative. Never composites, rates or a winner.
const SHARE_ROWS = new Set(["totalYards", "netPassingYards", "rushingYards"]);
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
function Share({ pair }: { pair: Pair | undefined }) {
  if (!pair || pair[0] === null || pair[1] === null || !/^\d+$/.test(pair[0]) || !/^\d+$/.test(pair[1])) return null;
  const away = Number(pair[0]), home = Number(pair[1]);
  return away + home > 0 ? <span className="share" aria-hidden="true"><span style={{ flexGrow: away }} /><span style={{ flexGrow: home }} /></span> : null;
}
// Mirrored comparison: away value · stat · home value. The row header sits in the middle, so each
// value names its headers explicitly; a header before a cell does not otherwise apply to it.
function Comparison({ game, id, rows, values, label, title, season = false }: { game: Game; id: string; rows: Rows; values: Record<string, Pair>; label: string; title?: string; season?: boolean }) {
  const [away, home] = game.teams;
  return <div className="compare-group">
    {title && <h3 className="group-title">{title}</h3>}
    <table className="stats-table compare-table">
      <caption className="sr-only">{label} · {away.name}, away; {home.name}, home</caption>
      <thead><tr>
        <th scope="col" id={`${id}-away`} className="c-away"><span>{away.abbreviation || away.name}</span><small>away</small><span className="sr-only"> · {away.name}</span></th>
        <th scope="col" className="c-label">{season ? "Season average" : "Team stat"}</th>
        <th scope="col" id={`${id}-home`} className="c-home"><span>{home.abbreviation || home.name}</span><small>home</small><span className="sr-only"> · {home.name}</span></th>
      </tr></thead>
      <tbody>{rows.map(([key, name]) => <tr key={key}>
        <td className="c-away" headers={`${id}-${key} ${id}-away`}><Value value={values[key]?.[0]} /></td>
        <th scope="row" id={`${id}-${key}`} className="c-label"><span className="row-label">{name}{season && <span className="stat-unit">per game</span>}</span>{!season && SHARE_ROWS.has(key) && <Share pair={values[key]} />}</th>
        <td className="c-home" headers={`${id}-${key} ${id}-home`}><Value value={values[key]?.[1]} /></td>
      </tr>)}</tbody>
    </table>
  </div>;
}
// `waitMs` is null while a backoff is set but the age clock has not ticked yet: the wait is real but unmeasured.
type Retry = { onRetry: () => void; pending: boolean; waitMs: number | null };
// Only the title and stable sentence are a polite live region. Changing age and
// countdown text sits outside it, so it never re-announces on a timer tick.
function Notice({ title, children, detail, warning = false, live = false, retry, action }: { title: string; children: ReactNode; detail?: ReactNode; warning?: boolean; live?: boolean; retry?: Retry; action?: ReactNode }) {
  const waiting = !!retry && !retry.pending && retry.waitMs !== 0;
  return <div className={`stats-notice ${warning ? "warning" : ""}`}>
    <div role={live ? "status" : undefined}><strong>{title}</strong><p>{children}</p></div>
    {detail && <p className="stats-notice-detail">{detail}</p>}
    {retry && <button type="button" data-focus-key="stats-retry" onClick={retry.onRetry} disabled={retry.pending || waiting}><RefreshCw size={13} aria-hidden="true" />{retry.pending ? "Retrying…" : waiting && retry.waitMs ? `Retry in ${wait(retry.waitMs)}` : "Retry"}</button>}
    {action}
  </div>;
}
function Players({ game, stats }: { game: Game; stats: GameStats }) {
  const players = stats.players;
  if (!("teams" in players)) return <Notice title="Player stats unavailable">{players.unavailable === "too-large" ? "The player box score is too large to show here. Team stats remain available." : "Player stats were not supplied for this game. Team stats remain available."}</Notice>;
  // Negative source IDs are team-attributed entries; the source supplies their name.
  const teamEntry = players.teams.some(entry => "categories" in entry && PLAYER_CATEGORIES.some(c => { const rows = entry.categories[c]; return "rows" in rows && rows.rows.some(row => row.athleteId.startsWith("-")); }));
  // The completeness claim holds only when every category for both teams is listed.
  const complete = players.teams.every(entry => "categories" in entry && PLAYER_CATEGORIES.every(c => "rows" in entry.categories[c]));
  // One continuous document: every supplied row, in away/home order. No ranking, top-N or Show all.
  const groups = PLAYER_CATEGORIES.map(category => {
    const meta = CATEGORY[category], labels = playerColumns(category);
    return <section className="category" id={`cat-${category}`} data-category={category} aria-labelledby={`cat-${category}-h`} key={category}>
      <div className="category-head"><h3 id={`cat-${category}-h`} tabIndex={-1}>{meta.title}</h3><p className="legend">{meta.columns.map(([short, long]) => `${short}: ${long}`).join(" · ")}</p></div>
      <div className="category-teams">{game.teams.map((team, i) => {
        const entry = players.teams[i], rows = "categories" in entry ? entry.categories[category] : entry;
        return <div className="category-team" key={team.id}>
          <h4 className="player-team-label">{team.name} <small>{i ? "home" : "away"}</small></h4>
          {!("rows" in rows) ? <Notice title={`${team.name} ${category} unavailable`}>Team stats and the other player sections remain available.</Notice>
            : !rows.rows.length ? <p className="stats-footnote">No {category} entries supplied.</p>
            : <>
              <div className="player-table-wrap" role="region" aria-label={`${team.name} ${category} statistics`} tabIndex={0} data-focus-key={`stats-${category}-${i}`}>
                <table className="player-table"><caption className="sr-only">{team.name} · {meta.title}</caption>
                  <thead><tr><th scope="col">Player</th>{meta.columns.map(([short, long]) => <th scope="col" key={short}><abbr title={long}>{short}</abbr></th>)}</tr></thead>
                  <tbody>{rows.rows.map((row, r) => <tr key={`${row.athleteId}-${r}`} className={row.athleteId.startsWith("-") ? "team-entry" : undefined}><th scope="row">{row.name ?? <span className="stat-missing">Name unavailable</span>}</th>{labels.map(label => <td key={label}><Value value={row.values[label]} /></td>)}</tr>)}</tbody>
                </table>
              </div>
              {rows.unaligned ? <p className="stats-footnote">These {category} values could not be matched to their columns, so they are shown as unavailable (—).</p>
                : rows.rows.some(row => Object.values(row.values).some(value => value === null)) && <p className="stats-footnote">— marks a value that is unavailable.</p>}
            </>}
        </div>;
      })}</div>
    </section>;
  });
  return <>{groups}<p className="stats-footnote players-footer">{complete ? "All participants supplied for these categories are shown." : "All participants supplied are shown for the listed categories. Categories marked unavailable are not shown."}{teamEntry && " “Team” is a team-attributed entry from the source."}</p></>;
}

/** Hook wrapper: mounted only on the game screen of an eligible game, so the board does no stats work. */
export function GameStatsScreen({ game, section, onSection, jump, onJump }: { game: Game; section: Section; onSection: (section: Section, focusHeading?: boolean) => void; jump?: PlayerCategory; onJump?: (category: PlayerCategory) => void }) {
  const { state, now, online, retry } = useGameStats(game, true);
  return <GameStatsView game={game} state={state} now={now} online={online} retry={retry} section={section} onSection={onSection} jump={jump} onJump={onJump} />;
}

type ViewProps = { game: Game; state: StatsState | null; now: number; online: boolean; retry: () => void; section: Section; onSection?: (section: Section, focusHeading?: boolean) => void; jump?: PlayerCategory; onJump?: (category: PlayerCategory) => void };
/** Pure rendering of one game's stats state: section navigation, Team stats and Player stats. */
export function GameStatsView({ game, state, now, online, retry, section, onSection = () => {}, jump = "passing", onJump = () => {} }: ViewProps) {
  const expected = expectedPhase(game), [away, home] = game.teams, matchup = `${away.name} vs ${home.name}`;
  // Exceptional states are status-first and make no stats request.
  if (expected === null) {
    const body = /postpon/i.test(game.status) ? "This game is reported as postponed. Stats are not shown for this status." : /forfeit|no contest/i.test(game.status) ? "This is a reported game status. A played final is not implied." : /cancel/i.test(game.status) ? "This game will not be played as scheduled." : "Stats are not shown for this game status.";
    return <div className="game-body"><section className="status-first" aria-label={`Game status for ${matchup}`}><h2>{game.status}</h2><p>{body}</p></section></div>;
  }
  const heading = expected === "pregame" ? "Season averages" : "Team stats";
  const phaseLabel = expected === "pregame" ? "Pregame" : expected === "final" ? "Final" : "This game";
  const players = section === "players";
  // The controller owns the gate; before its first state the constant decides, so no spinner flashes.
  // Rendered state must belong to this game's full generation; a snapshot must also match its identity.
  const current = state?.generation === statsGeneration(game) ? state : null;
  const disabled = current ? current.mode === "disabled" : expected === "started" && !LIVE_STATS_ENABLED;
  const candidate = current?.snapshot ?? null;
  const snapshot = candidate && candidate.eventId === game.id && candidate.teamIds[0] === away.id && candidate.teamIds[1] === home.id ? candidate : null;
  const pending = current?.pending ?? null, failure = current?.failure ?? null;
  // Rendering reads only the supplied clock (`now`); the controller still refuses any attempt before `retryAt`.
  const retryAt = current?.retryAt ?? 0;
  const retryState: Retry = { onRetry: retry, pending: !!pending, waitMs: retryAt <= 0 ? 0 : now ? Math.max(0, retryAt - now) : null };
  const display = snapshot ? statsDisplay(snapshot, expected) : null;
  const hasBody = !disabled && !!display && (display.mode === "stats" || display.mode === "players-only");
  const showJumps = players && hasBody && "teams" in snapshot!.players;

  let status: ReactNode;
  if (disabled) status = <div className="stats-empty" role="status"><h3>Live stats are not available yet</h3><p>Stats for games in progress are not shown here. The score and game details are still available.</p></div>;
  else if (!snapshot) {
    if (!online) status = <Notice title="You’re offline" warning live>Stats will load when you reconnect. The score and game details are still available.</Notice>;
    else if (failure && !pending) status = <Notice title="Stats could not be loaded" warning live retry={retryState}>The score and game details are still available. Try again.</Notice>;
    else status = <div className="stats-loading" role="status"><p>{pending === "waiting" ? "Waiting to load team stats…" : "Loading team stats…"}</p>{Array.from({ length: 8 }, (_, i) => <div className="skeleton-row" aria-hidden="true" key={i}><span /><span /><span /></div>)}</div>;
  } else status = <StatsStatus game={game} stats={snapshot} expected={expected} now={now} online={online} failure={!!failure} retry={retryState} />;

  const head = (id: string, title: string) => <div className="panel-head"><h2 id={id} tabIndex={-1}>{title}</h2><span className="stats-phase">{phaseLabel}</span></div>;
  const team = hasBody && "kind" in snapshot!.team ? snapshot!.team : null;
  const partial = !!team && Object.values(team.rows).some(pair => pair[0] === null || pair[1] === null);
  return <>
    <nav className="view-nav" id="view-nav" aria-label="Game sections">
      <div className="view-switch">
        <button type="button" data-focus-key="view-team" aria-controls="panel-team" aria-pressed={!players} onClick={() => onSection("team")}>Team stats</button>
        <button type="button" data-focus-key="view-players" aria-controls="panel-players" aria-pressed={players} onClick={() => onSection("players")}>Player stats</button>
      </div>
      {showJumps && <div className="jump-links" role="group" aria-label="Jump to player category">{PLAYER_CATEGORIES.map(c => <button type="button" key={c} data-jump={c} data-focus-key={`jump-${c}`} aria-current={jump === c ? "true" : undefined} onClick={() => onJump(c)}>{CATEGORY[c].title}</button>)}</div>}
    </nav>
    <div className="game-body">
      <section className="panel" id="panel-team" aria-labelledby={players ? undefined : "team-h"} aria-label={players ? heading : undefined} hidden={players}>
        {!players && <>
          {head("team-h", heading)}
          {status}
          {hasBody && (team ? <>
            {team.kind === "season"
              ? <Comparison game={game} id="cmp-season" rows={SEASON_ROWS} values={team.rows} label="Season averages" season />
              : <>
                <Comparison game={game} id="cmp-core" rows={GAME_CORE} values={team.rows} label="Team stats" title="Headline stats" />
                <Comparison game={game} id="cmp-details" rows={GAME_DETAILS} values={team.rows} label="Additional team stats" title="Attempts, efficiency and ball security" />
              </>}
            {partial && <p className="stats-footnote">— means this value is unavailable. Supplied zeros remain zero.</p>}
            {team.kind === "season" && <p className="stats-footnote">Season averages supplied before kickoff. These are not game totals.</p>}
            {team.kind === "game" && <p className="stats-footnote">Conversions are made / attempted. 0-0 means no attempts; it is not a calculated percentage.</p>}
            {expected !== "pregame" && <button type="button" className="next-view" data-focus-key="to-players" onClick={() => onSection("players", true)}><span>Player stats</span><small>Passing · rushing · receiving</small><ChevronRight size={18} aria-hidden="true" /></button>}
          </> : <Notice title="Team stats unavailable" action={<button type="button" data-focus-key="notice-players" onClick={() => onSection("players", true)}>View player stats</button>}>Player stats remain available.</Notice>)}
        </>}
      </section>
      <section className="panel" id="panel-players" aria-labelledby={players ? "players-h" : undefined} aria-label={players ? undefined : "Player stats"} hidden={!players}>
        {players && <>
          {head("players-h", "Player stats")}
          {expected === "pregame"
            ? <div className="stats-empty"><h3>Player stats start after kickoff</h3><p>Before kickoff, Team stats shows each team’s season averages.</p></div>
            : <>{status}{hasBody && <Players game={game} stats={snapshot!} />}</>}
        </>}
      </section>
    </div>
  </>;
}

// Notices first, then retrieval time and the source's own status, shared by both sections.
function StatsStatus({ game, stats, expected, now, online, failure, retry }: { game: Game; stats: GameStats; expected: StatsPhase; now: number; online: boolean; failure: boolean; retry: Retry }) {
  const pending = retry.pending;
  const display = statsDisplay(stats, expected), age = Math.max(0, (now || Date.parse(stats.checkedAt)) - Date.parse(stats.checkedAt));
  const pastTtl = age > statsTtl(expected);
  const warnings = <>
    {failure && online && <Notice title="Stats may be out of date" warning live retry={retry} detail={<>Showing stats checked {agoWords(age)}. Scores refresh separately.</>}>Refresh failed. Showing the last loaded stats.</Notice>}
    {!online && <Notice title="Offline · saved stats" warning live detail={<>Showing stats checked {agoWords(age)}.</>}>Showing the last loaded game stats. They may be out of date.</Notice>}
  </>;
  // Retrieval time is the only timestamp shown; the source's own status is reported separately.
  const freshness = <p className="stats-freshness"><span>Stats checked at {checkedTime(stats.checkedAt)}</span>{expected !== "pregame" && stats.sourceStatus.detail && <span>Source reports {stats.sourceStatus.detail}</span>}{pastTtl && !failure && online && <span className="stats-age">Checked {ago(age)}</span>}{pastTtl && !failure && online && expected !== "started" && <button type="button" className="stats-refresh" data-focus-key="stats-refresh" onClick={retry.onRetry} disabled={pending || retry.waitMs !== 0}>{pending ? "Checking…" : "Check again"}</button>}</p>;
  if (display.mode === "catching-up") return <>{warnings}<Notice title="Stats catching up" live>{display.reason === "season-only" ? "Game stats are not available yet. The source is still reporting pregame information." : "The stats source has not caught up with the current game status yet."}</Notice>{freshness}</>;
  if (display.mode === "empty") return <>{warnings}<div className="stats-empty" role="status"><h3>No stats available yet</h3><p>The source has not supplied stats for this game yet.</p></div>{freshness}</>;
  const paused = game.state === "delayed" && game.started;
  return <>
    {warnings}
    {/* The scoreboard reports the pause; nothing proves when the source recorded these totals. */}
    {paused && <Notice title="Play is paused" detail={<>Stats checked {agoWords(age)}.</>}>Showing the latest game stats the source provided.</Notice>}
    {freshness}
  </>;
}
