import { DIRECT_STATS_FALLBACK, normalizeGameStats, parseGameStats, STATS_MAX_RETRY_AFTER_S, STATS_WORKER_BUDGET_MS, type GameStats, type StatsPhase } from "./game-stats";
import { summaryUrl } from "./stats-server";

export type StatsRequest = { eventId: string; teamIds: [string, string]; phase: StatsPhase; refresh: boolean };
export type StatsOutcome =
  | { kind: "ok"; stats: GameStats }
  | { kind: "failed"; reason: "busy" | "upstream" | "invalid" | "identity" | "network" | "expired"; retryAfter?: number };

// Below this, an attempt cannot meaningfully complete; expire locally instead.
export const MIN_ATTEMPT_MS = 750;
type Fetcher = typeof fetch;
const abortError = () => new DOMException("Stats request canceled", "AbortError");

export function retryAfterSeconds(header: string | null) {
  const seconds = header !== null && /^\d{1,6}$/.test(header.trim()) ? Number(header) : NaN;
  return Number.isFinite(seconds) ? Math.min(STATS_MAX_RETRY_AFTER_S, Math.max(1, seconds)) : undefined;
}

async function bounded<T>(parent: AbortSignal, ms: number, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController(), abort = () => controller.abort();
  if (parent.aborted) throw abortError();
  parent.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, ms);
  try {
    const result = await work(controller.signal);
    if (controller.signal.aborted) throw abortError();
    return result;
  } finally { clearTimeout(timer); parent.removeEventListener("abort", abort); }
}

function identity(stats: GameStats, request: StatsRequest): StatsOutcome {
  // Identity is checked before any data is trusted; a date-only difference is not a mismatch.
  if (stats.eventId !== request.eventId || stats.teamIds[0] !== request.teamIds[0] || stats.teamIds[1] !== request.teamIds[1]) return { kind: "failed", reason: "identity" };
  return { kind: "ok", stats };
}

/**
 * Worker-first stats load bounded by an absolute deadline that already
 * includes any queue wait. Authoritative Worker answers (busy, 400, upstream
 * failure, identity mismatch) never fall back to direct ESPN.
 */
export async function loadGameStats(request: StatsRequest, deadline: number, signal: AbortSignal, fetcher: Fetcher = fetch, now = () => Date.now(), fallback = DIRECT_STATS_FALLBACK): Promise<StatsOutcome> {
  let remaining = deadline - now();
  if (remaining < MIN_ATTEMPT_MS) return { kind: "failed", reason: "expired" };
  // `scoring=1` asks for the additive scoring summary; a Worker from before it ignores the parameter.
  const query = new URLSearchParams({ event: request.eventId, phase: request.phase, refresh: request.refresh ? "1" : "0", scoring: "1" });
  let fallbackEligible: StatsOutcome;
  try {
    const result = await bounded(signal, Math.min(STATS_WORKER_BUDGET_MS, remaining), async inner => {
      const response = await fetcher(`/api/stats?${query}`, { signal: inner, cache: "no-store", mode: "same-origin", credentials: "same-origin" });
      if (response.status === 429 || response.status === 503) return { kind: "failed", reason: "busy", retryAfter: retryAfterSeconds(response.headers.get("Retry-After")) } as StatsOutcome;
      if (response.status === 400) return { kind: "failed", reason: "invalid" } as StatsOutcome;
      if (!response.ok) return { kind: "failed", reason: "upstream", retryAfter: retryAfterSeconds(response.headers.get("Retry-After")) } as StatsOutcome;
      let body: unknown;
      try { body = await response.json(); } catch { return null; }
      const stats = parseGameStats(body);
      return stats ? identity(stats, request) : null;
    });
    if (result) return result;
    fallbackEligible = { kind: "failed", reason: "invalid" };
  } catch (error) {
    if (signal.aborted) throw error;
    fallbackEligible = { kind: "failed", reason: "network" };
  }
  remaining = deadline - now();
  if (!fallback || remaining < MIN_ATTEMPT_MS) return fallbackEligible;
  // Optional direct path: same normalizer, only the remaining total budget.
  try {
    return await bounded(signal, remaining, async inner => {
      const response = await fetcher(summaryUrl(request.eventId), { signal: inner, cache: "no-store", mode: "cors", credentials: "omit" });
      if (!response.ok) return { kind: "failed", reason: "upstream" } as StatsOutcome;
      try { return identity(normalizeGameStats(await response.json(), request.eventId, new Date(now()).toISOString()), request); }
      catch { return { kind: "failed", reason: "invalid" } as StatsOutcome; }
    });
  } catch (error) {
    if (signal.aborted) throw error;
    return { kind: "failed", reason: "network" };
  }
}
