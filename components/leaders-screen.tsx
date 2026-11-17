"use client";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Signal } from "lucide-react";
import { AppNavigation } from "./app-navigation";
import { LEADER_CATEGORIES, LEADER_LABELS, LEADER_YEARS, leadersHref, leadersRefreshAge, parseLeadersQuery, parseLeadersSnapshot, selectLeaders, type LeadersSnapshot } from "@/lib/leaders-browser";
import { loadLeaders } from "@/lib/leaders-browser-client";
import { leadersPrivacy } from "@/lib/leaders-browser-privacy";
import { useDukeVisibility } from "@/lib/use-duke-visibility";
import { playerHref, teamHref } from "@/lib/game-route";
import { easternDate, type Game } from "@/lib/football";
import { VERSION } from "@/lib/releases";
const NO_GAMES: Game[] = [];
const LOCATION_EVENT = "leaders-location-change";
const locationSearch = () => window.location.search;
const serverSearch = () => null;
function subscribeLocation(notify: () => void) {
  window.addEventListener("popstate",notify); window.addEventListener(LOCATION_EVENT,notify);
  return () => { window.removeEventListener("popstate",notify); window.removeEventListener(LOCATION_EVENT,notify); };
}
const checked = (stamp: string) => `${new Intl.DateTimeFormat("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit",timeZone:"America/New_York"}).format(new Date(stamp))} ET`;
export function LeadersScreen() {
  const search = useSyncExternalStore<string | null>(subscribeLocation,locationSearch,serverSearch);
  const [snapshot,setSnapshot] = useState<LeadersSnapshot | null>(null), [retry,setRetry] = useState(0), [clock,setClock] = useState<number | null>(null);
  const [outcome,setOutcome] = useState<{ year: number; attempt: number; failed: boolean } | null>(null);
  const duke = useDukeVisibility(NO_GAMES);
  const params = useMemo(() => new URLSearchParams(search ?? ""),[search]);
  const query = useMemo(() => search === null ? null : parseLeadersQuery(new URLSearchParams(search)),[search]);
  const supported = query && LEADER_YEARS.includes(query.year as 2025 | 2026);
  const year = supported ? query.year : null;
  const pending = year !== null && (outcome === null || outcome.year !== year || outcome.attempt !== retry);
  const failed = outcome !== null && outcome.year === year && outcome.attempt === retry && outcome.failed;
  useEffect(() => { if (year === null) return; const timer = setInterval(() => { setClock(Date.now()); setRetry(r => r + 1); },300000); return () => clearInterval(timer); },[year]);
  useEffect(() => {
    if (year === null || !query) return;
    const controller = new AbortController();
    loadLeaders(query,controller.signal).then(value => { if (!controller.signal.aborted) { setSnapshot(value); setClock(Date.now()); setOutcome({year,attempt:retry,failed:false}); } }).catch(() => { if (!controller.signal.aborted) { setClock(Date.now()); setOutcome({year,attempt:retry,failed:true}); } });
    return () => controller.abort();
    // All filters operate on the complete selected-year snapshot; changing a filter never calls the provider.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[year,retry]);
  useEffect(() => { if (search === "" && query) { const href = leadersHref(query); window.history.replaceState(window.history.state,"",href); window.dispatchEvent(new Event(LOCATION_EVENT)); } },[search,query]);
  const change = (key: string, value: string) => {
    const next = new URLSearchParams(search ?? ""); next.set(key,value); if (key !== "page") next.set("page","1");
    window.history.pushState(null,"",`/leaders?${next}`); window.dispatchEvent(new Event(LOCATION_EVENT));
  };
  const current = clock !== null && year !== null && snapshot?.year === year ? parseLeadersSnapshot(snapshot,year,clock) : null;
  const unavailable = failed || (!pending && snapshot !== null && snapshot.year === year && !current);
  const protection = current ? leadersPrivacy(current,duke.prefs) : null;
  const result = current && query && protection?.ready ? selectLeaders(current,query,protection.excluded) : null;
  const selectedTeam = current?.members.find(t => t.id === query?.team);
  const teams = current?.members.slice().sort((a,b) => a.school.localeCompare(b.school)) ?? [];
  const conferences = [...new Set(teams.map(t => t.conference).filter((c): c is string => c !== null))].sort();
  const selectedYear = params.get("season") ?? "2026", selectedConference = params.get("conference") ?? "all", selectedTeamValue = params.get("team") ?? "all";
  const category = query?.category;
  const today = easternDate(new Date(clock ?? 0));
  const view = { date: today, followToday: true, selection: [], period: "day" as const, leadersReturn: query ? leadersHref(query) : undefined };
  const scope = selectedTeam ? selectedTeam.school : selectedConference === "all" ? "All FBS teams" : selectedConference;
  const invalidDescription = [...params].map(([k,v]) => `${k}: ${v}`).join(" · ");
  return <main className="app-shell leaders-shell">
    <header className="app-header"><div className="wordmark"><span className="brand-icon" aria-hidden="true"><Signal size={20} strokeWidth={3}/></span><span>Saturday<span className="brand-light">Signal</span></span></div><span className="sport-label">COLLEGE FOOTBALL</span></header>
    <AppNavigation active="leaders" date={today} followToday />
    <div className="leaders-heading"><h1>Player leaders</h1><p>Regular-season total yards</p></div>
    <div className="leaders-categories" aria-label="Statistic">{LEADER_CATEGORIES.map(c => <button type="button" key={c} aria-pressed={category === c} onClick={() => change("category",c)}>{LEADER_LABELS[c]}</button>)}</div>
    <div className="leaders-filters"><label htmlFor="leaders-season"><span>Season</span><select id="leaders-season" aria-label="Season" value={selectedYear} onChange={e => change("season",e.target.value)}>{!LEADER_YEARS.some(y => String(y) === selectedYear) && <option value={selectedYear}>{selectedYear} · unsupported</option>}{LEADER_YEARS.map(y => <option key={y} value={y}>{y}</option>)}</select></label>
      <label htmlFor="leaders-conference"><span>Conference</span><select id="leaders-conference" aria-label="Conference" value={selectedConference} onChange={e => change("conference",e.target.value)}><option value="all">All conferences</option>{selectedConference !== "all" && !conferences.includes(selectedConference) && <option value={selectedConference}>{selectedConference} · unavailable</option>}{conferences.map(c => <option key={c}>{c}</option>)}</select></label>
      <label htmlFor="leaders-team" className="leaders-team-filter"><span>Team</span><select id="leaders-team" aria-label="Team" value={selectedTeamValue} onChange={e => change("team",e.target.value)}><option value="all">All FBS teams</option>{selectedTeamValue !== "all" && !teams.some(t => t.id === selectedTeamValue) && <option value={selectedTeamValue}>Team {selectedTeamValue} · unavailable</option>}{teams.map(t => <option key={t.id} value={t.id}>{t.school}</option>)}</select></label></div>
    {duke.storageWarning && <p className="duke-storage-warning" role="alert">{duke.storageWarning}</p>}
    {search === null ? <p role="status" className="leaders-state">Loading leaders…</p> : !query || !supported ? <div className="leaders-state"><h2>This selection isn’t supported</h2><p>{invalidDescription || "Choose a supported season and statistic."}</p><p>Choose 2025 or 2026. The requested filters have not been replaced.</p></div> : <>
      <section aria-labelledby="leaders-title"><div className="leaders-list-heading"><h2 id="leaders-title">{LEADER_LABELS[query.category]} yards</h2><p>{query.year} regular season · {scope}</p>{result && <p className="leaders-basis">{result.protectedScope ? `Rank among shown ${selectedTeam ? selectedTeam.school : selectedConference === "all" ? "FBS" : selectedConference} players` : `Rank among ${selectedTeam ? selectedTeam.school : selectedConference === "all" ? "supplied FBS" : selectedConference} players`} · highest total first</p>}</div>
      {current && clock !== null && clock - Date.parse(current.checkedAt) > leadersRefreshAge(query.year) && <p className="leaders-notice">Refresh delayed — showing the last checked totals.</p>}
      {pending && <p className="leaders-notice" role="status">{current ? "Checking for updated leaders…" : "Loading leaders…"}</p>}
      {unavailable && <div className="leaders-state" role="status"><h3>{current ? "Couldn’t refresh leaders" : "Leaders are temporarily unavailable"}</h3><p>{current ? "Showing the last checked data for this season." : "Your selected season and filters are kept. Try again in a few minutes."}</p><button className="notice-button" onClick={() => setRetry(r => r + 1)}>Try again</button></div>}
      {current && !protection?.ready && <p className="leaders-state" role="status">{protection?.reason}</p>}
      {result && <>
        {result.protectedScope && <p className="leaders-notice">Teams affected by hidden Duke games are excluded. Ranks and counts cover only the players shown.</p>}
        {result.unavailable ? <div className="leaders-state"><h3>A selected filter isn’t available in {query.year}</h3><p>The selection is kept. Choose another team or conference.</p></div> : result.count === 0 ? <div className="leaders-state"><h3>No matching player totals</h3><p>{result.protectedScope ? "The selected teams’ season statistics are protected by your Duke settings." : "No supplied player totals match both the selected team and conference."}</p><button className="notice-button" onClick={() => change("team","all")}>Clear team filter</button></div> : query.page > result.pages ? <div className="leaders-state"><h3>This page has no results</h3><button className="notice-button" onClick={() => change("page","1")}>Go to first page</button></div> : <>
          <div className="leaders-columns" aria-hidden="true"><span>Rank</span><span>Player / team</span><span>Yards</span></div><ol className="leaders-list">{result.rows.map(r => { const school = current!.members.find(t => t.id === r.team)!; const request = {id:r.id,year:query.year,anchorYear:query.year,team:r.team}; return <li className="leaders-row" key={`${r.team}:${r.id}`}><span className="leaders-rank">{r.rank}</span><div className="leaders-identity"><a className="leaders-player" href={playerHref(request,view)}>{r.name}</a><a className="leaders-team" href={teamHref(r.team,view)}>{school.school}<span aria-hidden="true"> ›</span>{query.year !== 2026 && <small>Current team page</small>}</a></div><div className="leaders-value">{r.yards.toLocaleString("en-US")}<small>yds</small></div></li>; })}</ol>
          <nav className="leaders-pages" aria-label="Results pages"><button disabled={query.page === 1} onClick={() => change("page",String(query.page - 1))}>Previous</button><span>Page {query.page} of {result.pages}<small>{result.count.toLocaleString()} players</small></span><button disabled={query.page === result.pages} onClick={() => change("page",String(query.page + 1))}>Next</button></nav>
        </>}
      </>}
      </section>
      {current && <footer className="leaders-footer"><p>CFBD totals checked {checked(current.checkedAt)}.<br/>Source update time unknown.</p><details><summary>What these rankings cover</summary><p>Players supplied for teams listed as FBS members in {query.year}. Totals cover regular-season games, including games against non-FBS opponents. Conference filters use team membership in the selected season, not conference-only games. Team and conference filters combine.</p><p>Equal yard totals share a rank; the next place skips ties. A player’s separate team totals stay separate. These are statistical ranks, not poll ranks or NCAA qualification rankings.</p></details></footer>}
    </>}
    <p className="leaders-version">v{VERSION}</p>
  </main>;
}
