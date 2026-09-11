"use client";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "./ui/sheet";
import { classify, easternDate, type Scoreboard } from "@/lib/football";
import { compactGuideTime, coordinate, fullGameLabel, gameColor, guideBoard, guideTime, HOUR, kickoff, LANE_HEIGHT, matchup, networks, tickLabel, watched, type GuideMode } from "@/lib/guide";

const SCALE = 90, LABEL_WIDTH = 80, AXIS_HEIGHT = 40;
type Anchor = { date: string; time: number; network: string; offset: number; order: string[] };

export function GuideTimeline({ board, mode, now, followToday }: { board: Scoreboard; mode: GuideMode; now: number; followToday: boolean }) {
  const model = useMemo(() => guideBoard(board, mode), [board, mode]);
  const scroller = useRef<HTMLDivElement>(null), anchor = useRef<Anchor | null>(null);
  const opener = useRef<HTMLElement | null>(null), focusFallback = useRef<HTMLSpanElement>(null);
  const restoringFocus = useRef(false);
  const [selected, setSelected] = useState<string | null>(null);
  const game = model.games.find(g => g.id === selected);
  // A removed listing closes its details permanently, even if a later poll restores it.
  if (selected !== null && !game) setSelected(null);
  const width = model.start !== null && model.end !== null ? coordinate(model.end, model.start, SCALE) : 0;
  const rows = model.lanes.map((lane, i, list) => ({ ...lane, top: list.slice(0, i).reduce((n, l) => n + l.tracks * LANE_HEIGHT, 0) }));
  const saveAnchor = () => {
    const el = scroller.current; if (!el || model.start === null) return;
    const row = rows.find(row => row.top + row.tracks * LANE_HEIGHT > el.scrollTop) || rows.at(-1);
    anchor.current = { date: board.date, time: model.start + el.scrollLeft / SCALE * HOUR, network: row?.key || "", offset: el.scrollTop - (row?.top || 0), order: rows.map(row => row.key) };
  };
  useLayoutEffect(() => {
    const el = scroller.current; if (!el || model.start === null) return;
    const old = anchor.current;
    if (!old || old.date !== board.date) {
      el.scrollTop = 0;
      el.scrollLeft = followToday && now >= model.start && now <= (model.end || 0) ? Math.max(0, coordinate(now, model.start, SCALE) - 50) : 0;
    } else {
      el.scrollLeft = Math.max(0, coordinate(old.time, model.start, SCALE));
      const row = rows.find(r => r.key === old.network) || old.order.slice(old.order.indexOf(old.network) + 1).map(key => rows.find(r => r.key === key)).find(Boolean) || rows.at(-1);
      el.scrollTop = row ? row.top + Math.max(0, Math.min(old.offset, row.tracks * LANE_HEIGHT - 1)) : 0;
    }
    saveAnchor();
    // Restore the semantic anchor when data/filter layout changes, never on clock ticks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, board.date]);
  useLayoutEffect(() => {
    const viewport = scroller.current; if (!viewport) return;
    let frame = 0, cancelled = false;
    const fitLabels = () => {
      const view = viewport.getBoundingClientRect();
      const measurements = Array.from(viewport.querySelectorAll<HTMLElement>(".guide-game-text"), label => {
        const bar = label.parentElement!.getBoundingClientRect();
        // Keep the label inside the portion of its estimated window currently visible.
        const available = Math.max(0, Math.min(bar.right - 5, view.right - 2) - Math.max(bar.left, view.left + 88));
        const full = label.querySelector<HTMLElement>(".guide-label-measure")!;
        return { label, available, abbreviated: String(full.offsetWidth + 7 > available) };
      });
      for (const { label, available, abbreviated } of measurements) {
        label.style.maxWidth = `${available}px`;
        label.dataset.abbreviated = abbreviated;
      }
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(fitLabels); };
    const observer = new ResizeObserver(schedule); observer.observe(viewport);
    viewport.addEventListener("scroll", schedule, { passive: true });
    void document.fonts.ready.then(() => { if (!cancelled) schedule(); });
    fitLabels();
    return () => { cancelled = true; cancelAnimationFrame(frame); observer.disconnect(); viewport.removeEventListener("scroll", schedule); };
  }, [model, mode]);
  const openGame = (id: string, target: HTMLElement) => { opener.current = target; setSelected(id); };
  const reveal = (target: HTMLElement) => {
    const el = scroller.current; if (!el) return;
    const bounds = target.getBoundingClientRect(), view = el.getBoundingClientRect();
    if (bounds.left < view.left + LABEL_WIDTH || bounds.left > view.right - 60) el.scrollLeft += bounds.left - view.left - LABEL_WIDTH - 2;
    if (bounds.top < view.top + AXIS_HEIGHT) el.scrollTop -= view.top + AXIS_HEIGHT - bounds.top;
    else if (bounds.bottom > view.bottom) el.scrollTop += bounds.bottom - view.bottom;
    saveAnchor();
  };
  const ticks: number[] = [];
  if (model.start !== null && model.end !== null) for (let t = model.start; t < model.end; t += HOUR) ticks.push(t);
  return <>
    <div className="guide-canvas-toolbar"><span ref={focusFallback} className="guide-count" tabIndex={-1} data-testid="guide-count">{model.games.length} {model.games.length === 1 ? "game" : "games"} listed{mode === "watch" ? ` · ${model.allCount} on this day` : ""}</span>
      {mode === "all" && model.games.some(watched) && <span className="guide-watch-legend" title="ACC, Top 25, close games or upset watch"><span aria-hidden="true">★</span> Watchlist</span>}
      {rows.length > 0 && model.start !== null && <button className="guide-jump" aria-label={now >= model.start! && now <= model.end! ? "Now — jump to current time" : "Start — jump to schedule start"} onClick={() => { const el = scroller.current; if (el) { el.scrollLeft = now >= model.start! && now <= model.end! ? Math.max(0, coordinate(now, model.start!, SCALE) - 50) : 0; saveAnchor(); } }}>{now >= model.start && now <= model.end! ? "Now" : "Start"}</button>}</div>
    {model.games.length === 0 ? <div className="guide-empty"><h2>{mode === "watch" && model.allCount ? "No Watchlist games on this day" : "No games listed for this day"}</h2><p>{mode === "watch" && model.allCount ? "Choose All games to see the full schedule." : "Choose another date or check ESPN for schedule updates."}</p></div> : <>
      {rows.length > 0 && <><p id="guide-pan-help" className="guide-pan-help">Swipe to explore · Tab to games, arrow keys to scroll</p><div ref={scroller} className="guide-viewport" role="region" aria-label="Network and time schedule" aria-describedby="guide-pan-help guide-estimates" tabIndex={0} onScroll={saveAnchor}>
        <div className="guide-canvas" style={{ width: width + LABEL_WIDTH, "--guide-hour-width": `${SCALE}px` } as React.CSSProperties}>
          <div className="guide-axis"><span className="guide-corner">ET</span><div className="guide-hours" style={{ width }}>{ticks.map(t => <span key={t} style={{ left: coordinate(t, model.start!, SCALE) }}><span>{tickLabel(t)}</span>{easternDate(new Date(t)) !== board.date && <small>{easternDate(new Date(t)).slice(5)}</small>}</span>)}</div></div>
          {rows.map(lane => <section key={lane.key} className="guide-network" data-network={lane.key} style={{ height: lane.tracks * LANE_HEIGHT }} aria-label={lane.name}>
            <h2 className="guide-network-name"><span>{lane.name}</span></h2><div className="guide-track" style={{ width }}>
              <ul aria-label={`${lane.name} games`}>{lane.games.map(p => <li key={p.game.id} style={{ left: coordinate(p.start, model.start!, SCALE), top: p.track * LANE_HEIGHT, width: coordinate(p.end, p.start, SCALE) }}>
                <button className="guide-game" data-game={p.game.id} data-start={p.start} data-end={p.end} style={{ "--game-color": gameColor(p.game.id) } as React.CSSProperties} onFocus={event => { if (!restoringFocus.current && event.currentTarget.matches(":focus-visible")) reveal(event.currentTarget); }} onClick={event => openGame(p.game.id, event.currentTarget)}>
                  <span className="guide-game-bar"><span className="guide-game-text">{["full", "short", "measure"].map(variant => <span key={variant} className={`guide-label-${variant}`} aria-hidden={variant === "measure" ? true : undefined}><b>{compactGuideTime(p.start)}</b> {mode === "all" && watched(p.game) && <span className="guide-watch-star" aria-hidden="true">★</span>} {matchup(p.game, variant === "short")}{p.game.state !== "upcoming" && <em> · {p.game.state === "live" ? "Live" : p.game.state === "final" ? "Final" : p.game.status}</em>}</span>)}</span></span>
                  {" "}<span className="sr-only">{fullGameLabel(p.game)}. Estimated 3½-hour window; actual end unknown.</span>
                </button>
              </li>)}</ul>
            </div>
          </section>)}
          {model.start !== null && model.end !== null && now >= model.start && now <= model.end && <div className="guide-now" aria-hidden="true" style={{ left: LABEL_WIDTH + coordinate(now, model.start, SCALE), top: AXIS_HEIGHT }}><span>Now</span></div>}
        </div>
      </div></>}
      {model.tbd.length > 0 && <section className="guide-tbd"><h2>Time TBD</h2><ul>{model.tbd.map(g => <li key={g.id}><button onClick={event => openGame(g.id, event.currentTarget)}><strong>{matchup(g)}</strong><span>{g.state !== "upcoming" && `${g.state === "live" ? "Live" : g.state === "final" ? "Final" : g.status} · `}Listed on {networks(g).join(" / ")}{watched(g) ? " · Watchlist" : ""}</span>{" "}<span className="sr-only">{fullGameLabel(g)}</span></button></li>)}</ul></section>}
      <details className="guide-text-schedule"><summary>Text schedule</summary><ol>{model.games.map(g => <li key={g.id}><a href={g.url} target="_blank" rel="noopener noreferrer">{fullGameLabel(g)} · Gamecast ↗</a></li>)}</ol></details>
    </>}
    <p id="guide-estimates" className="guide-estimates">Bars show estimated 3½-hour windows; actual end times vary.</p>
    <Sheet open={!!game} onOpenChange={open => { if (!open) setSelected(null); }}><SheetContent side="bottom" className="guide-details" onCloseAutoFocus={event => { event.preventDefault(); const target = opener.current?.isConnected ? opener.current : scroller.current?.isConnected ? scroller.current : focusFallback.current; restoringFocus.current = true; target?.focus({ preventScroll: true }); restoringFocus.current = false; }}><SheetHeader><SheetTitle>{game ? game.teams.map(t => t.name).join(" at ") : "Game details"}</SheetTitle><SheetDescription>{game ? `${kickoff(game) === null ? "Time TBD" : guideTime(kickoff(game)!) + " Eastern"} · ${board.date} · ${game.status}` : ""}</SheetDescription></SheetHeader>{game && <div className="guide-details-body"><p>Listed on {networks(game).join(" / ")}</p>{game.teams.map(t => <p key={t.id}><strong>{t.rank !== null ? `No. ${t.rank} ` : ""}{t.name}</strong>{t.record ? ` · ${t.record}` : ""}{game.started && t.score !== null ? ` · ${t.score} points` : ""}</p>)}{watched(game) && <p>★ Watchlist · {Object.entries(classify(game)).filter(([, value]) => value).map(([key]) => ({ acc: "ACC", top25: "Top 25", close: "One-score watch", upset: "Upset watch" }[key])).join(" · ")}</p>}<p className="guide-estimates">Estimated window only. Actual end time and viewing access are not confirmed.</p>
      <a className="solid-button" href={`https://tv.youtube.com/search/${encodeURIComponent(game.teams.map(t => t.name).join(" "))}`} target="_blank" rel="noopener noreferrer">Find on YouTube TV ↗</a>
      <p className="guide-estimates">Search results may include replays. Availability depends on your plan and location.</p>
      <a className="solid-button" href={game.url} target="_blank" rel="noopener noreferrer">Open Gamecast ↗</a>
    </div>}</SheetContent></Sheet>
  </>;
}
