import { readSeasonLeaders, LEADERS_YEAR, LEADERS_INTERVAL_MS, LEADERS_MAX_AGE_MS, SNAPSHOT_KEY, type LeadersKV } from "./cfbd-season-leaders";
import { TEAM_LEADER_ROWS, type SeasonLeader, type SeasonLeaders, type TeamLeaderKey } from "./team-season";
export type PackLeaderProjection = { v: 1; year: number; seasonType: 2; team: { id: string; name: string }; checkedAt: string; sourceRows: number; leaders: Record<TeamLeaderKey, SeasonLeader | null> };
export const PLAYER_PACK_KEY_PREFIX = "player:v1:pack:";
const obj = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const text = (v: unknown, max = 100): v is string => typeof v === "string" && v.trim() === v && v.length > 0 && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
const personId = (v: unknown): string | null => typeof v === "number" && Number.isSafeInteger(v) && v > 0 && v < 1_000_000_000_000 ? String(v) : typeof v === "string" && /^[1-9]\d{0,11}$/.test(v) ? v : null;
const yards = (v: unknown): number | null => { const n = typeof v === "string" && /^-?\d{1,6}$/.test(v) ? Number(v) : typeof v === "number" ? v : NaN; return Number.isInteger(n) && n >= -999_999 && n <= 999_999 ? n : null; };
/** Raw season rows BEFORE pack.people's lossy ID/field filtering. Never box rows or log sums. */
export function projectPackLeaders(team: { id: string; name: string }, year: number, raw: unknown, checkedAt: string): PackLeaderProjection | null {
  if (year !== LEADERS_YEAR || !/^[1-9]\d{0,5}$/.test(team.id) || !text(team.name, 64) || !Array.isArray(raw) || raw.length > 50_000 || !Number.isFinite(Date.parse(checkedAt))) return null;
  const leaders = Object.fromEntries(TEAM_LEADER_ROWS.map(([k]) => [k, null])) as Record<TeamLeaderKey, SeasonLeader | null>;
  for (const [index, [key]] of TEAM_LEADER_ROWS.entries()) {
    const category = ["passing", "rushing", "receiving"][index], seen = new Map<string, SeasonLeader>(); let invalid = false;
    for (const r of raw.map(obj)) {
      if (r.category !== category || r.statType !== "YDS") continue;
      // The fixed team request has no national rows to silently filter.
      if (r.team !== team.name) return null;
      const pid = personId(r.playerId), value = yards(r.stat);
      if (r.season !== year || !pid || !text(r.player) || value === null) { invalid = true; continue; }
      const prior = seen.get(pid);
      if (prior && (prior.name !== r.player || prior.yards !== value)) invalid = true;
      seen.set(pid, { athleteId: pid, name: r.player, yards: value });
    }
    if (!invalid) leaders[key] = [...seen.values()].sort((a, b) => b.yards - a.yards || a.athleteId.localeCompare(b.athleteId, "en") || a.name.localeCompare(b.name, "en"))[0] ?? null;
  }
  return { v: 1, year, seasonType: 2, team, checkedAt, sourceRows: raw.length, leaders };
}
function decode(raw: string | null, limit: number) { if (!raw || raw.length > limit) return null; try { return obj(JSON.parse(raw)); } catch { return null; } }
/** Optional bounded KV reader only: no source service, fetch, admission, write, refresh or retimestamp. */
export async function readPlayerPackLeaders(kv: LeadersKV | undefined, teamId: string, year: number, name: string, shortName: string, now = Date.now(), deadlineMs = 1500): Promise<SeasonLeaders | null> {
  if (!kv || year !== LEADERS_YEAR || !/^[1-9]\d{0,5}$/.test(teamId)) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const read = async (): Promise<SeasonLeaders | null> => {
    const [catalogRaw, packRaw] = await Promise.all([kv.get(SNAPSHOT_KEY), kv.get(`${PLAYER_PACK_KEY_PREFIX}${teamId}:${year}`)]);
    const catalog = decode(catalogRaw, 600_000), pack = decode(packRaw, 4_000_000);
    if (!catalog || !pack || catalog.v !== 1 || catalog.year !== year || catalog.seasonType !== 2 || typeof catalog.checkedAt !== "string" || !Number.isFinite(Date.parse(catalog.checkedAt)) || Date.parse(catalog.checkedAt) > now) return null;
    const c = obj(obj(catalog.teams)[teamId]);
    if (c.id !== teamId || !text(c.school, 64) || !text(c.mascot, 64) || c.school !== shortName || `${c.school} ${c.mascot}` !== name) return null;
    const team = obj(pack.team), p = obj(pack.leaderProjection), projectedTeam = obj(p.team);
    if (pack.v !== 1 || pack.basis !== "regular" || pack.year !== year || team.id !== teamId || team.name !== c.school || pack.scheduleComplete !== true || !Array.isArray(pack.games) || pack.games.length < 1 || pack.games.length > 30) return null;
    const ids = new Set<string>();
    for (const rawGame of pack.games) {
      const entry = obj(rawGame), game = obj(entry.game);
      if (typeof game.id !== "string" || !/^[1-9]\d{5,11}$/.test(game.id) || ids.has(game.id) || typeof game.date !== "string" || !Number.isFinite(Date.parse(game.date)) || typeof entry.boxSupplied !== "boolean" || !Array.isArray(game.teams) || game.teams.length !== 2) return null;
      ids.add(game.id);
      const sides = game.teams.map(obj);
      if (!sides.every(t => typeof t.id === "string" && /^[1-9]\d{0,5}$/.test(t.id) && text(t.name)) || sides[0].id === sides[1].id || !sides.some(t => t.id === teamId && t.name === c.school)) return null;
    }
    if (!pack.people || typeof pack.people !== "object" || Array.isArray(pack.people) || Object.keys(pack.people).length > 1000) return null;
    if (p.v !== 1 || p.year !== year || p.seasonType !== 2 || projectedTeam.id !== teamId || projectedTeam.name !== team.name || p.checkedAt !== pack.checkedAt || !Number.isInteger(p.sourceRows) || Number(p.sourceRows) < 0 || Number(p.sourceRows) > 50_000) return null;
    const checkedAt = typeof pack.checkedAt === "string" ? pack.checkedAt : "", age = now - Date.parse(checkedAt);
    if (!Number.isFinite(age) || age < 0 || age > LEADERS_MAX_AGE_MS) return null;
    const rawLeaders = obj(p.leaders);
    if (Object.keys(rawLeaders).length !== TEAM_LEADER_ROWS.length || Object.keys(rawLeaders).some(k => !TEAM_LEADER_ROWS.some(([key]) => key === k))) return null;
    const leaders: Record<string, SeasonLeader | null> = {};
    for (const [key] of TEAM_LEADER_ROWS) {
      const raw = rawLeaders[key]; if (raw === null) { leaders[key] = null; continue; }
      const r = obj(raw), pid = personId(r.athleteId), n = yards(r.yards);
      if (!pid || !text(r.name) || n === null || typeof r.yards !== "number") return null;
      leaders[key] = { athleteId: pid, name: r.name, yards: n };
    }
    return { year, seasonType: 2, ...leaders, checkedAt, stale: age > LEADERS_INTERVAL_MS } as SeasonLeaders;
  };
  try { return await Promise.race([read(), new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), Math.min(1500, Math.max(1, deadlineMs))); })]); }
  catch { return null; }
  finally { if (timer !== undefined) clearTimeout(timer); }
}

/** Preserve the original whole snapshot whenever available, including partial categories. */
export async function readAvailableSeasonLeaders(kv: LeadersKV | undefined, teamId: string, year: number, name: string, shortName: string, now = Date.now()) {
  const published = await readSeasonLeaders(kv, teamId, year, name, shortName, now);
  return published ?? readPlayerPackLeaders(kv, teamId, year, name, shortName, now);
}
