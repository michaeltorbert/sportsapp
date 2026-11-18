import { diagnosticJson, validationCode, type Trace } from "./schedule-diagnostics";
import { completeCdnRange } from "./espn-cdn";
import { normalizeScoreboard, scoreboardCdnUrl, scoreboardUrl } from "./espn-data";
import type { Scoreboard } from "./football";

// Only completed public data is shared across Worker requests. An in-flight
// promise belongs to its originating request and can be canceled with it.
const cache = new Map<string, { expires: number; data: Scoreboard }>();
export async function getScoreboard(date: string, endDate = date, accOnly = false, trace?: Trace): Promise<Scoreboard> {
  const key = `${date}:${endDate}:${accOnly}`;
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) { trace?.add("cache", "fresh-cache"); if (trace) trace.data.source = "cache"; return cached.data; }
  const controller = new AbortController();
  const timeout = setTimeout(() => { trace?.add("request", "deadline"); controller.abort(); }, 8000);
  try {
    let data: Scoreboard;
    try {
      const response = await fetch(scoreboardUrl(date, endDate, accOnly), {
        headers: { Accept: "application/json" }, signal: controller.signal,
      });
      const raw = await diagnosticJson(response, trace, "primary");
      try { data = normalizeScoreboard(raw, date, undefined, endDate); if (trace) trace.data.source = "primary"; } catch (error) { trace?.add("primary", validationCode(error)); throw error; }
    } catch (error) {
      if (!trace?.data.observations.some(o => o.stage === "primary")) trace?.add("primary", "fetch-unclassified");
      trace?.add("primary", "failed");
      if (trace) trace.data.outcome = "degraded";
      if (controller.signal.aborted) throw error;
      let response: Response;
      try { response = await fetch(scoreboardCdnUrl(), { headers: { Accept: "application/json" }, signal: controller.signal }); }
      catch (failure) { trace?.add("cdn", "fetch-unclassified"); throw failure; }
      const raw = await diagnosticJson(response, trace, "cdn");
      try { data = await completeCdnRange(raw, date, endDate, accOnly, controller.signal, fetch, trace); if (trace) trace.data.source = "cdn"; } catch (failure) { trace?.add("cdn", validationCode(failure)); throw failure; }
    }
    trace?.add("request", "ok");
    cache.set(key, { expires: Date.now() + 15000, data });
    if (cache.size > 8) cache.delete(cache.keys().next().value!);
    return data;
  } catch (error) {
    trace?.add("request", "failed");
    if (trace) trace.data.outcome = "failed";
    if (cached && Date.now() - Date.parse(cached.data.fetchedAt) < 600000) {
      trace?.add("cache", "stale"); if (trace) trace.data.outcome = "stale";
      if (trace) trace.data.source = "cache";
      return { ...cached.data, stale: true };
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
