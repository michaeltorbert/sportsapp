import { RANKING_KEYS, parseSeasonRankings, type SeasonRankings, type RankingKey, type RankingMetric } from "./team-season";
import type { LeadersEnv, LeadersKV, RefreshResult } from "./cfbd-season-leaders";
import { cfbdBlocked, blockCfbd, sourceJson, SourceFailure, emptyRefreshBody } from "./cfbd-source-state";
export const RANKINGS_YEAR = 2026, RANKINGS_INTERVAL_MS = 86_400_000, RANKINGS_MAX_AGE_MS = 259_200_000;
export const RANKINGS_SNAPSHOT_KEY = `team-rankings:v1:${RANKINGS_YEAR}`;
const ATTEMPT_KEY = `${RANKINGS_SNAPSHOT_KEY}:attempt`, EXPECTED_FBS = 138;
export const RANKINGS_URLS = [
  `https://api.collegefootballdata.com/teams/fbs?year=${RANKINGS_YEAR}`,
  `https://api.collegefootballdata.com/stats/season?year=${RANKINGS_YEAR}&classification=fbs`,
];
type Team = { id: string; school: string; mascot: string; rankings: SeasonRankings };
export type RankingsSnapshot = { v: 1; year: number; checkedAt: string; teams: Record<string, Team> };
const obj = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const text = (v: unknown): v is string => typeof v === "string" && v.trim() === v && v.length > 0 && v.length <= 64 && !/[\u0000-\u001f\u007f]/.test(v);
const number = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && Math.abs(v) <= 10_000_000;
/** One membership snapshot defines every category's population; missing rows never promote others. */
export function createRankingsSnapshot(identities: unknown, stats: unknown, checkedAt: string): RankingsSnapshot {
  if (!Array.isArray(identities) || identities.length !== EXPECTED_FBS || !Array.isArray(stats) || !stats.length || stats.length > 100_000 || !Number.isFinite(Date.parse(checkedAt))) throw new Error("source-shape");
  const teams: Record<string, Team> = {}, schools = new Map<string, Team>();
  for (const raw of identities) {
    const r = obj(raw), id = typeof r.id === "number" && Number.isSafeInteger(r.id) && r.id > 0 && r.id < 1_000_000 ? String(r.id) : null;
    if (!id || !text(r.school) || !text(r.mascot) || r.classification !== "fbs" || teams[id] || schools.has(r.school)) throw new Error("identity-shape");
    const team: Team = { id, school: r.school, mascot: r.mascot, rankings: { year: RANKINGS_YEAR, checkedAt, stale: false, games: null, population: EXPECTED_FBS, metrics: Object.fromEntries(RANKING_KEYS.map(k => [k, null])) as Record<RankingKey, RankingMetric | null> } };
    teams[id] = team; schools.set(team.school, team);
  }
  const values = new Map<string, Map<string, number | null>>();
  for (const raw of stats) {
    const r = obj(raw), team = typeof r.team === "string" ? schools.get(r.team) : undefined;
    if (!team || (r.statName !== "games" && !RANKING_KEYS.includes(r.statName as RankingKey))) continue;
    const name = r.statName as string, rows = values.get(team.id) ?? new Map<string, number | null>(); values.set(team.id, rows);
    const valid = r.season === RANKINGS_YEAR && number(r.statValue) && (name !== "games" || (r.statValue > 0 && r.statValue <= 20));
    rows.set(name, rows.has(name) || !valid ? null : r.statValue as number);
  }
  for (const team of Object.values(teams)) {
    const games = values.get(team.id)?.get("games");
    team.rankings.games = typeof games === "number" ? games : null;
  }
  for (const key of RANKING_KEYS) {
    const eligible = Object.values(teams).filter(t => t.rankings.games !== null && typeof values.get(t.id)?.get(key) === "number");
    const complete = eligible.length === EXPECTED_FBS;
    for (const team of eligible) {
      const total = values.get(team.id)!.get(key)!, games = team.rankings.games!;
      const comparisons = eligible.map(other => ({ total: values.get(other.id)!.get(key)!, games: other.rankings.games! }));
      // Bounds above keep cross-products exact safe integers. Compare before rounding.
      const better = comparisons.filter(other => key.endsWith("Opponent") ? other.total! * games < total! * other.games : other.total! * games > total! * other.games).length;
      const equal = comparisons.filter(other => other.total! * games === total! * other.games).length;
      team.rankings.metrics[key] = { total: total!, games, rank: complete ? better + 1 : null, population: EXPECTED_FBS, coverage: eligible.length, tied: complete && equal > 1 };
    }
  }
  return { v: 1, year: RANKINGS_YEAR, checkedAt, teams };
}
/** KV only; no public view or retry can consume provider quota. */
export async function readTeamRankings(kv: LeadersKV | undefined, teamId: string, year: number, name: string, shortName: string, now = Date.now()): Promise<SeasonRankings | null> {
  if (!kv || year !== RANKINGS_YEAR) return null;
  try {
    const raw = await kv.get(RANKINGS_SNAPSHOT_KEY);
    if (!raw || raw.length > 600_000) return null;
    const snapshot = obj(JSON.parse(raw)), team = obj(obj(snapshot.teams)[teamId]);
    if (snapshot.v !== 1 || snapshot.year !== year || team.id !== teamId || !text(team.school) || !text(team.mascot) || team.school !== shortName || `${team.school} ${team.mascot}` !== name || obj(team.rankings).checkedAt !== snapshot.checkedAt) return null;
    return parseSeasonRankings(team.rankings, year, now);
  } catch { return null; }
}
export async function refreshTeamRankings(env: LeadersEnv, fetcher: typeof fetch = fetch, now = () => Date.now()): Promise<RefreshResult> {
  const kv = env.SEASON_LEADERS_KV;
  if (!kv || !env.CFBD_API_KEY) return { status: "failed", reason: "configuration" };
  try {
    if (await cfbdBlocked(kv)) return { status: "blocked", reason: "source-blocked" };
    const slot = Math.floor(now() / RANKINGS_INTERVAL_MS), prior = await kv.get(ATTEMPT_KEY);
    if (prior && Number(prior) >= slot) return { status: "skipped", reason: "refresh-slot" };
    await kv.put(ATTEMPT_KEY, String(slot));
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 45_000);
    try {
      const identity = await sourceJson(RANKINGS_URLS[0], env.CFBD_API_KEY, fetcher, controller.signal);
      const stats = await sourceJson(RANKINGS_URLS[1], env.CFBD_API_KEY, fetcher, controller.signal);
      const checkedAt = new Date(now()).toISOString(), snapshot = createRankingsSnapshot(identity, stats, checkedAt);
      await kv.put(RANKINGS_SNAPSHOT_KEY, JSON.stringify(snapshot));
      return { status: "refreshed", checkedAt, teams: Object.keys(snapshot.teams).length };
    } catch (error) {
      if (error instanceof SourceFailure && error.blocked) { await blockCfbd(kv, new Date(now()).toISOString()); return { status: "blocked", reason: "source-blocked" }; }
      return { status: "failed", reason: "source-unavailable" };
    } finally { clearTimeout(timer); }
  } catch { return { status: "failed", reason: "storage-unavailable" }; }
}
export async function handleRankingsRefresh(request: Request, env: LeadersEnv, fetcher: typeof fetch = fetch): Promise<Response> {
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  if (!env.CFBD_REFRESH_TOKEN || request.headers.get("authorization") !== `Bearer ${env.CFBD_REFRESH_TOKEN}`) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  if (request.method !== "POST" || new URL(request.url).search || !(await emptyRefreshBody(request))) return Response.json({ error: "Use an empty POST." }, { status: 400, headers });
  const result = await refreshTeamRankings(env, fetcher);
  return Response.json(result, { status: result.status === "failed" ? 503 : result.status === "blocked" ? 409 : 200, headers });
}
