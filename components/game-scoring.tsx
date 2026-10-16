"use client";
import type { ReactNode } from "react";
import type { Game } from "@/lib/football";
import { periodLabel, periodName, type ScoringDisplay } from "@/lib/game-scoring";

type Shown = Extract<ScoringDisplay, { mode: "scoring" }>["scoring"];
const missing = (label = "Unavailable") => <span className="stat-missing" aria-label={label}>—</span>;
const value = (v: number | null) => v === null ? missing() : v;

/** Scores by quarter and the source's scoring plays, in its order. Supplied values only. */
export function ScoringSummary({ game, scoring }: { game: Game; scoring: Shown }) {
  const [away, home] = game.teams, teams = [away, home], label = (i: number) => teams[i].abbreviation || teams[i].name;
  const { periods, plays } = scoring;
  let dash = false;

  let table: ReactNode;
  if ("unavailable" in periods) table = <p className="stats-footnote">Scores by quarter are unavailable for this game.</p>;
  else if (!periods.away.length) table = <p className="stats-footnote">No scores by quarter supplied yet.</p>;
  else {
    const labels = periods.away.map((_, i) => i + 1);
    const rows = [periods.away, periods.home].map((cells, i) => {
      if (periods.totals[i] === null || cells.includes(null)) dash = true;
      return <tr key={i}>
        <th scope="row" className="scoring-team"><span>{label(i)}</span><small>{i ? "home" : "away"}</small><span className="sr-only"> · {teams[i].name}</span></th>
        {cells.map((cell, p) => <td key={p}>{value(cell)}</td>)}
        <td className="scoring-total">{value(periods.totals[i])}</td>
      </tr>;
    });
    table = <>
      <div className="scoring-table-wrap" role="region" aria-label="Score by quarter" tabIndex={0} data-focus-key="scoring-periods">
        <table className="scoring-periods">
          <caption className="sr-only">Score by quarter · {away.name}, away; {home.name}, home</caption>
          <thead><tr><th scope="col" className="scoring-team"><span className="sr-only">Team</span></th>{labels.map(n => <th scope="col" key={n}><abbr title={periodName(n)}>{periodLabel(n)}</abbr></th>)}<th scope="col" className="scoring-total"><abbr title="Total">T</abbr></th></tr></thead>
          <tbody>{rows}</tbody>
        </table>
      </div>
      {periods.incomplete && <p className="stats-footnote">Quarter scores are incomplete and may not align correctly.</p>}
      {periods.mismatch && <p className="stats-footnote">Quarter scores don’t add up to the total yet. The source may still be catching up.</p>}
    </>;
  }

  let list: ReactNode;
  if ("unavailable" in plays) list = <p className="stats-footnote">{plays.unavailable === "too-many" ? "There are too many scoring plays to show here." : plays.unavailable === "order" ? "Scoring plays can’t be shown because the source’s order couldn’t be confirmed." : "Scoring plays aren’t available for this game."}</p>;
  else {
    const omitted = plays.omitted ?? 0;
    list = <>
      {!plays.items.length && !omitted && <p className="stats-footnote">No scoring plays supplied yet.</p>}
      {plays.items.length > 0 && <>
        <p className="legend">Score after each play: {label(0)}–{label(1)}</p>
        <ol className="scoring-plays" aria-labelledby="scoring-plays-h">{plays.items.map((play, i) => {
          if (play.period === null || play.clock === null || play.away === null || play.home === null || play.team === null) dash = true;
          const team = play.team === null ? null : teams[play.team];
          return <li className="scoring-play" key={i}>
            <span className="scoring-when"><span>{play.period === null ? missing("Period unavailable") : <abbr title={periodName(play.period)}>{periodLabel(play.period)}</abbr>}</span><span>{play.clock ?? missing("Clock unavailable")}</span></span>
            <span className="scoring-what">
              <span className="scoring-head">{team ? <><b>{team.abbreviation || team.name}</b><span className="sr-only"> ({team.name})</span></> : missing("Team unavailable")}{play.type && ` ${play.type}`}</span>
              {play.text && <span className="scoring-text">{play.text}</span>}
            </span>
            <span className="scoring-score">
              <span className="sr-only">Score after this play: {away.name} {play.away ?? "unavailable"}, {home.name} {play.home ?? "unavailable"}</span>
              <span aria-hidden="true"><span className={play.team === 0 ? "scoring-scorer" : undefined}>{value(play.away)}</span>–<span className={play.team === 1 ? "scoring-scorer" : undefined}>{value(play.home)}</span></span>
            </span>
          </li>;
        })}</ol>
      </>}
      {omitted > 0 && <p className="stats-footnote">{omitted === 1 ? "1 supplied scoring play isn’t shown because its details couldn’t be matched to this game." : `${omitted} supplied scoring plays aren’t shown because their details couldn’t be matched to this game.`}</p>}
      {plays.inconsistent && <p className="stats-footnote">These scoring plays don’t fully match the score. The source may be catching up or correcting them.</p>}
    </>;
  }

  return <>
    <h3 className="group-title" id="scoring-periods-h">Score by quarter</h3>
    {table}
    <h3 className="group-title" id="scoring-plays-h">Scoring plays</h3>
    {list}
    {dash && <p className="stats-footnote">— means this value is unavailable. Supplied zeros remain zero.</p>}
  </>;
}
