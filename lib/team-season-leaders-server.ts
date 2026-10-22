import { TEAM_LEADER_ROWS, type SeasonLeaders, type TeamLeaderKey, type SeasonLeader } from "./team-season";

const HOST = "sports.core.api.espn.com";
const BASE = "/v2/sports/football/leagues/college-football/seasons/";
const MAX_BYTES = 256_000;
const obj = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const list = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const numericId = (v: unknown): v is string => typeof v === "string" && /^\d{1,12}$/.test(v);
const path = (year: number, suffix: string) => `${BASE}${year}/${suffix}`;
function url(year: number, suffix: string) { return `https://${HOST}${path(year, suffix)}?lang=en&region=us`; }
export const teamLeadersUrl = (team: string, year: number) => url(year, `types/2/teams/${team}/leaders`);
export const seasonAthleteUrl = (athlete: string, year: number) => url(year, `athletes/${athlete}`);

/** Returned references prove identity only; none is used as a request destination. */
function ref(value: unknown, expectedPath: string) {
  const raw = obj(value).$ref;
  if (typeof raw !== "string" || raw.length > 500) return false;
  try {
    const u = new URL(raw);
    return (u.protocol === "http:" || u.protocol === "https:") && u.hostname === HOST && !u.username && !u.password && !u.port && !u.hash && u.pathname === expectedPath &&
      [...u.searchParams].every(([k, v]) => (k === "lang" && v === "en" || k === "region" && v === "us") && u.searchParams.getAll(k).length === 1);
  } catch { return false; }
}
function athleteId(value: unknown, year: number) {
  const raw = obj(value).$ref;
  if (typeof raw !== "string") return null;
  try { const id = new URL(raw).pathname.split("/").at(-1); return numericId(id) && ref(value, path(year, `athletes/${id}`)) ? id : null; } catch { return null; }
}
type Selected = { athleteId: string; yards: number };
export function selectSeasonLeaders(raw: unknown, team: string, year: number): Record<TeamLeaderKey, Selected | null> {
  const body = obj(raw);
  const valid = body.type === "season" && ref(body, path(year, `types/2/teams/${team}/leaders`));
  return Object.fromEntries(TEAM_LEADER_ROWS.map(([key, , category]) => {
    const matches = list(body.categories).map(obj).filter(c => c.name === category);
    const row = obj(list(matches[0]?.leaders)[0]), id = athleteId(row.athlete, year);
    const value = row.value;
    return [key, valid && matches.length === 1 && id && list(row.rel).includes("athlete") && typeof value === "number" && Number.isInteger(value) && Math.abs(value) <= 999_999 &&
      ref(row.team, path(year, `teams/${team}`)) && ref(row.statistics, path(year, `types/2/teams/${team}/athletes/${id}/statistics/0`)) ? { athleteId: id, yards: value } : null];
  })) as Record<TeamLeaderKey, Selected | null>;
}
export function seasonLeaderAthlete(raw: unknown, selected: Selected, team: string, year: number): SeasonLeader | null {
  const a = obj(raw), name = typeof a.fullName === "string" ? a.fullName.trim() : "";
  return a.id === selected.athleteId && name.length > 0 && name.length <= 100 && !/[\u0000-\u001f\u007f]/.test(name) &&
    ref(a, path(year, `athletes/${selected.athleteId}`)) && ref(a.team, path(year, `teams/${team}`)) && ref(a.statistics, path(year, `types/2/athletes/${selected.athleteId}/statistics`))
    ? { ...selected, name } : null;
}

/** Optional pipeline has its own settle deadline, even when a transport ignores abort. */
export async function loadSeasonLeaders(fetcher: typeof fetch, team: string, year: number, rootSignal: AbortSignal, budgetMs: number): Promise<SeasonLeaders | null> {
  type Stage = "guard" | "leaders_fetch" | "leaders_http" | "leaders_body" | "leaders_json" | "selection" | "athlete_fetch" | "athlete_http" | "athlete_body" | "athlete_json" | "athlete_validation" | "deadline" | "pipeline" | "complete";
  type Reason = "ok" | "skipped" | "fetch_rejected" | "http_status" | "redirected" | "too_large" | "missing_body" | "body_read" | "invalid_json" | "validation" | "deadline" | "root_abort" | "unexpected";
  const startedAt = performance.now();
  const bounded = (value: number, max: number) => Number.isFinite(value) ? Math.max(0, Math.min(max, Math.round(value))) : 0;
  let failure: { stage: Stage; reason: Reason; status: number | null; errorClass: string | null } | null = null;
  let stopCause: "complete" | "deadline" | "root_abort" = "complete", requests = 0, bytesRead = 0, selectedCount = 0;
  let leaderStatus: number | null = null, contentType: "json" | "html" | "other" | null = null;
  const note = (stage: Stage, reason: Reason, status: number | null = null, error?: unknown) => {
    if (failure) return;
    let errorClass: string | null = null;
    try { const name = error instanceof Error ? error.name : null; errorClass = name === null ? null : ["Error", "TypeError", "SyntaxError", "RangeError", "AbortError"].includes(name) ? name : "unknown"; } catch { errorClass = "unknown"; }
    failure = { stage, reason, status, errorClass };
  };
  const summary = (validatedCount: number) => {
    // Fixed schema only: never raw errors, URLs, headers, bodies, athlete identity or statistics.
    try { console.info(JSON.stringify({ event: "team_season_leaders", stage: failure?.stage ?? "complete", reason: failure?.reason ?? "ok", status: failure?.status ?? null, errorClass: failure?.errorClass ?? null, stopCause, leaderStatus, contentType, requests: bounded(requests, 4), bytesRead: bounded(bytesRead, MAX_BYTES * 4), selected: bounded(selectedCount, 3), validated: bounded(validatedCount, 3), elapsedMs: bounded(performance.now() - startedAt, 60_000), budgetMs: bounded(Math.min(3000, budgetMs), 3000) })); } catch { /* Logging cannot change a season result. */ }
  };
  if (!/^\d{1,6}$/.test(team) || !Number.isInteger(year) || year < 2000 || year > 2100 || budgetMs <= 0 || rootSignal.aborted) { note("guard", "skipped"); summary(0); return null; }
  const controller = new AbortController(), readers = new Set<ReadableStreamDefaultReader<Uint8Array>>();
  let partial: SeasonLeaders | null = null;
  // Return detached validated rows: a late noncooperative response cannot alter cached data.
  const snapshot = (): SeasonLeaders | null => partial ? { year, seasonType: 2, ...Object.fromEntries(TEAM_LEADER_ROWS.map(([key]) => [key, partial?.[key] ? { ...partial[key] } : null])) } as SeasonLeaders : null;
  let settle: (value: SeasonLeaders | null) => void = () => {};
  const stopped = new Promise<SeasonLeaders | null>(resolve => { settle = resolve; });
  const stop = (cause?: "deadline" | "root_abort") => { if (cause) { stopCause = cause; note("deadline", cause); } controller.abort(); for (const reader of readers) void reader.cancel().catch(() => {}); settle(snapshot()); };
  const rootAbort = () => stop("root_abort");
  rootSignal.addEventListener("abort", rootAbort, { once: true });
  const timer = setTimeout(() => stop("deadline"), Math.min(3000, budgetMs));
  async function json(destination: string, role: "leaders" | "athlete"): Promise<unknown> {
    if (controller.signal.aborted) throw new Error("leader deadline");
    // workerd supports manual, not error. Reject non-OK (including 3xx) below without following.
    let response: Response;
    try { requests++; response = await fetcher(destination, { headers: { Accept: "application/json" }, redirect: "manual", signal: controller.signal }); }
    catch (error) { note(`${role}_fetch`, "fetch_rejected", null, error); throw error; }
    if (role === "leaders") {
      leaderStatus = response.status;
      const type = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
      contentType = type === "application/json" || type?.endsWith("+json") ? "json" : type === "text/html" ? "html" : "other";
    }
    if (controller.signal.aborted) { void response.body?.cancel().catch(() => {}); throw new Error("leader deadline"); }
    if (!response.ok || response.redirected || Number(response.headers.get("content-length")) > MAX_BYTES || !response.body) {
      if (!response.ok) note(`${role}_http`, "http_status", response.status);
      else if (response.redirected) note(`${role}_http`, "redirected", response.status);
      else note(`${role}_body`, !response.body ? "missing_body" : "too_large", response.status);
      void response.body?.cancel().catch(() => {}); throw new Error("leader response unavailable");
    }
    let reader: ReadableStreamDefaultReader<Uint8Array>;
    try { reader = response.body.getReader(); readers.add(reader); }
    catch (error) { note(`${role}_body`, "body_read", response.status, error); throw error; }
    const decoder = new TextDecoder(); let bytes = 0, text = "";
    try {
      while (true) {
        const chunk = await reader.read();
        if (controller.signal.aborted) throw new Error("leader deadline");
        if (chunk.done) break;
        bytes += chunk.value.byteLength; bytesRead += chunk.value.byteLength;
        if (bytes > MAX_BYTES) { note(`${role}_body`, "too_large", response.status); throw new Error("leader response too large"); }
        text += decoder.decode(chunk.value, { stream: true });
      }
      try { return JSON.parse(text + decoder.decode()) as unknown; }
      catch (error) { note(`${role}_json`, "invalid_json", response.status, error); throw error; }
    } catch (error) { if (!controller.signal.aborted) note(`${role}_body`, "body_read", response.status, error); throw error; }
    finally { readers.delete(reader); void reader.cancel().catch(() => {}); }
  }
  const work = async (): Promise<SeasonLeaders | null> => {
    const selected = selectSeasonLeaders(await json(teamLeadersUrl(team, year), "leaders"), team, year);
    selectedCount = Object.values(selected).filter(Boolean).length;
    if (selectedCount < 3) note("selection", "validation");
    partial = { year, seasonType: 2, passingYards: null, rushingYards: null, receivingYards: null };
    const athletes = new Map<string, Promise<unknown>>();
    for (const row of Object.values(selected)) if (row && !athletes.has(row.athleteId) && !controller.signal.aborted) athletes.set(row.athleteId, json(seasonAthleteUrl(row.athleteId, year), "athlete").catch(() => null));
    await Promise.all(TEAM_LEADER_ROWS.map(async ([key]) => {
      const row = selected[key];
      const validated = row ? seasonLeaderAthlete(await athletes.get(row.athleteId), row, team, year) : null;
      if (!controller.signal.aborted && partial) { partial[key] = validated; if (row && !validated) note("athlete_validation", "validation"); }
    }));
    return snapshot();
  };
  try { return await Promise.race([work().catch(error => { note("pipeline", "unexpected", null, error); return null; }), stopped]); }
  finally { clearTimeout(timer); rootSignal.removeEventListener("abort", rootAbort); stop(); summary(partial ? TEAM_LEADER_ROWS.filter(([key]) => partial?.[key]).length : 0); }
}
