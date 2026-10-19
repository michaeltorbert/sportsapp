import { parseTeamSeason, TEAM_SEASON_MAX_RETRY_AFTER_S, TEAM_SEASON_TOTAL_DEADLINE_MS, type TeamSeason } from "./team-season";

export type TeamSeasonOutcome =
  | { kind: "ok"; season: TeamSeason }
  | { kind: "failed"; reason: "busy" | "upstream" | "invalid" | "network"; retryAfter?: number };

export function retryAfterSeconds(header: string | null) {
  const seconds = header !== null && /^\d{1,6}$/.test(header.trim()) ? Number(header) : NaN;
  return Number.isFinite(seconds) ? Math.min(TEAM_SEASON_MAX_RETRY_AFTER_S, Math.max(1, seconds)) : undefined;
}

/**
 * Same-origin only: the app's own Worker is the one source. There is no direct-provider fallback.
 * The caller's signal cancels the request; a response for another team is never accepted.
 */
export async function loadTeamSeason(teamId: string, signal: AbortSignal, fetcher: typeof fetch = fetch, deadline = TEAM_SEASON_TOTAL_DEADLINE_MS): Promise<TeamSeasonOutcome> {
  const controller = new AbortController(), abort = () => controller.abort();
  if (signal.aborted) throw new DOMException("Team season request canceled", "AbortError");
  signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, deadline);
  try {
    const response = await fetcher(`/api/team?${new URLSearchParams({ team: teamId })}`, { signal: controller.signal, cache: "no-store", mode: "same-origin", credentials: "same-origin" });
    if (response.status === 429 || response.status === 503) return { kind: "failed", reason: "busy", retryAfter: retryAfterSeconds(response.headers.get("Retry-After")) };
    if (response.status === 400) return { kind: "failed", reason: "invalid" };
    if (!response.ok) return { kind: "failed", reason: "upstream", retryAfter: retryAfterSeconds(response.headers.get("Retry-After")) };
    let body: unknown;
    try { body = await response.json(); } catch { return { kind: "failed", reason: "invalid" }; }
    const season = parseTeamSeason(body, teamId);
    return season ? { kind: "ok", season } : { kind: "failed", reason: "invalid" };
  } catch (error) {
    if (signal.aborted) throw error;
    return { kind: "failed", reason: "network" };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}
