import { projectPackLeaders, type PackLeaderProjection } from "./player-pack-leaders";
import type { Game, Team } from "./football";
import { PLAYER_CATEGORIES, PLAYER_FIELDS, PLAYER_YEAR, PLAYER_UNKNOWN_GAME_STATUS, playerId, playerTeamId, playerYear, type PlayerCategory, type PlayerRequest, type PlayerSeason, type PlayerStats } from "./player-season";
import { SNAPSHOT_KEY, type LeadersEnv, type LeadersKV } from "./cfbd-season-leaders";
import { blockCfbd, cfbdBlocked, sourceJson, SourceFailure } from "./cfbd-source-state";

export type CanonicalTeam = { id: string; name: string };
type Person = { name: string; position: string | null; stats: PlayerStats };
export type PlayerPack = { v: 1; basis: "regular"; leaderProjection?: PackLeaderProjection | null; team: CanonicalTeam; year: number; checkedAt: string; scheduleComplete: boolean; people: Record<string, Person>;
  games: { game: Game; players: Record<string, PlayerStats>; boxSupplied: boolean }[];
  witnesses: Record<string, { team: CanonicalTeam; classification: string | null; people: Record<string, string>; gameIds: string[]; gamePeople: Record<string, Record<string, string>> }> };
export type PlayerIdentity = { id: string; name: string; position: string | null; checkedAt: string; currentTeam: string;
  stints: { team: string; start: number; end: number }[]; start: number; end: number };
const obj = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
function requireValue(value: unknown): asserts value { if (!value) throw new Error("source-shape"); }
function array(v: unknown, max: number) { requireValue(Array.isArray(v) && v.length <= max); return v as unknown[]; }
function text(v: unknown, max = 100): v is string { return typeof v === "string" && v.length > 0 && v.length <= max && !/[\u0000-\u001f\u007f<>]/.test(v); }
const numeric = (v: unknown) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 1_000_000 ? v : typeof v === "string" && /^-?\d{1,7}(?:\.\d{1,6})?$/.test(v) && Math.abs(Number(v)) <= 1_000_000 ? Number(v) : null;
const id = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? String(v) : playerId(v) ? v : "";
function category(v: unknown): v is PlayerCategory { return PLAYER_CATEGORIES.includes(v as PlayerCategory); }
function field(c: PlayerCategory, k: string) { return PLAYER_FIELDS[c].some(([f]) => f === k); }
function add(stats: PlayerStats, c: PlayerCategory, k: string, value: unknown) {
  const values = stats[c] ??= {}; let n = numeric(value);
  if (n !== null && ((k === "PCT" && (n < 0 || n > 1)) || (["COMPLETIONS", "ATT", "TD", "INT", "CAR", "REC"].includes(k) && (!Number.isInteger(n) || n < 0)) || (["YDS", "LONG"].includes(k) && !Number.isInteger(n)))) n = null;
  values[k] = Object.hasOwn(values, k) ? null : n;
}
function person(people: Record<string, Person>, pid: string, name: string, position: string | null) {
  const existing = people[pid]; requireValue(!existing || existing.name === name);
  return people[pid] ??= { name, position, stats: {} };
}
function teamGame(r: Record<string, unknown>): Game {
  requireValue(playerId(id(r.id)) && /^\d{6,12}$/.test(id(r.id)) && text(r.startDate, 40) && Number.isFinite(Date.parse(r.startDate)));
  const make = (side: string): Team => {
    const tid = id(r[side + "Id"]), name = r[side + "Team"], score = r[side + "Points"];
    requireValue(playerTeamId(tid) && text(name));
    requireValue(score === null || score === undefined || (typeof score === "number" && Number.isInteger(score) && score >= 0 && score <= 300));
    return { id: tid, name, abbreviation: "", logo: null, score: typeof score === "number" ? score : null, rank: null, rankKnown: false, record: "", conferenceId: null };
  };
  const final = r.completed === true;
  return { id: id(r.id), date: r.startDate, timeValid: r.startTimeTBD === false,
    ...(typeof r.neutralSite === "boolean" ? { neutralSite: r.neutralSite } : {}), state: final ? "final" : "other",
    status: final ? "Final" : PLAYER_UNKNOWN_GAME_STATUS, period: 0, clock: 0, clockKnown: false, started: final,
    teams: [make("away"), make("home")], broadcast: "", possession: null, downDistance: "", redZone: false, url: "" };
}
/** Fixed source basis; full selected-team schedule, including non-FBS opponents. No sums/DNP guesses. */
export function createPlayerPack(team: CanonicalTeam, year: number, stats: unknown, schedule: unknown, boxes: unknown, checkedAt: string): PlayerPack {
  requireValue(playerTeamId(team.id) && text(team.name) && playerYear(year) && Number.isFinite(Date.parse(checkedAt)));
  const statRows = array(stats, 50_000);
  const out: PlayerPack = { v: 1, basis: "regular", leaderProjection: projectPackLeaders(team, year, statRows, checkedAt), team, year, checkedAt, scheduleComplete: false, people: {}, games: [], witnesses: {} };
  for (const raw of statRows) {
    const r = obj(raw); requireValue(r.team === team.name && r.season === year);
    if (!category(r.category) || !field(r.category, String(r.statType))) continue;
    const pid = id(r.playerId); if (!playerId(pid)) continue; // Negative Team rows are never people.
    requireValue(text(r.player)); const p = person(out.people, pid, r.player, text(r.position, 30) ? r.position : null);
    add(p.stats, r.category, String(r.statType), r.stat);
  }
  const sourceGames = new Map<string, Record<string, unknown>>();
  for (const raw of array(schedule, 30)) {
    const r = obj(raw); requireValue(r.season === year && r.seasonType === "regular");
    const game = teamGame(r); requireValue(game.teams.some(t => t.id === team.id && t.name === team.name) && !sourceGames.has(game.id));
    sourceGames.set(game.id, r); out.games.push({ game, players: {}, boxSupplied: false });
  }
  const seen = new Set<string>(); let rowCount = 0;
  for (const raw of array(boxes, 30)) {
    const r = obj(raw), gid = id(r.id), scheduleRow = sourceGames.get(gid), entry = out.games.find(g => g.game.id === gid);
    requireValue(scheduleRow && entry && !seen.has(gid)); seen.add(gid); entry.boxSupplied = true;
    const sides = new Set<string>();
    for (const rawTeam of array(r.teams, 2)) {
      const t = obj(rawTeam), side = t.homeAway;
      requireValue((side === "home" || side === "away") && !sides.has(side)); sides.add(side);
      requireValue(t.team === scheduleRow[side + "Team"] && t.points === scheduleRow[side + "Points"]);
      const canonical = { id: id(scheduleRow[side + "Id"]), name: String(t.team) };
      const witness = out.witnesses[canonical.id] ??= { team: canonical, classification: text(scheduleRow[side + "Classification"], 20) ? scheduleRow[side + "Classification"] as string : null, people: {}, gameIds: [], gamePeople: {} };
      if (!witness.gameIds.includes(gid)) witness.gameIds.push(gid);
      for (const rawCategory of array(t.categories, 50)) {
        const c = obj(rawCategory); if (!category(c.name)) continue;
        for (const rawType of array(c.types, 80)) {
          const typ = obj(rawType); requireValue(text(typ.name, 40));
          for (const rawAthlete of array(typ.athletes, 300)) {
            requireValue(++rowCount <= 150_000); const a = obj(rawAthlete), pid = id(a.id); if (!playerId(pid)) continue;
            requireValue(text(a.name) && (!witness.people[pid] || witness.people[pid] === a.name)); witness.people[pid] = a.name; (witness.gamePeople[gid] ??= {})[pid] = a.name;
            if (canonical.id !== team.id) continue;
            person(out.people, pid, a.name, null);
            const values = entry.players[pid] ??= {};
            if (typ.name === "C/ATT" && c.name === "passing") {
              const pair = typeof a.stat === "string" ? /^(\d{1,4})\/(\d{1,4})$/.exec(a.stat) : null;
              add(values, "passing", "COMPLETIONS", pair?.[1]); add(values, "passing", "ATT", pair?.[2]);
            } else {
              const key = typ.name === "AVG" ? { passing: "YPA", rushing: "YPC", receiving: "YPR" }[c.name] : typ.name;
              if (field(c.name, key)) add(values, c.name, key, a.stat);
            }
          }
        }
      }
    }
    requireValue(sides.size === 2);
  }
  // Empty is valid only when the source also supplies no season stat rows.
  // Totals with no usable schedule cannot rule out a protected contribution.
  out.scheduleComplete = out.games.length > 0 || statRows.length === 0;
  out.games.sort((a, b) => a.game.date.localeCompare(b.game.date) || a.game.id.localeCompare(b.game.id));
  return out;
}
export function createPlayerIdentity(raw: unknown, pid: string, name: string, anchor: CanonicalTeam, anchorYear: number, checkedAt: string): PlayerIdentity {
  const selected = array(raw, 100).map(obj).filter(r => r.id === pid); requireValue(selected.length === 1);
  const r = selected[0]; requireValue(r.name === name && text(r.team) && playerYear(r.activeStartYear) && playerYear(r.activeEndYear) && r.activeStartYear <= r.activeEndYear);
  const stints = array(r.teamStints, 30).map(raw => { const s = obj(raw); requireValue(text(s.team) && playerYear(s.startYear) && playerYear(s.endYear) && s.startYear <= s.endYear); return { team: s.team, start: s.startYear, end: s.endYear }; });
  requireValue(stints.some(s => s.team === anchor.name && s.start <= anchorYear && s.end >= anchorYear));
  return { id: pid, name, position: text(r.position, 30) ? r.position : null, currentTeam: r.team, start: r.activeStartYear, end: r.activeEndYear, stints, checkedAt };
}
export function playerFromPack(pack: PlayerPack, pid: string, identity: PlayerIdentity | null, stale: boolean, catalog: CanonicalTeam[], anchorYear = pack.year, anchorTeam = pack.team.id): PlayerSeason {
  const p = pack.people[pid]; requireValue(p);
  const choices = identity ? Array.from({ length: identity.end - identity.start + 1 }, (_, i) => identity.end - i).map(year => ({ year, teams: [...new Set(identity.stints.filter(s => s.start <= year && s.end >= year).map(s => s.team))] })).filter(c => c.teams.length) : [{ year: pack.year, teams: [pack.team.name] }];
  const current = identity ? catalog.find(t => t.name === identity.currentTeam) ?? (identity.currentTeam === pack.team.name ? pack.team : null) : null;
  return { v: 1, id: pid, anchor: { team: anchorTeam, year: anchorYear }, needsTeamChoice: false, name: p.name, position: p.position ?? identity?.position ?? null, year: pack.year, team: pack.team, currentTeam: current, basis: "regular", checkedAt: pack.checkedAt, stale, choices,
    totals: p.stats, totalsAvailable: Object.keys(p.stats).length > 0, logs: pack.games.map(g => ({ game: g.game, stats: g.players[pid] ?? {}, boxSupplied: g.boxSupplied })), scheduleComplete: pack.scheduleComplete === true, historyAvailable: !!identity };
}

const PREFIX = "player:v1:", DAY = 86_400_000, HISTORY_TTL = 30 * DAY;
const budgetWrites = new WeakMap<LeadersKV, number>();
export type PlayerPacing = { monotonic: () => number; wait: (ms: number) => Promise<void> };
const defaultPacing: PlayerPacing = { monotonic: () => performance.now(), wait: ms => new Promise(resolve => setTimeout(resolve, ms)) };
const locks = new WeakMap<LeadersKV, Promise<unknown>>();
const inFlight = new WeakMap<LeadersKV, Map<string, Promise<unknown>>>();
const localBlocked = new WeakSet<LeadersKV>();
export class PlayerFailure extends Error { constructor(readonly status: 400 | 404 | 503, readonly reason: string) { super(reason); } }
function failure(reason = "unavailable"): never { throw new PlayerFailure(503, reason); }
async function stored<T>(kv: LeadersKV, key: string, max = 4_000_000): Promise<T | null> {
  const raw = await kv.get(key); if (raw === null) return null;
  if (raw.length > max) return failure("storage");
  try { return JSON.parse(raw) as T; } catch { return failure("storage"); }
}
async function putVerified(kv: LeadersKV, key: string, value: unknown) {
  const raw = JSON.stringify(value); if (raw.length > 4_000_000) return failure("storage");
  await kv.put(key, raw); if (await kv.get(key) !== raw) return failure("storage");
}
async function serial<T>(kv: LeadersKV, run: () => Promise<T>): Promise<T> {
  const prior = locks.get(kv) ?? Promise.resolve();
  const next = prior.catch(() => {}).then(run); locks.set(kv, next.catch(() => {})); return next;
}
async function coalesce<T>(kv: LeadersKV, key: string, run: () => Promise<T>): Promise<T> {
  const map = inFlight.get(kv) ?? new Map(); inFlight.set(kv, map);
  if (map.has(key)) return map.get(key) as Promise<T>;
  const next = run(); map.set(key, next);
  try { return await next; } finally { map.delete(key); }
}
/** Operational KV pacing, not atomic global/account quota enforcement. Failures reserve the full cost. */
export async function admitPlayerReads(kv: LeadersKV, resource: string, count: number, ttl: number, now: number, pacing: PlayerPacing = defaultPacing) {
  return serial(kv, async () => {
    if (localBlocked.has(kv) || await cfbdBlocked(kv)) return failure("source-blocked");
    const attemptKey = PREFIX + "attempt:" + resource;
    const attempt = await stored<{ at: number }>(kv, attemptKey);
    if (attempt && (!Number.isFinite(attempt.at) || attempt.at > now || now - attempt.at < ttl)) return failure("refresh-delayed");
    const day = Math.floor(now / DAY), raw = await stored<{ days: { day: number; calls: number }[] }>(kv, PREFIX + "budget");
    if (raw && (!Array.isArray(raw.days) || raw.days.length > 32 || raw.days.some(d => !Number.isSafeInteger(d.day) || !Number.isSafeInteger(d.calls) || d.calls < 0 || d.calls > 400 || d.day > day) || new Set(raw.days.map(d => d.day)).size !== raw.days.length)) return failure("storage");
    const days = (raw?.days ?? []).filter(d => d.day >= day - 31), today = days.find(d => d.day === day) ?? { day, calls: 0 };
    if (today.calls + count > 24 || days.reduce((sum, d) => sum + d.calls, 0) + count > 400) return failure("source-budget");
    if (!days.includes(today)) days.push(today); today.calls += count;
    // Both durable reservations and read-back must succeed BEFORE source egress.
    // KV permits one write/second to one key. Serialize and pace our shared
    // ledger in this isolate; concurrent other isolates remain best effort.
    const previous = budgetWrites.get(kv);
    if (previous !== undefined) {
      const wait = 1010 - (pacing.monotonic() - previous);
      if (wait > 0) await pacing.wait(Math.min(1010, wait));
    }
    budgetWrites.set(kv, pacing.monotonic());
    await putVerified(kv, PREFIX + "budget", { days });
    await putVerified(kv, attemptKey, { at: now });
  });
}
function rejectKeyEcho(value: unknown, key: string) {
  if (typeof value === "string") { if (key && value.toLowerCase().includes(key.toLowerCase())) throw new Error("source-echo"); }
  else if (Array.isArray(value)) value.forEach(v => rejectKeyEcho(v, key));
  else if (value && typeof value === "object") Object.entries(value).forEach(([k, v]) => { rejectKeyEcho(k, key); rejectKeyEcho(v, key); });
}
export function createPlayerSeasonService(env: LeadersEnv, fetcher: typeof fetch = fetch, now = Date.now, pacing: PlayerPacing = defaultPacing) {
  const kv = env.SEASON_LEADERS_KV;
  async function source(path: string) {
    if (!kv || !env.CFBD_API_KEY) return failure("configuration");
    if (localBlocked.has(kv) || await cfbdBlocked(kv)) return failure("source-blocked");
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new SourceFailure("source-aborted")); }, 15_000); });
    try {
      const value = await Promise.race([sourceJson("https://api.collegefootballdata.com" + path, env.CFBD_API_KEY, fetcher, controller.signal), expired]);
      rejectKeyEcho(value, env.CFBD_API_KEY); return value;
    } catch (error) {
      if (error instanceof SourceFailure && error.blocked) {
        localBlocked.add(kv); await blockCfbd(kv, new Date(now()).toISOString());
      }
      throw error;
    } finally { clearTimeout(timer); }
  }
  async function catalog(): Promise<CanonicalTeam[]> {
    if (!kv) return failure("configuration");
    const snapshot = await stored<Record<string, unknown>>(kv, SNAPSHOT_KEY, 600_000), teams = obj(snapshot?.teams);
    if (snapshot?.v !== 1 || snapshot.year !== PLAYER_YEAR) return failure("membership-unavailable");
    const values = Object.entries(teams).map(([tid, raw]) => { const r = obj(raw); requireValue(playerTeamId(tid) && r.id === tid && text(r.school)); return { id: tid, name: r.school }; });
    requireValue(values.length >= 1 && values.length <= 300 && new Set(values.map(t => t.name)).size === values.length); return values;
  }
  async function pack(team: CanonicalTeam, year: number): Promise<{ value: PlayerPack; stale: boolean }> {
    if (!kv) return failure("configuration");
    const resource = `pack:${team.id}:${year}`, key = PREFIX + resource, ttl = year === PLAYER_YEAR ? DAY : HISTORY_TTL;
    return coalesce(kv, resource, async () => {
      const old = await stored<PlayerPack>(kv, key), age = old ? now() - Date.parse(old.checkedAt) : Infinity;
      if (old && (old.v !== 1 || old.team.id !== team.id || old.team.name !== team.name || old.year !== year || !Number.isFinite(age) || age < 0)) return failure("storage");
      if (old && age < ttl) return { value: old, stale: false };
      try {
        await admitPlayerReads(kv, resource, 3, ttl, now(), pacing);
        const query = new URLSearchParams({ year: String(year), team: team.name, seasonType: "regular" });
        const stats = await source(`/stats/player/season?${query}`), games = await source(`/games?${query}`), boxes = await source(`/games/players?${query}`);
        const value = createPlayerPack(team, year, stats, games, boxes, new Date(now()).toISOString());
        await putVerified(kv, key, value); return { value, stale: false };
      } catch (error) { if (old && age <= (year === PLAYER_YEAR ? 30 * DAY : 365 * DAY)) return { value: old, stale: true }; throw error; }
    });
  }
  async function identity(pid: string, person: Person, anchor: CanonicalTeam, year: number) {
    if (!kv) return failure("configuration");
    const key = PREFIX + `identity:${pid}`;
    return coalesce<PlayerIdentity>(kv, key, async () => {
      const old = await stored<PlayerIdentity>(kv, key, 50_000);
      if (old && old.id === pid && old.name === person.name && Number.isFinite(Date.parse(old.checkedAt)) && now() - Date.parse(old.checkedAt) >= 0 && now() - Date.parse(old.checkedAt) < HISTORY_TTL && old.stints.some(s => s.team === anchor.name && s.start <= year && s.end >= year)) return old;
      await admitPlayerReads(kv, `identity:${pid}`, 1, DAY, now(), pacing);
      const raw = await source(`/player/search?${new URLSearchParams({ searchTerm: person.name })}`);
      const value = createPlayerIdentity(raw, pid, person.name, anchor, year, new Date(now()).toISOString());
      await putVerified(kv, key, value); return value;
    });
  }
  return { async get(request: PlayerRequest): Promise<{ status: number; season?: PlayerSeason; error?: string }> {
    try {
      if (!playerId(request.id) || !playerTeamId(request.team) || !playerYear(request.year) || !playerYear(request.anchorYear)) throw new PlayerFailure(400, "invalid");
      if (!kv || !env.CFBD_API_KEY) return failure("configuration");
      const teams = await catalog();
      let anchor = teams.find(t => t.id === request.team);
      if (!anchor) {
        if (!request.witnessTeam || !request.witnessEvent) throw new PlayerFailure(400, "identity-context");
        const witnessTeam = teams.find(t => t.id === request.witnessTeam);
        if (!witnessTeam) throw new PlayerFailure(400, "identity-context");
        const owned = await pack(witnessTeam, request.anchorYear), proof = owned.value.witnesses[request.team];
        if (!proof || !proof.gameIds.includes(request.witnessEvent) || !proof.gamePeople[request.witnessEvent]?.[request.id]) throw new PlayerFailure(404, "identity-context");
        anchor = proof.team;
      }
      const anchorPack = await pack(anchor, request.anchorYear), person = anchorPack.value.people[request.id];
      if (!person) throw new PlayerFailure(404, "player-not-supplied");
      let info: PlayerIdentity | null = null;
      try { info = await identity(request.id, person, anchor, request.anchorYear); }
      catch (error) { if (request.year !== request.anchorYear || request.stintTeam) throw error; }
      const choices = info ? [...new Set(info.stints.filter(s => s.start <= request.year && s.end >= request.year).map(s => s.team))] : [anchor.name];
      if (!choices.length) throw new PlayerFailure(404, "season-not-listed");
      if (request.stintTeam && !choices.includes(request.stintTeam)) throw new PlayerFailure(400, "season-team");
      if (choices.length > 1 && !request.stintTeam) {
        const base = playerFromPack(anchorPack.value, request.id, info, anchorPack.stale, teams, request.anchorYear, request.team);
        return { status: 200, season: { ...base, year: request.year, needsTeamChoice: true, team: null, totals: {}, logs: [], scheduleComplete: false, totalsAvailable: false } };
      }
      const name = request.stintTeam ?? choices[0];
      let selected = name === anchor.name ? anchor : teams.find(t => t.name === name);
      // A source-listed historical non-FBS name is trusted metadata, but its ID
      // must be established from a fixed selected-season schedule, not guessed.
      if (!selected) {
        const alias = await stored<CanonicalTeam>(kv, PREFIX + `team-name:${name}`, 2000);
        if (alias && alias.name === name && playerTeamId(alias.id)) selected = alias;
      }
      if (!selected) {
        const resource = `team:${request.id}:${request.year}:${name}`;
        await admitPlayerReads(kv, resource, 3, HISTORY_TTL, now(), pacing);
        const query = new URLSearchParams({ year: String(request.year), team: name, seasonType: "regular" });
        const stats = await source(`/stats/player/season?${query}`), games = await source(`/games?${query}`), boxes = await source(`/games/players?${query}`);
        const sides = array(games, 30).flatMap(raw => { const r = obj(raw); return ["away", "home"].filter(s => r[s + "Team"] === name).map(s => id(r[s + "Id"])); });
        requireValue(sides.length && new Set(sides).size === 1 && playerTeamId(sides[0])); selected = { id: sides[0], name };
        const value = createPlayerPack(selected, request.year, stats, games, boxes, new Date(now()).toISOString());
        await putVerified(kv, PREFIX + `pack:${selected.id}:${request.year}`, value);
        await putVerified(kv, PREFIX + `team-name:${name}`, selected);
        const season = playerFromPack(value, request.id, info, false, teams, request.anchorYear, request.team); return { status: 200, season };
      }
      const chosen = selected.id === anchor.id && request.year === request.anchorYear ? anchorPack : await pack(selected, request.year);
      if (!chosen.value.people[request.id]) {
        // Preserve verified identity/year even when that year supplies no player rows.
        const base = playerFromPack(anchorPack.value, request.id, info, anchorPack.stale, teams, request.anchorYear, request.team);
        return { status: 200, season: { ...base, year: request.year, team: selected, totals: {}, totalsAvailable: false, checkedAt: chosen.value.checkedAt, stale: chosen.stale, scheduleComplete: chosen.value.scheduleComplete === true, logs: chosen.value.games.map(g => ({ game: g.game, stats: {}, boxSupplied: g.boxSupplied })) } };
      }
      return { status: 200, season: playerFromPack(chosen.value, request.id, info, chosen.stale, teams, request.anchorYear, request.team) };
    } catch (error) { return error instanceof PlayerFailure ? { status: error.status, error: error.reason } : { status: 503, error: "player-unavailable" }; }
  } };
}
