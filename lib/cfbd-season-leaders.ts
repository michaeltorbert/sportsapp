import { TEAM_LEADER_ROWS, type SeasonLeaders, type SeasonLeader, type TeamLeaderKey } from "./team-season";

export const LEADERS_YEAR = 2026;
export const LEADERS_INTERVAL_MS = 12 * 60 * 60 * 1000;
export const LEADERS_MAX_AGE_MS = 36 * 60 * 60 * 1000;
export const SNAPSHOT_KEY = `season-leaders:v1:${LEADERS_YEAR}:regular`;
const ATTEMPT_KEY = `${SNAPSHOT_KEY}:attempt`, BLOCKED_KEY = `${SNAPSHOT_KEY}:blocked`;
const MAX_BYTES = 8_000_000, REFRESH_TIMEOUT_MS = 90_000;
export interface LeadersKV { get(key: string): Promise<string | null>; put(key: string, value: string): Promise<void> }
export type LeadersEnv = { SEASON_LEADERS_KV?: LeadersKV; CFBD_API_KEY?: string; CFBD_REFRESH_TOKEN?: string };
type Team = { id: string; school: string; mascot: string; leaders: SeasonLeaders };
export type LeadersSnapshot = { v: 1; year: number; seasonType: 2; checkedAt: string; teams: Record<string, Team> };
const obj = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const text = (v: unknown, max = 100): v is string => typeof v === "string" && v.trim() === v && v.length > 0 && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
const id = (v: unknown): string | null => typeof v === "number" && Number.isSafeInteger(v) && v > 0 && v < 1_000_000_000_000 ? String(v) : typeof v === "string" && /^\d{1,12}$/.test(v) ? v : null;
const yards = (v: unknown): number | null => {
  const n = typeof v === "string" && /^-?\d{1,6}$/.test(v) ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isInteger(n) && n >= -999_999 && n <= 999_999 ? n : null;
};
/** Fixed URLs only. No caller-controlled team/year/category reaches the provider. */
export const CFBD_URLS = [
  `https://api.collegefootballdata.com/teams/fbs?year=${LEADERS_YEAR}`,
  ...["passing", "rushing", "receiving"].map(category => `https://api.collegefootballdata.com/stats/player/season?year=${LEADERS_YEAR}&category=${category}&seasonType=regular`),
];

export function createLeadersSnapshot(identities: unknown, categories: unknown[], checkedAt: string): LeadersSnapshot {
  if (!Array.isArray(identities) || identities.length < 1 || identities.length > 300 || categories.length !== 3 || !Number.isFinite(Date.parse(checkedAt))) throw new Error("source-shape");
  const teams: Record<string, Team> = {}, schools = new Map<string, Team>();
  for (const raw of identities) {
    const row = obj(raw), teamId = id(row.id);
    if (!teamId || row.classification !== "fbs" || !text(row.school, 64) || !text(row.mascot, 64) || teams[teamId] || schools.has(row.school)) throw new Error("identity-shape");
    const team: Team = { id: teamId, school: row.school, mascot: row.mascot, leaders: { year: LEADERS_YEAR, seasonType: 2, passingYards: null, rushingYards: null, receivingYards: null } };
    teams[teamId] = team; schools.set(team.school, team);
  }
  categories.forEach((rawRows, index) => {
    if (!Array.isArray(rawRows) || !rawRows.length || rawRows.length > 100_000) throw new Error("category-shape");
    const category = ["passing", "rushing", "receiving"][index], key = TEAM_LEADER_ROWS[index][0];
    const invalid = new Set<string>(), seen = new Map<string, Map<string, SeasonLeader>>();
    for (const raw of rawRows) {
      const row = obj(raw);
      if (row.statType !== "YDS") continue;
      const team = typeof row.team === "string" ? schools.get(row.team) : undefined;
      if (!team) continue; // National captures include non-FBS teams.
      const value = yards(row.stat), athleteId = id(row.playerId);
      // A malformed candidate can be the maximum: never promote a lower valid row.
      if (row.season !== LEADERS_YEAR || row.category !== category || value === null || !athleteId || !text(row.player)) { invalid.add(team.id); continue; }
      const rows = seen.get(team.id) ?? new Map<string, SeasonLeader>(); seen.set(team.id, rows);
      const prior = rows.get(athleteId);
      if (prior && (prior.name !== row.player || prior.yards !== value)) invalid.add(team.id);
      rows.set(athleteId, { athleteId, name: row.player, yards: value });
    }
    for (const team of Object.values(teams)) {
      if (invalid.has(team.id)) continue;
      const candidates = [...(seen.get(team.id)?.values() ?? [])];
      candidates.sort((a, b) => b.yards - a.yards || a.athleteId.localeCompare(b.athleteId, "en") || a.name.localeCompare(b.name, "en"));
      team.leaders[key] = candidates[0] ?? null;
    }
  });
  if (!Object.values(teams).some(team => TEAM_LEADER_ROWS.some(([key]) => team.leaders[key]))) throw new Error("no-valid-leaders");
  return { v: 1, year: LEADERS_YEAR, seasonType: 2, checkedAt, teams };
}

/** Public request path: KV reads only. Identity is correlated with ESPN's canonical ID AND school/name. */
export async function readSeasonLeaders(kv: LeadersKV | undefined, teamId: string, year: number, name: string, shortName: string, now = Date.now()): Promise<SeasonLeaders | null> {
  if (!kv || year !== LEADERS_YEAR) return null;
  try {
    const raw = await kv.get(SNAPSHOT_KEY);
    if (!raw || raw.length > 300_000) return null;
    const snapshot = obj(JSON.parse(raw)), checkedAt = snapshot.checkedAt;
    const age = typeof checkedAt === "string" ? now - Date.parse(checkedAt) : NaN;
    if (snapshot.v !== 1 || snapshot.year !== year || snapshot.seasonType !== 2 || !Number.isFinite(age) || age < 0 || age > LEADERS_MAX_AGE_MS) return null;
    const team = obj(obj(snapshot.teams)[teamId]), leaders = obj(team.leaders);
    if (team.id !== teamId || !text(team.school, 64) || !text(team.mascot, 64) || team.school !== shortName || `${team.school} ${team.mascot}` !== name || leaders.year !== year || leaders.seasonType !== 2) return null;
    const rows = Object.fromEntries(TEAM_LEADER_ROWS.map(([key]) => {
      const row = obj(leaders[key]), athleteId = id(row.athleteId), value = yards(row.yards);
      return [key, athleteId && text(row.name) && value !== null ? { athleteId, name: row.name, yards: value } : null];
    })) as Record<TeamLeaderKey, SeasonLeader | null>;
    return { year, seasonType: 2, ...rows, checkedAt: checkedAt as string, stale: age > LEADERS_INTERVAL_MS };
  } catch { return null; }
}

class SourceFailure extends Error { constructor(readonly reason: string, readonly blocked = false) { super(reason); } }
async function sourceJson(url: string, key: string, fetcher: typeof fetch, signal: AbortSignal) {
  const response = await fetcher(url, { headers: { Accept: "application/json", Authorization: `Bearer ${key}` }, redirect: "manual", signal });
  const contentType = response.headers.get("content-type") ?? "";
  if ([401,403,429].includes(response.status) || /\bhtml\b/i.test(contentType)) { await response.body?.cancel(); throw new SourceFailure("source-blocked", true); }
  if (!response.ok || !/\bapplication\/(?:[\w.+-]+\+)?json\b/i.test(contentType)) { await response.body?.cancel(); throw new SourceFailure("source-response"); }
  if (Number(response.headers.get("content-length")) > MAX_BYTES) { await response.body?.cancel(); throw new SourceFailure("source-size"); }
  const reader = response.body?.getReader();
  if (!reader) throw new SourceFailure("source-body");
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) { const result = await reader.read(); if (result.done) break; bytes += result.value.byteLength; if (bytes > MAX_BYTES) throw new SourceFailure("source-size"); chunks.push(result.value); }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  const all = new Uint8Array(bytes); let offset = 0;
  for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.byteLength; }
  const body = new TextDecoder().decode(all);
  if (/^\s*</.test(body)) throw new SourceFailure("source-blocked", true);
  return JSON.parse(body) as unknown;
}
export type RefreshResult = { status: "refreshed" | "skipped" | "blocked" | "failed"; reason?: string; checkedAt?: string; teams?: number };
/** KV pacing is deliberately NOT an atomic lock or an account-wide hard quota guarantee. */
export async function refreshSeasonLeaders(env: LeadersEnv, fetcher: typeof fetch = fetch, now = () => Date.now()): Promise<RefreshResult> {
  const kv = env.SEASON_LEADERS_KV;
  if (!kv || !env.CFBD_API_KEY) return { status: "failed", reason: "configuration" };
  try {
    if (await kv.get(BLOCKED_KEY)) return { status: "blocked", reason: "source-blocked" };
    const slot = Math.floor(now() / LEADERS_INTERVAL_MS), attempt = await kv.get(ATTEMPT_KEY);
    if (attempt && Number(attempt) >= slot) return { status: "skipped", reason: "refresh-slot" };
    await kv.put(ATTEMPT_KEY, String(slot)); // Persist before first paid/quota-limited source call.
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS);
    try {
      const identity = await sourceJson(CFBD_URLS[0], env.CFBD_API_KEY, fetcher, controller.signal);
      const categories: unknown[] = [];
      for (const url of CFBD_URLS.slice(1)) categories.push(await sourceJson(url, env.CFBD_API_KEY, fetcher, controller.signal));
      const checkedAt = new Date(now()).toISOString(), snapshot = createLeadersSnapshot(identity, categories, checkedAt);
      await kv.put(SNAPSHOT_KEY, JSON.stringify(snapshot));
      return { status: "refreshed", checkedAt, teams: Object.keys(snapshot.teams).length };
    } catch (error) {
      if (error instanceof SourceFailure && error.blocked) {
        await kv.put(BLOCKED_KEY, JSON.stringify({ reason: "source-blocked", checkedAt: new Date(now()).toISOString() })); // No expiration; operator intervention required.
        return { status: "blocked", reason: "source-blocked" };
      }
      return { status: "failed", reason: "source-unavailable" };
    } finally { clearTimeout(timer); }
  } catch { return { status: "failed", reason: "storage-unavailable" }; }
}
export async function handleLeadersRefresh(request: Request, env: LeadersEnv, fetcher: typeof fetch = fetch): Promise<Response> {
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  // Authenticate before any KV operation or source call. Fixed request, no force/year/team parameters.
  if (!env.CFBD_REFRESH_TOKEN || request.headers.get("authorization") !== `Bearer ${env.CFBD_REFRESH_TOKEN}`) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  if (request.method !== "POST" || new URL(request.url).search || request.body !== null) return Response.json({ error: "Use an empty POST." }, { status: 400, headers });
  const result = await refreshSeasonLeaders(env, fetcher);
  return Response.json(result, { status: result.status === "failed" ? 503 : result.status === "blocked" ? 409 : 200, headers });
}
