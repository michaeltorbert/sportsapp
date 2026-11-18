import { createTrace, recordDiagnosticCancellation, diagnosticJson, sanitizeDiagnostic, saveDiagnostic, validationCode, type Diagnostic, type Scope, type Trace } from "./schedule-diagnostics";
import { stripHalftimeTiming, nextHalftimeGeneration, halftimeEpoch } from "./halftime";
import { enrichPregameLines } from "./pregame-lines";
import { normalizeScoreboard, scoreboardCdnUrl, scoreboardUrl } from "./espn-data";
import { completeCdnRange } from "./espn-cdn";
import { cdnConsumer, type CdnDocuments } from "./cdn-documents";
import type { Scoreboard } from "./football";

type Fetcher = typeof fetch;
async function readDirectScores(date: string, endDate: string, accOnly: boolean, parent: AbortSignal, fetcher: Fetcher, documents?: CdnDocuments, trace?: Trace): Promise<Scoreboard> {
  const controller = new AbortController(), abort = () => controller.abort();
  if (parent.aborted) { trace?.add("request", "parent-cancel"); throw new DOMException("Request canceled", "AbortError"); }
  parent.addEventListener("abort", abort, { once: true });
  // Primary and every CDN week share the original eight-second direct budget.
  const timeout = setTimeout(() => { trace?.add("request", "deadline"); abort(); }, 8000);
  const upstream: Fetcher = (url, options) => {
    if (controller.signal.aborted) return Promise.reject(new DOMException("Direct score deadline expired", "AbortError"));
    return fetcher(url, { ...options, signal: controller.signal, cache: "no-store", mode: "cors", credentials: "omit" });
  };
  const read = async (url: string, via: Fetcher = upstream, stage: "primary" | "cdn" = "primary", shared = false) => {
    let response: Response;
    try { response = await via(url, { headers: { Accept: "application/json" } }); }
    catch (error) { trace?.add(stage, "fetch-unclassified"); throw error; }
    const raw = await diagnosticJson(response, trace, stage, !shared);
    if (controller.signal.aborted) throw new DOMException("Direct score deadline expired", "AbortError");
    return raw;
  };
  try {
    try {
      const raw = await read(scoreboardUrl(date, endDate, accOnly));
      try { const board = normalizeScoreboard(raw, date, undefined, endDate); if (trace) trace.data.source = "primary"; return board; }
      catch (error) { trace?.add("primary", "validation"); throw error; }
    }
    catch (error) {
      trace?.add("primary", "failed");
      if (controller.signal.aborted) throw error;
      // Refresh-local reuse covers completed CDN documents only, under this caller's own controller.
      const consumer = documents && cdnConsumer(documents, parent, fetcher);
      const cdn = consumer ? consumer.fetch(upstream, controller.signal) : upstream;
      try {
        const raw = await read(scoreboardCdnUrl(), cdn, "cdn", !!consumer);
        const board = await completeCdnRange(raw, date, endDate, accOnly, controller.signal, cdn, trace, !!consumer);
        if (controller.signal.aborted) throw new DOMException("Direct score deadline expired", "AbortError");
        if (trace) trace.data.source = "cdn";
        // Shared documents keep their original acquisition rather than this normalization time.
        return consumer ? { ...board, fetchedAt: consumer.fetchedAt() ?? board.fetchedAt } : board;
      } catch (failure) {
        // Cancellation is not evidence about the data; any other CDN failure drops only records this caller used.
        trace?.add("cdn", validationCode(failure));
        if (!controller.signal.aborted) consumer?.invalidate();
        throw failure;
      }
    }
  } finally { clearTimeout(timeout); parent.removeEventListener("abort", abort); }
}
async function readJson(url: string, parent: AbortSignal, fetcher: Fetcher, trace: Trace): Promise<unknown> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (parent.aborted) { trace?.add("request", "parent-cancel"); throw new DOMException("Request canceled", "AbortError"); }
  parent.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => { trace.add("hosted", "deadline"); abort(); }, 10000);
  try {
    let response: Response;
    try { response = await fetcher(url, {
      signal: controller.signal,
      cache: "no-store",
      mode: "same-origin",
      credentials: "same-origin",
    }); } catch (error) { trace.add("hosted", "fetch-unclassified"); throw error; }
    trace.add("hosted", response.ok ? "ok" : "http", response.status);
    let body: unknown;
    try { body = await response.json(); } catch (error) {
      trace.add("hosted", "parse"); trace.add("hosted", "detail-unavailable");
      if (!response.ok) throw new Error(`Score request returned ${response.status}`);
      throw error;
    }
    const server = sanitizeDiagnostic((body as { scheduleDiagnostics?: unknown } | null)?.scheduleDiagnostics);
    if (server && server.side === "server" && server.date === trace.data.date && server.end === trace.data.end) {
      // Preserve the distinct server clock/identity; only allowlisted metadata enters the incident.
      serverDetails.set(trace, server);
    } else trace.add("hosted", "detail-unavailable");
    if (!response.ok) throw new Error(`Score request returned ${response.status}`);
    return body;
  } finally {
    clearTimeout(timeout);
    parent.removeEventListener("abort", abort);
  }
}

/** Scores plus the halftime generation and epoch captured before the score request. */
export type ScoreRequest = { board: Scoreboard; generation: number; epoch: number; diagnostic?: Diagnostic };
const serverDetails = new WeakMap<Trace, Diagnostic>();

/**
 * Scores only, with the unchanged direct/CDN/hosted fallback. Optional summaries wait for enrichScores.
 * Optional refresh-local documents let callers sharing one parent signal and fetcher reuse completed CDN downloads.
 */
export async function requestScores(date: string, signal: AbortSignal, fetcher: Fetcher = fetch, endDate = date, accOnly = false, documents?: CdnDocuments, scope: Scope = "standalone"): Promise<ScoreRequest> {
  const generation = nextHalftimeGeneration(), epoch = halftimeEpoch();
  const trace = createTrace(date, endDate, scope);
  let board: Scoreboard;
  try {
    try {
      board = await readDirectScores(date, endDate, accOnly, signal, fetcher, documents, trace);
    } catch (error) {
      if (signal.aborted) throw error;
      const raw = await readJson(`/api/scores?date=${encodeURIComponent(date)}&end=${endDate}&acc=${accOnly ? "1" : "0"}`, signal, fetcher, trace);
      const data = raw as Scoreboard;
      if (!data || data.date !== date || (data.endDate || data.date) !== endDate || !Array.isArray(data.games) || !Number.isFinite(Date.parse(data.fetchedAt))) {
        trace.add("hosted", "validation"); throw new Error("Invalid score response");
      }
      // Optional diagnostic metadata is removed before board history/enrichment.
      const { scheduleDiagnostics: _metadata, ...clean } = data as Scoreboard & { scheduleDiagnostics?: unknown };
      void _metadata;
      board = stripHalftimeTiming(clean); trace.data.source = "hosted";
    }
    trace.data.outcome = board.stale ? "stale" : trace.data.observations.some(x => ["failed", "http", "fetch-unclassified", "parse", "validation", "coverage", "continuity", "week-identity"].includes(x.code)) ? "degraded" : "success";
    trace.add("request", board.stale ? "stale" : "ok");
    saveClientTrace(trace);
    return { board, generation, epoch, diagnostic: trace.data };
  } catch (error) {
    trace.data.outcome = signal.aborted ? "canceled" : "failed";
    if (signal.aborted) recordDiagnosticCancellation(trace, signal); else trace.add("request", "failed");
    saveClientTrace(trace);
    throw error;
  }
}
function saveClientTrace(trace: Trace) {
  // Server evidence is stored as a separate linked-source incident to keep timing/build identity honest.
  const server = serverDetails.get(trace);
  if (server) { server.scope = trace.data.scope; server.relatedId = trace.data.id; trace.data.relatedId = server.id; saveDiagnostic(server); }
  saveDiagnostic(trace.data);
}

/** Deferred enrichment observes with the original request's generation and epoch, never fresh ones. */
export function enrichScores(request: ScoreRequest, signal: AbortSignal, fetcher: Fetcher = fetch): Promise<Scoreboard> {
  return enrichPregameLines(request.board, signal, fetcher, request.generation, request.epoch);
}

export async function loadScores(date: string, signal: AbortSignal, fetcher: Fetcher = fetch, endDate = date, accOnly = false): Promise<Scoreboard> {
  return enrichScores(await requestScores(date, signal, fetcher, endDate, accOnly), signal, fetcher);
}
