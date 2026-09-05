import { normalizeScoreboard, scoreboardUrl } from "./espn-data";
import type { Scoreboard } from "./football";

// Only completed public data is shared across Worker requests. An in-flight
// promise belongs to its originating request and can be canceled with it.
const cache = new Map<string, { expires: number; data: Scoreboard }>();
export async function getScoreboard(date: string): Promise<Scoreboard> {
  const cached = cache.get(date);
  if (cached && cached.expires > Date.now()) return cached.data;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(scoreboardUrl(date), {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`ESPN status ${response.status}`);
    const data = normalizeScoreboard(await response.json(), date);
    cache.set(date, { expires: Date.now() + 15000, data });
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
