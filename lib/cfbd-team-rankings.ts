import { RANKING_KEYS, parseSeasonRankings, type SeasonRankings, type RankingKey, type RankingMetric } from "./team-season";
import type { LeadersEnv, LeadersKV, RefreshResult } from "./cfbd-season-leaders";
import { cfbdBlocked, blockCfbd, sourceJson, SourceFailure, emptyRefreshBody, type SourceReason } from "./cfbd-source-state";
import { createScoringRankings, SCORING_GAMES_URL } from "./cfbd-scoring-rankings";
export const RANKINGS_YEAR = 2026, RANKINGS_INTERVAL_MS = 86_400_000, RANKINGS_MAX_AGE_MS = 259_200_000;
export const RANKINGS_SNAPSHOT_KEY = `team-rankings:v1:${RANKINGS_YEAR}`;
const ATTEMPT_KEY = `${RANKINGS_SNAPSHOT_KEY}:attempt`, EXPECTED_FBS = 138;
// 1.29.1 (E-S5-502): additive keys only. The primary attempt key/value above is unchanged.
// A receipt is minted only by a trusted scheduled 05 UTC primary whose own membership read got a
// non-denial HTTP 502; the separate consumption key admits at most ONE same-UTC-day 17 UTC recovery.
export const RANKINGS_ELIGIBLE_KEY = `${RANKINGS_SNAPSHOT_KEY}:recovery-eligible`, RANKINGS_RECOVERY_KEY = `${RANKINGS_SNAPSHOT_KEY}:recovery`;
export const RANKINGS_CRON = "0 5,17 * * *";
/** Trusted controller context from the Worker's scheduled event only. Operator/public paths never pass one. */
export type RankingsSchedule = { cron: unknown; scheduledTime: unknown };
type SchedulePhase = "primary05" | "recovery17";
/** Exact configured cron, finite controller time on the current UTC day, and its UTC hour. Jitter stays in-hour. */
function schedulePhase(schedule: RankingsSchedule | undefined, nowMs: number): SchedulePhase | null {
  if (!schedule || schedule.cron !== RANKINGS_CRON || !Number.isFinite(nowMs)) return null;
  const t = schedule.scheduledTime;
  if (typeof t !== "number" || !Number.isFinite(t) || t <= 0 || Math.floor(t / RANKINGS_INTERVAL_MS) !== Math.floor(nowMs / RANKINGS_INTERVAL_MS)) return null;
  const hour = new Date(t).getUTCHours();
  return hour === 5 ? "primary05" : hour === 17 ? "recovery17" : null;
}
const ELIGIBLE_FIELDS = ["v", "slot", "at", "phase", "stage", "reason", "httpStatus"].sort().join();
/** Strict bounded v1 receipt for exactly this slot; anything else (legacy, malformed, future, other day) fails closed. */
function eligibleFor(raw: string | null, slot: number, nowMs: number): boolean {
  if (raw === null || raw.length > 256) return false;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    const r = parsed as Record<string, unknown>;
    return Object.keys(r).sort().join() === ELIGIBLE_FIELDS && r.v === 1 && r.slot === slot && typeof r.at === "number" && Number.isSafeInteger(r.at)
      && Math.floor(r.at / RANKINGS_INTERVAL_MS) === slot && r.at <= nowMs && r.phase === "primary05" && r.stage === "membership" && r.reason === "source-response" && r.httpStatus === 502;
  } catch { return false; }
}
/** The public reader's bound; a generation that would exceed it publishes without its optional scoring child. */
export const RANKINGS_MAX_CHARS = 600_000;
// Fixed reads in order: membership, season stats, then (#189) the national regular-season games for scoring.
export const RANKINGS_URLS = [
  `https://api.collegefootballdata.com/teams/fbs?year=${RANKINGS_YEAR}`,
  `https://api.collegefootballdata.com/stats/season?year=${RANKINGS_YEAR}&classification=fbs`,
  SCORING_GAMES_URL,
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
    if (!raw || raw.length > RANKINGS_MAX_CHARS) return null;
    const snapshot = obj(JSON.parse(raw)), team = obj(obj(snapshot.teams)[teamId]);
    if (snapshot.v !== 1 || snapshot.year !== year || team.id !== teamId || !text(team.school) || !text(team.mascot) || team.school !== shortName || `${team.school} ${team.mascot}` !== name || obj(team.rankings).checkedAt !== snapshot.checkedAt) return null;
    return parseSeasonRankings(team.rankings, year, now);
  } catch { return null; }
}
export type RankingDiagnostic = {
  stage: "block-read" | "attempt-read" | "attempt-write" | "recovery-read" | "recovery-write" | "membership" | "stats" | "games" | "snapshot-validation" | "snapshot-write" | "block-write";
  reason: SourceReason | "source-unavailable" | "snapshot-invalid" | "storage-unavailable";
  httpStatus?: number; sourceBlocked?: true;
};
/** A known 502 whose eligibility receipt could not be stored: the original diagnostic is kept alongside this. */
export type RecoveryDiagnostic = { stage: "eligibility-write"; reason: "storage-unavailable" };
/** #189 private partial result: yardage refreshed, scoring not. Fixed fields only; no remote text, body or key. */
export type ScoringDiagnostic = { stage: "games" | "scoring-validation"; reason: SourceReason | "source-unavailable" | "scoring-invalid" | "snapshot-size"; httpStatus?: number };
export type SourceTiming = { requestLimitMs: 45000; membershipMs?: number; statsMs?: number; gamesMs?: number; totalMs: number };
export type RankingsRefreshResult = RefreshResult & { diagnostic?: RankingDiagnostic; recoveryDiagnostic?: RecoveryDiagnostic; sourceTiming?: SourceTiming; scoring?: "published" | "unavailable"; scoringDiagnostic?: ScoringDiagnostic; attempt?: "recovery" };
function diagnosed(result: RefreshResult, diagnostic: RankingDiagnostic, sourceTiming?: SourceTiming, recoveryDiagnostic?: RecoveryDiagnostic): RankingsRefreshResult {
  const recovery = recoveryDiagnostic ? { recoveryDiagnostic } : {};
  console.warn(JSON.stringify({ event: "team_rankings_refresh_failed", diagnostic, ...recovery, ...(sourceTiming ? { sourceTiming } : {}) }));
  return { ...result, diagnostic, ...recovery, ...(sourceTiming ? { sourceTiming } : {}) };
}
/**
 * `schedule` is supplied only by the Worker's scheduled handler. Without it (operator POST, tests, legacy callers)
 * the ordinary daily primary behaves exactly as before but can never mint or consume a recovery opportunity.
 * KV pacing remains non-atomic: no exactly-once or account-wide quota guarantee.
 */
export async function refreshTeamRankings(env: LeadersEnv, fetcher: typeof fetch = fetch, now = () => Date.now(), monotonic = () => performance.now(), schedule?: RankingsSchedule): Promise<RankingsRefreshResult> {
  const kv = env.SEASON_LEADERS_KV;
  if (!kv || !env.CFBD_API_KEY) return { status: "failed", reason: "configuration" };
  let stage: RankingDiagnostic["stage"] = "block-read";
  let sourceTiming: SourceTiming | undefined;
  // Private operation timings only. Each full sourceJson (headers AND body) owns its timer.
  const elapsed = (start: number) => { const ms = monotonic() - start; return Number.isFinite(ms) ? Math.min(3_600_000, Math.max(0, Math.round(ms))) : 0; };
  const readSource = async (url: string, phase: "membership" | "stats" | "games") => {
    sourceTiming ??= { requestLimitMs: 45000, totalMs: 0 };
    const controller = new AbortController(), started = monotonic();
    const timer = setTimeout(() => controller.abort(), 45_000);
    try { return await sourceJson(url, env.CFBD_API_KEY!, fetcher, controller.signal); }
    finally {
      clearTimeout(timer);
      sourceTiming[`${phase}Ms`] = elapsed(started);
      sourceTiming.totalMs = (sourceTiming.membershipMs ?? 0) + (sourceTiming.statsMs ?? 0) + (sourceTiming.gamesMs ?? 0);
    }
  };
  // One unchanged generation body shared by the primary and the single recovery. Only the primary may mint.
  const generate = async (slot: number, mint: boolean): Promise<RankingsRefreshResult> => {
    try {
      stage = "membership";
      const identity = await readSource(RANKINGS_URLS[0], "membership");
      stage = "stats";
      const stats = await readSource(RANKINGS_URLS[1], "stats");
      stage = "snapshot-validation";
      const checkedAt = new Date(now()).toISOString(), snapshot = createRankingsSnapshot(identity, stats, checkedAt);
      // #189: one fixed national games read, only after valid legacy yardage. An actual denial propagates to the
      // existing block path below (blocked, last-good kept, nothing from this generation written). Any other
      // games, validation or size failure still publishes the yardage with scoring unavailable, never "refreshed".
      let serialized = JSON.stringify(snapshot), scoring: "published" | "unavailable" = "unavailable", scoringDiagnostic: ScoringDiagnostic | undefined;
      stage = "games";
      let games: unknown;
      try { games = await readSource(RANKINGS_URLS[2], "games"); }
      catch (error) {
        if (error instanceof SourceFailure && error.blocked) throw error;
        const source = error instanceof SourceFailure ? error : null;
        scoringDiagnostic = { stage: "games", reason: source?.reason ?? "source-unavailable", ...(source?.httpStatus === undefined ? {} : { httpStatus: source.httpStatus }) };
      }
      if (!scoringDiagnostic) {
        try {
          const byTeam = createScoringRankings(Object.values(snapshot.teams).map(t => ({ id: t.id, school: t.school })), games, checkedAt, EXPECTED_FBS);
          const candidate = JSON.stringify({ ...snapshot, teams: Object.fromEntries(Object.entries(snapshot.teams).map(([id, t]) => [id, { ...t, rankings: { ...t.rankings, scoring: byTeam[id] ?? null } }])) });
          if (candidate.length > RANKINGS_MAX_CHARS) scoringDiagnostic = { stage: "scoring-validation", reason: "snapshot-size" };
          else { serialized = candidate; scoring = "published"; }
        } catch { scoringDiagnostic = { stage: "scoring-validation", reason: "scoring-invalid" }; }
      }
      stage = "snapshot-write";
      await kv.put(RANKINGS_SNAPSHOT_KEY, serialized);
      if (scoringDiagnostic) console.warn(JSON.stringify({ event: "team_rankings_scoring_unavailable", scoringDiagnostic, ...(sourceTiming ? { sourceTiming } : {}) }));
      return { status: "refreshed", checkedAt, teams: Object.keys(snapshot.teams).length, sourceTiming, scoring, ...(scoringDiagnostic ? { scoringDiagnostic } : {}) };
    } catch (error) {
      const source = error instanceof SourceFailure ? error : null;
      const observed = source?.httpStatus === undefined ? {} : { httpStatus: source.httpStatus };
      if (source?.blocked) {
        const failureStage = stage;
        stage = "block-write";
        try { await blockCfbd(kv, new Date(now()).toISOString()); }
        catch { return diagnosed({ status: "failed", reason: "storage-unavailable" }, { stage, reason: "storage-unavailable", sourceBlocked: true, ...observed }, sourceTiming); }
        // A successful persistent block reports the original source phase, not block-write.
        return diagnosed({ status: "blocked", reason: "source-blocked" }, { stage: failureStage, reason: source.reason, ...observed }, sourceTiming);
      }
      const storage = stage === "snapshot-write";
      const diagnostic: RankingDiagnostic = { stage, reason: storage ? "storage-unavailable" : stage === "snapshot-validation" ? "snapshot-invalid" : source?.reason ?? "source-unavailable", ...observed };
      // E-S5-502: only this exact non-denial membership failure of a trusted 05 primary is recoverable.
      const at = Math.floor(now());
      // A receipt binds this slot; a clock outside it (e.g. day rollover mid-read) simply mints nothing.
      if (mint && stage === "membership" && source && !source.blocked && source.reason === "source-response" && source.httpStatus === 502
        && Number.isSafeInteger(at) && Math.floor(at / RANKINGS_INTERVAL_MS) === slot) {
        try {
          await kv.put(RANKINGS_ELIGIBLE_KEY, JSON.stringify({ v: 1, slot, at, phase: "primary05", stage: "membership", reason: "source-response", httpStatus: 502 }));
        } catch {
          // Keep the source cause visible AND stop the Worker's later products, as for any storage failure.
          return diagnosed({ status: "failed", reason: "storage-unavailable" }, diagnostic, sourceTiming, { stage: "eligibility-write", reason: "storage-unavailable" });
        }
      }
      return diagnosed({ status: "failed", reason: storage ? "storage-unavailable" : "source-unavailable" }, diagnostic, sourceTiming);
    }
  };
  try {
    const nowMs = now(), phase = schedulePhase(schedule, nowMs);
    // Legacy and common denial markers override every admission, including recovery.
    if (await cfbdBlocked(kv)) return { status: "blocked", reason: "source-blocked" };
    stage = "attempt-read";
    const slot = Math.floor(nowMs / RANKINGS_INTERVAL_MS), prior = await kv.get(ATTEMPT_KEY);
    if (prior && Number(prior) >= slot) {
      // Not a reset or replay: the consumed primary stays consumed. No extra KV reads outside a trusted 17 run.
      if (phase !== "recovery17" || prior !== String(slot)) return { status: "skipped", reason: "refresh-slot" };
      stage = "recovery-read";
      const eligible = await kv.get(RANKINGS_ELIGIBLE_KEY), consumed = await kv.get(RANKINGS_RECOVERY_KEY);
      const unused = consumed === null || (/^\d{1,10}$/.test(consumed) && Number(consumed) < slot);
      if (!unused || !eligibleFor(eligible, slot, nowMs)) return { status: "skipped", reason: "refresh-slot" };
      stage = "recovery-write";
      await kv.put(RANKINGS_RECOVERY_KEY, String(slot)); // Reserved before any source egress; never renewed.
      return { ...(await generate(slot, false)), attempt: "recovery" };
    }
    stage = "attempt-write";
    await kv.put(ATTEMPT_KEY, String(slot));
    return await generate(slot, phase === "primary05");
  } catch { return diagnosed({ status: "failed", reason: "storage-unavailable" }, { stage, reason: "storage-unavailable" }, sourceTiming); }
}
export async function handleRankingsRefresh(request: Request, env: LeadersEnv, fetcher: typeof fetch = fetch): Promise<Response> {
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  if (!env.CFBD_REFRESH_TOKEN || request.headers.get("authorization") !== `Bearer ${env.CFBD_REFRESH_TOKEN}`) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  if (request.method !== "POST" || new URL(request.url).search || !(await emptyRefreshBody(request))) return Response.json({ error: "Use an empty POST." }, { status: 400, headers });
  const result = await refreshTeamRankings(env, fetcher);
  return Response.json(result, { status: result.status === "failed" ? 503 : result.status === "blocked" ? 409 : 200, headers });
}
