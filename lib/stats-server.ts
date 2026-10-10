import { normalizeGameStats, statsTtl, STATS_MAX_ACTIVE, STATS_SNAPSHOT_LIMIT, STATS_UPSTREAM_TIMEOUT_MS, type GameStats, type StatsPhase } from "./game-stats";

export function summaryUrl(eventId: string) {
  const url = new URL("https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary");
  url.searchParams.set("event", eventId);
  return url.toString();
}

export type StatsResult = { status: 200; stats: GameStats } | { status: 502 | 503; error: string; retryAfter: number };
type Entry = { stats: GameStats; expires: number };

/**
 * Per-isolate stats service. Only completed normalized snapshots are shared;
 * every miss runs its own bounded upstream fetch, so no cancellable in-flight
 * promise crosses requests. Admission denial never returns a mismatched entry.
 */
export function createStatsService(fetcher: typeof fetch = fetch, now = () => Date.now()) {
  const cache = new Map<string, Entry>();
  let active = 0;
  async function get(eventId: string, phase: StatsPhase, refresh: boolean): Promise<StatsResult> {
    const cached = cache.get(eventId);
    // A fresh hit keeps its original retrieval time. A phase hint that disagrees
    // with the cached source phase, or an explicit refresh, revalidates upstream.
    if (cached && !refresh && cached.expires > now() && cached.stats.sourcePhase === phase) {
      cache.delete(eventId); cache.set(eventId, cached);
      return { status: 200, stats: cached.stats };
    }
    if (active >= STATS_MAX_ACTIVE) return { status: 503, error: "Stats are busy. Please retry.", retryAfter: 5 };
    active++;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), STATS_UPSTREAM_TIMEOUT_MS);
    try {
      const response = await fetcher(summaryUrl(eventId), { headers: { Accept: "application/json" }, signal: controller.signal });
      if (!response.ok) throw new Error(`ESPN status ${response.status}`);
      // Reading and parsing share the upstream deadline.
      const raw = await response.json();
      if (controller.signal.aborted) throw new Error("ESPN summary deadline expired");
      const stats = normalizeGameStats(raw, eventId, new Date(now()).toISOString());
      cache.delete(eventId);
      cache.set(eventId, { stats, expires: now() + statsTtl(stats.sourcePhase) });
      while (cache.size > STATS_SNAPSHOT_LIMIT) cache.delete(cache.keys().next().value!);
      return { status: 200, stats };
    } catch (error) {
      console.error(JSON.stringify({ event: "stats_upstream_failed", eventId, error: error instanceof Error ? error.message : String(error) }));
      return { status: 502, error: "ESPN stats are temporarily unavailable. Please retry.", retryAfter: 30 };
    } finally {
      clearTimeout(timeout);
      active--;
    }
  }
  return { get, size: () => cache.size };
}
