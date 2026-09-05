import { normalizeScoreboard, scoreboardUrl } from "./espn-data";
import type { Scoreboard } from "./football";

type Fetcher = typeof fetch;
async function readJson(url: string, parent: AbortSignal, direct: boolean, fetcher: Fetcher): Promise<unknown> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (parent.aborted) throw new DOMException("Request canceled", "AbortError");
  parent.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, direct ? 8000 : 10000);
  try {
    const response = await fetcher(url, {
      signal: controller.signal,
      cache: "no-store",
      mode: direct ? "cors" : "same-origin",
      credentials: direct ? "omit" : "same-origin",
    });
    if (!response.ok) throw new Error(`Score request returned ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
    parent.removeEventListener("abort", abort);
  }
}

export async function loadScores(date: string, signal: AbortSignal, fetcher: Fetcher = fetch): Promise<Scoreboard> {
  try {
    // ESPN explicitly allows anonymous browser requests with Access-Control-Allow-Origin: *.
    // Direct access also keeps the live scoreboard independent of hosted egress failures.
    return normalizeScoreboard(await readJson(scoreboardUrl(date), signal, true, fetcher), date);
  } catch (error) {
    if (signal.aborted) throw error;
    const data = await readJson(`/api/scores?date=${encodeURIComponent(date)}`, signal, false, fetcher) as Scoreboard;
    if (!data || data.date !== date || !Array.isArray(data.games) || !Number.isFinite(Date.parse(data.fetchedAt)))
      throw new Error("Invalid score response");
    return data;
  }
}
