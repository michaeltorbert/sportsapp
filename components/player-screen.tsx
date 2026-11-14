"use client";
import { useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Signal } from "lucide-react";
import { gameDay } from "./game-screen";
import { PLAYER_CATEGORIES, PLAYER_FIELDS, playerAggregates, playerGameHidden, type PlayerCategory, type PlayerRequest, type PlayerSeason, type PlayerStats } from "@/lib/player-season";
import type { DukePreferences } from "@/lib/duke-visibility";
const names = { passing: "Passing", rushing: "Rushing", receiving: "Receiving" };
const core = { passing: ["COMPLETIONS", "ATT", "YDS", "TD", "INT"], rushing: ["CAR", "YDS", "TD"], receiving: ["REC", "YDS", "TD"] };
const plain = (e: React.MouseEvent) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
function value(n: number | null | undefined, key: string) { return n === null || n === undefined ? "Unavailable" : key === "PCT" ? `${(n * 100).toFixed(1)}%` : n.toLocaleString("en-US", { maximumFractionDigits: 3 }); }
function Metrics({ stats, category, log = false }: { stats: PlayerStats; category: PlayerCategory; log?: boolean }) {
  const values = stats[category]; if (!values) return null;
  const fields = PLAYER_FIELDS[category].filter(([key]) => Object.hasOwn(values, key));
  const main = log ? fields.filter(([key]) => core[category].includes(key)) : fields;
  const extra = log ? fields.filter(([key]) => !core[category].includes(key)) : [];
  const rows = (items: typeof fields) => <dl className={log ? "player-game-metrics" : "player-metrics"}>{items.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{value(values[key], key)}</dd></div>)}</dl>;
  return <section className="player-category" aria-label={`${names[category]} ${log ? "game" : "season"} statistics`}><h3>{names[category]}</h3>{rows(main)}{extra.length > 0 && <details className="player-extra"><summary>More {category} statistics</summary>{rows(extra)}</details>}</section>;
}
function Notice({ title, children }: { title: string; children: ReactNode }) { return <div className="player-notice"><strong>{title}</strong><p>{children}</p></div>; }
export type PlayerScreenProps = { request: PlayerRequest; season: PlayerSeason | null; identity?: PlayerSeason | null; pending: boolean; failed: boolean; online: boolean; prefs: DukePreferences | null;
  back: { title: string; detail: string; label: string }; onBack: () => void; onRetry: () => void; onSeason: (year: number, stintTeam?: string) => void;
  gameHref: (id: string) => string; onGame: (id: string) => void; teamHref: (id: string) => string; onTeam: (id: string) => void; notice?: ReactNode };
export function PlayerScreen({ request, season, identity, pending, failed, online, prefs, back, onBack, onRetry, onSeason, gameHref, onGame, teamHref, onTeam, notice }: PlayerScreenProps) {
  const [category, setCategory] = useState<PlayerCategory | "all">("all");
  const year = request.year, known = season ?? identity;
  const totals = season ? playerAggregates(season, prefs) : null;
  const choices = known?.choices ?? [{ year, teams: [] }];
  const selected = choices.find(c => c.year === year);
  const categories = season ? PLAYER_CATEGORIES.filter(c => !!season.totals[c] || season.logs.some(l => !!l.stats[c])) : [];
  const visibleCategory = categories.includes(category as PlayerCategory) ? category : "all";
  const supplied = season?.logs.filter(l => Object.keys(l.stats).length > 0).length ?? 0, completed = season?.logs.filter(l => l.game.state === "final").length ?? 0;
  return <div className="game-screen team-screen player-screen"><header className="game-bar"><button className="back-button" type="button" data-focus-key="back" aria-label={back.label} onClick={onBack}><ChevronLeft size={22} aria-hidden="true" /><span className="back-text" aria-hidden="true"><span>{back.title}</span><small>{back.detail}</small></span></button><span className="team-bar-title">Player</span><span className="bar-brand" aria-hidden="true"><span className="brand-icon"><Signal size={17} strokeWidth={3} /></span></span></header>{notice}
    <header className="player-head"><h1 className="player-title" tabIndex={-1}>{known?.name ?? (pending ? "Loading player…" : "Player")}</h1>{known && <p className="player-meta">{known.position && <>{known.position} · </>}{season?.team?.name ?? (season?.needsTeamChoice ? "Choose a team below" : "Team unavailable")}</p>}
      {known?.currentTeam && <a className="player-team-link" data-focus-key="player-current-team" href={teamHref(known.currentTeam.id)} onClick={e => { if (plain(e)) { e.preventDefault(); onTeam(known.currentTeam!.id); } }}>Current team page · {known.currentTeam.name}<ChevronRight size={15} aria-hidden="true" /></a>}
    </header>
    <div className="player-season-choice"><label htmlFor="player-season">Season</label><select id="player-season" value={year} onChange={e => { setCategory("all"); onSeason(Number(e.target.value)); }}>
      {!choices.some(c => c.year === year) && <option value={year}>{year}</option>}{choices.map(c => <option key={c.year} value={c.year}>{c.year}{c.teams.length ? ` · ${c.teams.join(" / ")}` : ""}</option>)}
    </select><p>{year} · Regular season</p>
      {selected && selected.teams.length > 1 && <><label htmlFor="player-stint">Team for {year}</label><select id="player-stint" value={request.stintTeam ?? ""} onChange={e => onSeason(year, e.target.value || undefined)}><option value="">Choose team</option>{selected.teams.map(t => <option key={t} value={t}>{t}</option>)}</select></>}
    </div>
    {!season ? <div className="player-unavailable" role="status"><Notice title={pending ? `Loading ${year} statistics…` : `${year} statistics couldn’t be loaded`}>{pending ? "Your selected season will stay the same." : online ? "Try again. Your selected season hasn’t changed." : "You’re offline. Your selected season hasn’t changed."}</Notice>{!pending && <button type="button" className="notice-button" onClick={onRetry} disabled={!online}>Retry</button>}</div> : <>
      {(season.stale || failed) && <Notice title="Refresh delayed">Showing the last checked statistics for {year}.</Notice>}
      {!season.historyAvailable && <Notice title="Previous seasons couldn’t be loaded">The selected season is still available.<button type="button" onClick={onRetry} disabled={pending || !online}>Retry</button></Notice>}
      {season.needsTeamChoice ? <Notice title={`Choose a team for ${year}`}>The source lists more than one team for this season. Statistics are shown separately.</Notice> : <>
      <section className="player-block" aria-labelledby="player-totals-h"><h2 id="player-totals-h">Season totals</h2>
        {!totals?.shown ? <Notice title={totals?.reason === "checking" ? "Checking your Duke settings…" : totals?.reason === "hidden" ? "Season statistics hidden" : "Season statistics not shown yet"}>{totals?.reason === "hidden" ? "They include a Duke game your settings are hiding." : "We can’t yet confirm which season statistics can be shown."}</Notice> : !season.totalsAvailable ? <p className="player-empty">No season totals supplied for this player.</p> : PLAYER_CATEGORIES.map(c => <Metrics key={c} stats={season.totals} category={c} />)}
      </section>
      <section className="player-block" aria-labelledby="player-log-h"><h2 id="player-log-h">Game log</h2>{totals?.shown && <p className="player-coverage">Player statistics available for {supplied} of {completed} completed team games.</p>}
        {season.logs.some(l => l.game.state === "final" && !l.boxSupplied) && <Notice title="Part of the game log couldn’t be loaded">Games with unavailable statistics are marked below.</Notice>}
        {categories.length > 1 && <div className="player-filters" role="group" aria-label="Game log category">{(["all", ...categories] as const).map(c => <button key={c} type="button" aria-pressed={visibleCategory === c} onClick={() => setCategory(c)}>{c === "all" ? "All categories" : names[c]}</button>)}</div>}
        {season.logs.length ? <ol className="player-log">{season.logs.map(({ game, stats, boxSupplied }) => {
          const hidden = playerGameHidden(game, prefs), opponent = game.teams.find(t => t.id !== season.team?.id), self = game.teams.find(t => t.id === season.team?.id);
          return <li key={game.id}><p className="player-date">{gameDay(game.date) ?? "Date not announced"}</p>{hidden ? <p className="player-empty">Duke game hidden by your settings</p> : <>
            <a className="player-game-link" href={gameHref(game.id)} data-focus-key={`player-game-${game.id}`} onClick={e => { if (plain(e)) { e.preventDefault(); onGame(game.id); } }}><span><small>{game.neutralSite === true || game.teams[1].id === season.team?.id ? "vs" : "at"}</small>{opponent?.name ?? "Opponent unavailable"}</span><ChevronRight size={18} aria-hidden="true" /></a>
            {game.state === "final" && self?.score !== null && opponent?.score !== null && self && opponent && <p className="player-result">Final · {self.score! > opponent.score! ? "Won" : self.score! < opponent.score! ? "Lost" : "Tied"} {self.score}–{opponent.score}{game.neutralSite === true ? " · Neutral site" : ""}</p>}
            {game.state !== "final" ? <p className="player-empty">No completed-game statistics supplied.</p> : !boxSupplied ? <p className="player-empty">Game statistics couldn’t be loaded.</p> : !Object.keys(stats).length ? <p className="player-empty">No player statistics supplied.</p> : <>{PLAYER_CATEGORIES.filter(c => visibleCategory === "all" || c === visibleCategory).map(c => <Metrics key={c} stats={stats} category={c} log />)}{visibleCategory !== "all" && !stats[visibleCategory] && <p className="player-empty">No statistics supplied for this category.</p>}</>}
          </>}</li>;
        })}</ol> : <p className="player-empty">No regular-season games supplied.</p>}
      </section></>}
      <p className="player-fresh">Checked {new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(new Date(season.checkedAt))} ET. Source update time unknown.</p>
    </>}
  </div>;
}
