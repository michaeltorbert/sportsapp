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
  if (!/^\d{1,6}$/.test(team) || !Number.isInteger(year) || year < 2000 || year > 2100 || budgetMs <= 0 || rootSignal.aborted) return null;
  const controller = new AbortController(), readers = new Set<ReadableStreamDefaultReader<Uint8Array>>();
  let partial: SeasonLeaders | null = null;
  // Return detached validated rows: a late noncooperative response cannot alter cached data.
  const snapshot = (): SeasonLeaders | null => partial ? { year, seasonType: 2, ...Object.fromEntries(TEAM_LEADER_ROWS.map(([key]) => [key, partial?.[key] ? { ...partial[key] } : null])) } as SeasonLeaders : null;
  let settle: (value: SeasonLeaders | null) => void = () => {};
  const stopped = new Promise<SeasonLeaders | null>(resolve => { settle = resolve; });
  const stop = () => { controller.abort(); for (const reader of readers) void reader.cancel().catch(() => {}); settle(snapshot()); };
  rootSignal.addEventListener("abort", stop, { once: true });
  const timer = setTimeout(stop, Math.min(3000, budgetMs));
  async function json(destination: string): Promise<unknown> {
    if (controller.signal.aborted) throw new Error("leader deadline");
    const response = await fetcher(destination, { headers: { Accept: "application/json" }, redirect: "error", signal: controller.signal });
    if (controller.signal.aborted) { void response.body?.cancel().catch(() => {}); throw new Error("leader deadline"); }
    if (!response.ok || response.redirected || Number(response.headers.get("content-length")) > MAX_BYTES || !response.body) {
      void response.body?.cancel().catch(() => {}); throw new Error("leader response unavailable");
    }
    const reader = response.body.getReader(); readers.add(reader);
    const decoder = new TextDecoder(); let bytes = 0, text = "";
    try {
      while (true) {
        const chunk = await reader.read();
        if (controller.signal.aborted) throw new Error("leader deadline");
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > MAX_BYTES) throw new Error("leader response too large");
        text += decoder.decode(chunk.value, { stream: true });
      }
      return JSON.parse(text + decoder.decode()) as unknown;
    } finally { readers.delete(reader); void reader.cancel().catch(() => {}); }
  }
  const work = async (): Promise<SeasonLeaders | null> => {
    const selected = selectSeasonLeaders(await json(teamLeadersUrl(team, year)), team, year);
    partial = { year, seasonType: 2, passingYards: null, rushingYards: null, receivingYards: null };
    const athletes = new Map<string, Promise<unknown>>();
    for (const row of Object.values(selected)) if (row && !athletes.has(row.athleteId) && !controller.signal.aborted) athletes.set(row.athleteId, json(seasonAthleteUrl(row.athleteId, year)).catch(() => null));
    await Promise.all(TEAM_LEADER_ROWS.map(async ([key]) => {
      const row = selected[key];
      const validated = row ? seasonLeaderAthlete(await athletes.get(row.athleteId), row, team, year) : null;
      if (!controller.signal.aborted && partial) partial[key] = validated;
    }));
    return snapshot();
  };
  try { return await Promise.race([work().catch(() => null), stopped]); }
  finally { clearTimeout(timer); rootSignal.removeEventListener("abort", stop); stop(); }
}
