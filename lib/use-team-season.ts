"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { seasonTtl, TEAM_SEASON_BACKOFF_MS, type TeamSeason } from "./team-season";
import { loadTeamSeason, type TeamSeasonOutcome } from "./team-season-client";
import { useOnline } from "./browser-state";

type Failure = Extract<TeamSeasonOutcome, { kind: "failed" }>["reason"];
type Load = (teamId: string, signal: AbortSignal) => Promise<TeamSeasonOutcome>;
export type TeamSeasonState = { teamId: string | null; season: TeamSeason | null; pending: boolean; failure: Failure | null };

// Memory-only: the last validated season per team, so Back and Forward show it at once.
// Nothing reaches localStorage, the scoreboard, or the Duke observation writer.
const memory = new Map<string, { season: TeamSeason; receivedAt: number }>();
const MEMORY_LIMIT = 8;
function remember(season: TeamSeason) {
  memory.delete(season.team.id); memory.set(season.team.id, { season, receivedAt: Date.now() });
  while (memory.size > MEMORY_LIMIT) memory.delete(memory.keys().next().value!);
}
const seed = (teamId: string | null): TeamSeasonState => ({ teamId, season: teamId ? memory.get(teamId)?.season ?? null : null, pending: false, failure: null });

const subscribeVisibility = (update: () => void) => { document.addEventListener("visibilitychange", update); return () => document.removeEventListener("visibilitychange", update); };
const browserVisible = () => document.visibilityState !== "hidden";
const serverVisible = () => true;

/**
 * One team's season while its page, or a game opened from its schedule, is on screen. Refreshes at
 * the season cadence (faster while one of its games is live), backs off after failures, pauses
 * while offline or hidden, and cancels on team change, so a late answer never reaches another team.
 */
export function useTeamSeason(teamId: string | null, load: Load = loadTeamSeason) {
  const online = useOnline();
  const visible = useSyncExternalStore(subscribeVisibility, browserVisible, serverVisible) ?? true;
  const [state, setState] = useState<TeamSeasonState>(() => seed(teamId));
  const [attempt, setAttempt] = useState(0);
  // A clock for schedule games past their kickoff: read at once, then every 15 seconds while in use.
  const [now, setNow] = useState(0);
  const forced = useRef(false);
  useEffect(() => {
    if (!teamId) return;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0), timer = setInterval(tick, 15_000);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, [teamId]);
  if (state.teamId !== teamId) setState(seed(teamId));
  useEffect(() => {
    if (!teamId || !online || !visible) return;
    let disposed = false, failures = 0, timer: ReturnType<typeof setTimeout> | undefined, controller: AbortController | null = null;
    const run = async () => {
      timer = undefined;
      controller = new AbortController();
      setState(current => current.teamId === teamId ? { ...current, pending: true } : current);
      let outcome: TeamSeasonOutcome;
      try { outcome = await load(teamId, controller.signal); } catch { return; }
      if (disposed) return;
      if (outcome.kind === "ok") {
        failures = 0; remember(outcome.season);
        setState({ teamId, season: outcome.season, pending: false, failure: null });
        timer = setTimeout(run, seasonTtl(outcome.season));
      } else {
        failures++;
        const wait = Math.max(TEAM_SEASON_BACKOFF_MS[Math.min(failures, TEAM_SEASON_BACKOFF_MS.length) - 1], (outcome.retryAfter ?? 0) * 1000);
        const reason = outcome.reason;
        setState(current => current.teamId === teamId ? { ...current, pending: false, failure: reason } : current);
        timer = setTimeout(run, wait);
      }
    };
    const known = memory.get(teamId);
    const due = forced.current || !known ? 0 : known.receivedAt + seasonTtl(known.season) - Date.now();
    forced.current = false;
    timer = setTimeout(run, Math.max(0, due));
    return () => {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
      controller?.abort();
      setState(current => current.pending ? { ...current, pending: false } : current);
    };
  }, [teamId, online, visible, attempt, load]);
  const current = state.teamId === teamId ? state : seed(teamId);
  return {
    season: current.season, pending: current.pending, failure: current.failure, online, now,
    // A manual retry runs one attempt now; scheduled retries keep their backoff.
    retry: () => { if (!current.pending) { forced.current = true; setAttempt(n => n + 1); } },
  };
}
export type TeamSeasonView = ReturnType<typeof useTeamSeason>;
