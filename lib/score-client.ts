import { enrichPregameLines } from "./pregame-lines";
import { normalizeScoreboard, scoreboardCdnUrl, scoreboardUrl } from "./espn-data";
import { completeCdnRange } from "./espn-cdn";
import type { Scoreboard } from "./football";

type Fetcher = typeof fetch;
async function readDirectScores(date: string, endDate: string, accOnly: boolean, parent: AbortSignal, fetcher: Fetcher): Promise<Scoreboard> {
  const controller = new AbortController(), abort = () => controller.abort();
  if (parent.aborted) throw new DOMException("Request canceled", "AbortError");
  parent.addEventListener("abort", abort, { once: true });
  // Primary and every CDN week share the original eight-second direct budget.
  const timeout = setTimeout(abort, 8000);
  const upstream: Fetcher = (url, options) => {
    if (controller.signal.aborted) return Promise.reject(new DOMException("Direct score deadline expired", "AbortError"));
    return fetcher(url, { ...options, signal: controller.signal, cache: "no-store", mode: "cors", credentials: "omit" });
  };
  const read = async (url: string) => {
    const response = await upstream(url, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Score request returned ${response.status}`);
    const raw = await response.json();
    if (controller.signal.aborted) throw new DOMException("Direct score deadline expired", "AbortError");
    return raw;
  };
  try {
    try { return normalizeScoreboard(await read(scoreboardUrl(date, endDate, accOnly)), date, undefined, endDate); }
    catch (error) {
      if (controller.signal.aborted) throw error;
      const raw = await read(scoreboardCdnUrl());
      const board = await completeCdnRange(raw, date, endDate, accOnly, controller.signal, upstream);
      if (controller.signal.aborted) throw new DOMException("Direct score deadline expired", "AbortError");
      return board;
    }
  } finally { clearTimeout(timeout); parent.removeEventListener("abort", abort); }
}
async function readJson(url: string, parent: AbortSignal, fetcher: Fetcher): Promise<unknown> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (parent.aborted) throw new DOMException("Request canceled", "AbortError");
  parent.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 10000);
  try {
    const response = await fetcher(url, {
      signal: controller.signal,
      cache: "no-store",
      mode: "same-origin",
      credentials: "same-origin",
    });
    if (!response.ok) throw new Error(`Score request returned ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
    parent.removeEventListener("abort", abort);
  }
}

export async function loadScores(date: string, signal: AbortSignal, fetcher: Fetcher = fetch, endDate = date, accOnly = false): Promise<Scoreboard> {
  let board: Scoreboard;
  try {
    // ESPN explicitly allows anonymous browser requests with Access-Control-Allow-Origin: *.
    // Direct access also keeps the live scoreboard independent of hosted egress failures.
    board = await readDirectScores(date, endDate, accOnly, signal, fetcher);
  } catch (error) {
    if (signal.aborted) throw error;
    const data = await readJson(`/api/scores?date=${encodeURIComponent(date)}&end=${endDate}&acc=${accOnly ? "1" : "0"}`, signal, fetcher) as Scoreboard;
    if (!data || data.date !== date || (data.endDate || data.date) !== endDate || !Array.isArray(data.games) || !Number.isFinite(Date.parse(data.fetchedAt)))
      throw new Error("Invalid score response");
    board = data;
  }
  return enrichPregameLines(board, signal, fetcher);
}
