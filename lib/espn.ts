import { completeCdnRange } from "./espn-cdn";
import { normalizeScoreboard, scoreboardCdnUrl, scoreboardUrl } from "./espn-data";
import type { Scoreboard } from "./football";

// Only completed public data is shared across Worker requests. An in-flight
// promise belongs to its originating request and can be canceled with it.
const cache = new Map<string, { expires: number; data: Scoreboard }>();
export async function getScoreboard(date: string, endDate = date, accOnly = false): Promise<Scoreboard> {
  const key = `${date}:${endDate}:${accOnly}`;
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.data;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    let data: Scoreboard;
    try {
      const response = await fetch(scoreboardUrl(date, endDate, accOnly), {
        headers: { Accept: "application/json" }, signal: controller.signal,
      });
      if (!response.ok) throw new Error(`ESPN status ${response.status}`);
      data = normalizeScoreboard(await response.json(), date, undefined, endDate);
    } catch (error) {
      console.error(JSON.stringify({ event: "score_primary_failed", date, endDate, error: error instanceof Error ? error.message : String(error) }));
      if (controller.signal.aborted) throw error;
      const response = await fetch(scoreboardCdnUrl(), { headers: { Accept: "application/json" }, signal: controller.signal });
      if (!response.ok) throw new Error(`ESPN CDN status ${response.status}`);
      data = await completeCdnRange(await response.json(), date, endDate, accOnly, controller.signal);
    }
    cache.set(key, { expires: Date.now() + 15000, data });
    if (cache.size > 8) cache.delete(cache.keys().next().value!);
    return data;
  } catch (error) {
    console.error(JSON.stringify({ event: "score_feed_failed", date,
      error: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : "UnknownError" }));
    if (cached && Date.now() - Date.parse(cached.data.fetchedAt) < 600000)
      return { ...cached.data, stale: true };
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
