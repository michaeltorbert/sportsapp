import { SourceFailure, sourceJson, cfbdBlocked, blockCfbd, emptyRefreshBody } from "./cfbd-source-state";
import type { LeadersEnv, LeadersKV } from "./cfbd-season-leaders";
import { browserSnapshotKey, LEADER_CATEGORIES, parseLeadersSnapshot, privacyGameSchema, type LeadersSnapshot } from "./leaders-browser";
import { teamScheduleUrl } from "./team-season-server";
const DAY = 86400000, HIST_ATTEMPT = "leaders-browser:v1:2025:attempt", ESPN_BLOCK = "leaders-browser:v1:espn-blocked";
const privacyKey = (year: number) => `leaders-browser:v1:${year}:privacy`;
class ScheduleFailure extends Error {
  constructor(readonly reason: "source-blocked" | "storage-unavailable", readonly httpStatus: number) { super(reason); }
}
const object = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
function requireValue(ok: unknown): asserts ok { if (!ok) throw Error("leaders-source-invalid"); }
const text = (v: unknown): v is string => typeof v === "string" && v.trim() === v && v.length > 0 && v.length <= 120 && !/[\u0000-\u001f\u007f<>]/.test(v);
function ident(v: unknown) { const s = String(v); requireValue((typeof v === "string" || Number.isSafeInteger(v)) && /^[1-9]\d{0,5}$/.test(s)); return s; }
export function rejectBrowserKeyEcho(value: unknown, key: string) { if (typeof value === "string") requireValue(!key || !value.toLowerCase().includes(key.toLowerCase())); else if (Array.isArray(value)) value.forEach(v => rejectBrowserKeyEcho(v,key)); else if (value && typeof value === "object") Object.entries(value).forEach(([k,v]) => { rejectBrowserKeyEcho(k,key); rejectBrowserKeyEcho(v,key); }); }
/** One table generation binds selected-year membership and all three complete category responses. */
export function createBrowserSnapshot(identities: unknown, categories: unknown[], year: 2025 | 2026, checkedAt: string): LeadersSnapshot {
  requireValue(Array.isArray(identities) && identities.length > 0 && identities.length <= 300 && categories.length === 3);
  const members = identities.map(raw => { const r = object(raw); requireValue(r.classification === "fbs" && text(r.school) && text(r.mascot) && (r.conference === null || text(r.conference))); return { id: ident(r.id), school: r.school, mascot: r.mascot, conference: r.conference }; });
  const schools = new Map(members.map(t => [t.school,t])); requireValue(schools.size === members.length && new Set(members.map(t => t.id)).size === members.length);
  const tables: LeadersSnapshot["tables"] = { passing: [], rushing: [], receiving: [] };
  categories.forEach((raw,index) => {
    requireValue(Array.isArray(raw) && raw.length > 0 && raw.length <= 100000); const category = LEADER_CATEGORIES[index], seen = new Set<string>();
    for (const item of raw) {
      const r = object(item); requireValue(r.season === year && r.category === category);
      if (r.statType !== "YDS") continue;
      requireValue(text(r.team)); const team = schools.get(r.team); if (!team) continue;
      // Source team/synthetic aggregates are not people. Positive-person malformed rows invalidate the generation.
      if ((typeof r.playerId === "number" || typeof r.playerId === "string") && /^-?\d{1,12}$/.test(String(r.playerId)) && Number(r.playerId) <= 0) continue;
      requireValue(typeof r.playerId === "string" && /^[1-9]\d{0,11}$/.test(r.playerId) || typeof r.playerId === "number" && Number.isSafeInteger(r.playerId) && r.playerId > 0 && r.playerId < 1e12);
      requireValue(text(r.player)); if (/^team(?: totals?)?$/i.test(r.player)) continue;
      const yards = typeof r.stat === "string" && /^-?\d{1,6}$/.test(r.stat) ? Number(r.stat) : typeof r.stat === "number" ? r.stat : NaN;
      requireValue(Number.isInteger(yards) && Math.abs(yards) <= 999999);
      const id = String(r.playerId), key = `${team.id}:${id}`; requireValue(!seen.has(key)); seen.add(key);
      tables[category].push({ id, name: r.player, team: team.id, yards });
    }
    requireValue(tables[category].length > 0);
  });
  const snapshot = parseLeadersSnapshot({ v: 1, year, basis: "regular", checkedAt, members, tables, privacy: null },year,Date.parse(checkedAt)); requireValue(snapshot); return snapshot;
}
/** Strict score-free schedule projection; unknown status never becomes upcoming. */
export function createBrowserPrivacy(raw: unknown, year: number, checkedAt: string) {
  const body = object(raw), requested = object(body.requestedSeason); requireValue(String(object(body.team).id) === "150" && requested.year === year && requested.type === 2 && Array.isArray(body.events) && body.events.length <= 30);
  const seen = new Set<string>();
  const games = body.events.map(item => {
    const e = object(item); requireValue(typeof e.id === "string" && /^[1-9]\d{5,11}$/.test(e.id) && !seen.has(e.id)); seen.add(e.id);
    requireValue(object(e.season).year === year && object(e.seasonType).type === 2 && Array.isArray(e.competitions) && e.competitions.length === 1);
    const c = object(e.competitions[0]); requireValue(Array.isArray(c.competitors) && c.competitors.length === 2 && typeof c.neutralSite === "boolean");
    requireValue((e.timeValid === undefined || typeof e.timeValid === "boolean") && (c.timeValid === undefined || typeof c.timeValid === "boolean"));
    let positiveScore = false;
    const teams = c.competitors.map(value => { const side = object(value), team = object(side.team); const name = team.shortDisplayName ?? team.displayName;
      requireValue(text(name) && (side.homeAway === "away" || side.homeAway === "home"));
      const score = object(side.score), scalar = side.score && typeof side.score === "object" ? score.displayValue ?? score.value : side.score;
      if (scalar !== undefined && scalar !== null && scalar !== "") { requireValue(typeof scalar === "number" && Number.isFinite(scalar) || typeof scalar === "string" && /^\d{1,3}$/.test(scalar)); requireValue(Number(scalar) >= 0 && Number(scalar) <= 999); positiveScore ||= Number(scalar) > 0; }
      return { id: ident(team.id), name, homeAway: side.homeAway }; });
    requireValue(teams[0].id !== teams[1].id && teams[0].homeAway !== teams[1].homeAway && teams.some(t => t.id === "150"));
    const status = object(c.status ?? e.status), t = object(status.type); requireValue(text(t.name) && text(t.state) && typeof t.completed === "boolean");
    const special = /CANCELED|CANCELLED|POSTPONED|NO_CONTEST|FORFEIT/.test(t.name), delayed = /DELAYED|SUSPENDED|INTERRUPTED/.test(t.name);
    const knownName = /^STATUS_(?:SCHEDULED|IN_PROGRESS|FINAL|FINAL_OVERTIME|HALFTIME|END_PERIOD|END_OF_REGULATION)$/.test(t.name) || special || delayed;
    const consistent = t.name === "STATUS_SCHEDULED" ? t.state === "pre" && !t.completed : /^STATUS_FINAL/.test(t.name) ? t.state === "post" && t.completed : special || delayed ? true : t.state === "in" && !t.completed;
    const known = ["pre","in","post"].includes(t.state) && knownName && consistent;
    const state = !known ? "unknown" : special ? "other" : delayed ? "delayed" : t.completed || t.state === "post" ? "final" : t.state === "in" ? "live" : "upcoming";
    const period = status.period ?? 0; requireValue(Number.isInteger(period) && Number(period) >= 0 && Number(period) <= 20);
    const started = known ? Number(period) > 0 || positiveScore || state === "final" || state === "live" : null;
    requireValue(!(state === "upcoming" && started));
    const parsed = privacyGameSchema.safeParse({ id: e.id, date: c.date ?? e.date, timeValid: c.timeValid !== false && e.timeValid !== false, neutralSite: c.neutralSite, state, started, teams }); requireValue(parsed.success); return parsed.data;
  });
  return { checkedAt, games };
}
async function stored(kv: LeadersKV, key: string) { const raw = await kv.get(key); if (raw === null) return null; requireValue(raw.length <= 1500000); return JSON.parse(raw) as unknown; }
export async function readBrowserSnapshot(kv: LeadersKV | undefined, year: number, now = Date.now()) {
  if (!kv || (year !== 2025 && year !== 2026)) return null;
  try {
    const snapshot = parseLeadersSnapshot(await stored(kv,browserSnapshotKey(year)),year,now); if (!snapshot) return null;
    // Privacy has an independent check time. Never stamp old statistics with a newer schedule time.
    const privacy = await stored(kv,privacyKey(year));
    if (privacy !== null) {
      // A newer statistics batch can contain a game the old schedule still called upcoming.
      // Withhold aggregates until the protection check covers at least that table generation.
      if (typeof object(privacy).checkedAt !== "string" || Date.parse(String(object(privacy).checkedAt)) < Date.parse(snapshot.checkedAt)) return snapshot;
      return parseLeadersSnapshot({ ...snapshot, privacy },year,now);
    }
    return snapshot;
  } catch { return null; }
}
export async function browserCatalog(kv: LeadersKV, year: number, now = Date.now()) {
  const s = await readBrowserSnapshot(kv,year,now); return s?.members.map(t => ({ id: t.id, name: t.school })) ?? null;
}
export async function publishCurrentBrowser(kv: LeadersKV, identities: unknown, categories: unknown[], checkedAt: string) {
  const snapshot = createBrowserSnapshot(identities,categories,2026,checkedAt);
  await kv.put(browserSnapshotKey(2026),JSON.stringify(snapshot));
}
async function reserve(kv: LeadersKV, key: string, ttl: number, at: number) {
  const raw = await kv.get(key);
  if (raw !== null) { requireValue(/^\d{1,16}$/.test(raw)); const old = Number(raw); requireValue(Number.isSafeInteger(old) && old <= at); if (at - old < ttl) return false; }
  const value = String(at); await kv.put(key,value); requireValue(await kv.get(key) === value); return true;
}
async function scheduleSource(kv: LeadersKV, year: number, fetcher: typeof fetch, signal: AbortSignal) {
  // No CFBD key or credentials are passed to this ordinary fixed ESPN schedule request.
  const response = await fetcher(teamScheduleUrl("150",{ year, type: 2 }),{ headers: { Accept: "application/json" }, redirect: "manual", signal });
  const denied = [401,403,429].includes(response.status) || response.status >= 300 && response.status < 400 || response.headers.get("cf-mitigated") === "challenge" || /html/i.test(response.headers.get("content-type") ?? "");
  const blockSchedule = async (): Promise<never> => {
    try { await kv.put(ESPN_BLOCK,"source-blocked"); }
    catch { throw new ScheduleFailure("storage-unavailable",response.status); }
    throw new ScheduleFailure("source-blocked",response.status);
  };
  if (denied) { void response.body?.cancel().catch(() => {}); return blockSchedule(); }
  requireValue(response.ok && /application\/json/i.test(response.headers.get("content-type") ?? ""));
  const reader = response.body?.getReader(); requireValue(reader); const chunks: Uint8Array[] = []; let count = 0;
  try { for (;;) { const {done,value} = await reader.read(); if (done) break; count += value.byteLength; requireValue(count <= 2000000); chunks.push(value); } } finally { void reader.cancel().catch(() => {}); }
  const all = new Uint8Array(count); let offset = 0; for (const chunk of chunks) { all.set(chunk,offset); offset += chunk.length; }
  const body = new TextDecoder().decode(all);
  if (/^\s*</.test(body) || /captcha|cf-chl-|challenge-platform/i.test(body)) return blockSchedule();
  return JSON.parse(body) as unknown;
}
/** Fixed historical resource + modest shared privacy checks. Never fetches current CFBD tables again. */
export async function refreshBrowserSources(env: LeadersEnv, fetcher: typeof fetch = fetch, now = Date.now) {
  const kv = env.SEASON_LEADERS_KV; if (!kv || !env.CFBD_API_KEY) return { status: "failed", reason: "configuration" };
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(),90000);
  try {
    if (await cfbdBlocked(kv) || await kv.get(ESPN_BLOCK)) return { status: "blocked", reason: "source-blocked" };
    const at = now(), checkedAt = new Date(at).toISOString(); let changed = false;
    const previous = await readBrowserSnapshot(kv,2025,at);
    const historyFresh = previous?.privacy && at - Date.parse(previous.checkedAt) < 30 * DAY;
    // Thirty days is the GOOD historical cache lifetime. A failed non-denial attempt has its
    // own daily admission on the same retained key, so first-use availability is not lost for a month.
    if (!historyFresh && await reserve(kv,HIST_ATTEMPT,DAY,at)) {
      const urls = [`https://api.collegefootballdata.com/teams/fbs?year=2025`, ...LEADER_CATEGORIES.map(category => `https://api.collegefootballdata.com/stats/player/season?year=2025&category=${category}&seasonType=regular`)];
      const values: unknown[] = [];
      for (const url of urls) { const value = await sourceJson(url,env.CFBD_API_KEY,fetcher,controller.signal); rejectBrowserKeyEcho(value,env.CFBD_API_KEY); values.push(value); }
      const snapshot = createBrowserSnapshot(values[0],values.slice(1),2025,checkedAt);
      const raw = await scheduleSource(kv,2025,fetcher,controller.signal); rejectBrowserKeyEcho(raw,env.CFBD_API_KEY);
      snapshot.privacy = createBrowserPrivacy(raw,2025,checkedAt);
      await kv.put(browserSnapshotKey(2025),JSON.stringify(snapshot)); changed = true;
    }
    if (await reserve(kv,privacyKey(2026) + ":attempt",12 * 3600000,at)) {
      const raw = await scheduleSource(kv,2026,fetcher,controller.signal); rejectBrowserKeyEcho(raw,env.CFBD_API_KEY);
      await kv.put(privacyKey(2026),JSON.stringify(createBrowserPrivacy(raw,2026,checkedAt))); changed = true;
    }
    return { status: changed ? "refreshed" : "skipped" };
  } catch (error) {
    if (error instanceof ScheduleFailure) return { status: error.reason === "storage-unavailable" ? "failed" : "blocked", reason: error.reason, source: "espn-schedule", sourceBlocked: true, httpStatus: error.httpStatus };
    if (error instanceof SourceFailure && error.blocked) { try { await blockCfbd(kv,new Date(now()).toISOString()); } catch { return { status: "failed", reason: "storage-unavailable" }; } return { status: "blocked", reason: "source-blocked" }; }
    return { status: "failed", reason: "browser-source-unavailable" };
  } finally { clearTimeout(timer); }
}
export async function handleBrowserRefresh(request: Request, env: LeadersEnv, fetcher: typeof fetch = fetch) {
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  if (!env.CFBD_REFRESH_TOKEN || request.headers.get("authorization") !== `Bearer ${env.CFBD_REFRESH_TOKEN}`) return Response.json({error:"Unauthorized"},{status:401,headers});
  if (request.method !== "POST" || new URL(request.url).search || !(await emptyRefreshBody(request))) return Response.json({error:"Use an empty POST."},{status:400,headers});
  const result = await refreshBrowserSources(env,fetcher); return Response.json(result,{status:result.status === "failed" ? 503 : result.status === "blocked" ? 409 : 200,headers});
}
