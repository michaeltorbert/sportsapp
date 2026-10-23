import type { SeasonLeaders } from "./team-season";
import { normalizeScoreboard } from "./espn-data";
import { easternDate } from "./football";
import { validEventId } from "./game-stats";
import { RECORD_FORMAT, seasonTtl, STAT_FORMAT, TEAM_SEASON_MAX_GAMES, TEAM_SEASON_WORKER_BUDGET_MS, TEAM_STAT_ROWS, type ScheduleEntry, type ScheduleSection, type StatPair, type TeamSeason, type TeamStatKey } from "./team-season";

const TEAMS = "https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams/";
/** The team's schedule: with no season, the source's current one; otherwise that year and season type. */
export function teamScheduleUrl(teamId: string, season?: { year: number; type: 2 | 3 }) {
  const url = new URL(`${TEAMS}${encodeURIComponent(teamId)}/schedule`);
  if (season) { url.searchParams.set("season", String(season.year)); url.searchParams.set("seasontype", String(season.type)); }
  return url.toString();
}
export function teamStatsUrl(teamId: string, year: number) {
  const url = new URL(`${TEAMS}${encodeURIComponent(teamId)}/statistics`);
  url.searchParams.set("season", String(year)); url.searchParams.set("seasontype", "2");
  return url.toString();
}

type Raw = { [key: string]: unknown };
function object(value: unknown): Raw { return value && typeof value === "object" && !Array.isArray(value) ? value as Raw : {}; }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function idOf(value: unknown) { const id = typeof value === "number" && Number.isInteger(value) ? String(value) : value; return typeof id === "string" && /^\d{1,12}$/.test(id) ? id : null; }
function text(value: unknown, max = 64) { if (typeof value !== "string") return null; const t = value.trim(); return t && t.length <= max ? t : null; }
function integer(value: unknown) { const n = typeof value === "string" && /^\d{1,4}$/.test(value) ? Number(value) : value; return typeof n === "number" && Number.isInteger(n) ? n : null; }
export class TeamSeasonSourceError extends Error {}

/** The source's active season. Its requested season, when supplied, must be the same one. */
export function activeSeason(raw: unknown, teamId: string) {
  const body = object(raw), season = object(body.season), requested = body.requestedSeason === undefined ? null : object(body.requestedSeason);
  if (idOf(object(body.team).id) !== teamId) throw new TeamSeasonSourceError("schedule team identity");
  const year = integer(season.year), type = integer(season.type);
  if (year === null || year < 2000 || year > 2100 || type === null) throw new TeamSeasonSourceError("active season missing");
  if (requested && (integer(requested.year) !== year || integer(requested.type) !== type)) throw new TeamSeasonSourceError("requested season differs from the active season");
  return { year, type };
}
export function overallRecord(raw: unknown) { const summary = text(object(object(raw).team).recordSummary, 12); return summary && RECORD_FORMAT.test(summary) ? summary : null; }

function scalarScore(value: unknown) {
  if (value === null || value === undefined) return null;
  const raw = typeof value === "object" ? object(value).displayValue ?? object(value).value : value;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  return typeof raw === "string" && /^\d{1,3}$/.test(raw.trim()) ? raw.trim() : null;
}
function defaultLogo(team: Raw) {
  const logo = array(team.logos).map(object).find(item => array(item.rel).includes("default"));
  return typeof logo?.href === "string" ? logo.href : undefined;
}

/**
 * One published schedule section. Every event must belong to the team and to exactly the requested
 * year and season type, with two distinct sides; any doubt makes the whole section unavailable, never
 * silently shorter. Accepted events are adapted to the scoreboard shape and read by the existing
 * scoreboard normalizer unchanged, which must return each of them.
 */
export function scheduleSection(raw: unknown, teamId: string, year: number, type: 2 | 3, checkedAt: string): ScheduleSection {
  try {
    const body = object(raw), events = body.events;
    if (idOf(object(body.team).id) !== teamId || !Array.isArray(events) || events.length > TEAM_SEASON_MAX_GAMES) throw new TeamSeasonSourceError("schedule envelope");
    const requested = body.requestedSeason === undefined ? null : object(body.requestedSeason);
    if (requested && (integer(requested.year) !== year || integer(requested.type) !== type)) throw new TeamSeasonSourceError("requested season");
    // Without the requested season, only an empty list can be accepted: nothing to misattribute.
    if (!requested && events.length) throw new TeamSeasonSourceError("unverifiable season");
    if (!events.length) return { status: "complete", entries: [] };
    const adapted: Raw[] = [], opponents = new Map<string, { id: string; name: string }>(), days: string[] = [];
    for (const item of events) {
      const event = object(item), id = event.id, competition = object(array(event.competitions)[0]);
      if (!validEventId(id) || opponents.has(id)) throw new TeamSeasonSourceError("event identity");
      if (integer(object(event.season).year) !== year || integer(object(event.seasonType).type) !== type) throw new TeamSeasonSourceError("event season");
      const sides = array(competition.competitors).map(object);
      const ids = sides.map(side => idOf(object(side.team).id)), homeAway = sides.map(side => side.homeAway);
      if (sides.length !== 2 || ids.includes(null) || ids[0] === ids[1] || !ids.includes(teamId) || !homeAway.includes("home") || !homeAway.includes("away")) throw new TeamSeasonSourceError("event sides");
      const date = typeof competition.date === "string" ? competition.date : event.date;
      if (typeof date !== "string" || !Number.isFinite(Date.parse(date))) throw new TeamSeasonSourceError("event date");
      days.push(easternDate(new Date(date)));
      const opponent = sides[ids.indexOf(teamId) === 0 ? 1 : 0], opponentTeam = object(opponent.team);
      const name = text(opponentTeam.displayName) ?? text(opponentTeam.shortDisplayName);
      if (!name) throw new TeamSeasonSourceError("opponent name");
      opponents.set(id, { id: idOf(opponentTeam.id)!, name });
      // An unconfirmed time stays unconfirmed: either level reporting it invalid wins.
      const timeValid = event.timeValid === false || competition.timeValid === false ? false : true;
      const broadcasts = array(competition.broadcasts).map(item => text(object(object(item).media).shortName, 40)).filter((name): name is string => !!name);
      adapted.push({
        id, date,
        competitions: [{
          date, timeValid, neutralSite: competition.neutralSite, status: competition.status ?? event.status, broadcasts: [{ names: broadcasts }],
          competitors: sides.map((side, i) => {
            const team = object(side.team);
            return { id: ids[i], homeAway: side.homeAway, score: scalarScore(side.score), team: { id: ids[i], shortDisplayName: text(team.shortDisplayName) ?? undefined, displayName: text(team.displayName) ?? undefined, location: text(team.location) ?? undefined, abbreviation: text(team.abbreviation, 16) ?? undefined, logo: defaultLogo(team) } };
          }),
        }],
      });
    }
    days.sort();
    const board = normalizeScoreboard({ events: adapted }, days[0], checkedAt, days.at(-1));
    if (board.warnings?.length || board.games.length !== events.length) throw new TeamSeasonSourceError("schedule events unreadable");
    const list: ScheduleEntry[] = board.games.map(game => ({ game, opponent: opponents.get(game.id)!, seasonType: type }));
    list.sort((a, b) => Date.parse(a.game.date) - Date.parse(b.game.date) || a.game.id.localeCompare(b.game.id));
    return { status: "complete", entries: list };
  } catch (error) {
    console.error(JSON.stringify({ event: "team_schedule_unavailable", teamId, year, type, error: error instanceof Error ? error.message : String(error) }));
    return { status: "unavailable" };
  }
}

// One value by category and stat name. A repeated name agrees with itself or is ambiguous.
function statValue(categories: unknown, category: string, name: string) {
  const matches = array(categories).map(object).filter(c => c.name === category);
  if (matches.length !== 1) return null;
  const values = new Set(array(matches[0].stats).map(object).filter(stat => stat.name === name).map(stat => { const t = text(stat.displayValue, 16); return t && STAT_FORMAT.test(t) ? t : null; }));
  return values.size === 1 ? [...values][0] : null;
}
/** The four regular-season per-game pairs, after identity checks. Missing values stay missing. */
export function seasonStats(raw: unknown, teamId: string, year: number): Record<TeamStatKey, StatPair> | null {
  const body = object(raw), requested = object(body.requestedSeason), results = object(body.results);
  if (idOf(object(body.team).id) !== teamId || integer(requested.year) !== year || integer(requested.type) !== 2) return null;
  const own = object(results.stats).categories, opponent = results.opponent;
  const rows = Object.fromEntries(TEAM_STAT_ROWS.map(([key, , category, name]) => [key, [statValue(own, category, name), statValue(opponent, category, name)]])) as Record<TeamStatKey, StatPair>;
  return Object.values(rows).some(([a, b]) => a !== null || b !== null) ? rows : null;
}

export type TeamSeasonResult = { status: 200; season: TeamSeason } | { status: 502 | 503; error: string; retryAfter: number };
type Entry = { season: TeamSeason; expires: number };
const MAX_BYTES = 2_000_000, CACHE_LIMIT = 16, MAX_ACTIVE = 2, STALE_LIMIT_MS = 1_800_000;

/**
 * Per-isolate team-season service. Only completed normalized seasons are shared across requests;
 * each miss runs its own reads under one deadline (discovery, then the remaining reads in parallel).
 * A refresh failure may return the last completed season for that team, marked stale.
 */
export function createTeamSeasonService(fetcher: typeof fetch = fetch, now = () => Date.now(), leaderReader: (teamId: string, year: number, name: string, shortName: string) => Promise<SeasonLeaders | null> = async () => null) {
  const cache = new Map<string, Entry>();
  let active = 0;
  async function json(url: string, signal: AbortSignal) {
    const response = await fetcher(url, { headers: { Accept: "application/json" }, signal });
    if (!response.ok) throw new TeamSeasonSourceError(`ESPN status ${response.status}`);
    const length = Number(response.headers.get("content-length"));
    if (Number.isFinite(length) && length > MAX_BYTES) throw new TeamSeasonSourceError("response too large");
    const body = await response.text();
    if (body.length > MAX_BYTES) throw new TeamSeasonSourceError("response too large");
    return JSON.parse(body) as unknown;
  }
  function stale(teamId: string) {
    const cached = cache.get(teamId);
    return cached && now() - Date.parse(cached.season.checkedAt) < STALE_LIMIT_MS ? { ...cached.season, stale: true } : null;
  }
  async function getBase(teamId: string): Promise<TeamSeasonResult> {
    const cached = cache.get(teamId);
    if (cached && cached.expires > now()) { cache.delete(teamId); cache.set(teamId, cached); return { status: 200, season: cached.season }; }
    if (active >= MAX_ACTIVE) { const old = stale(teamId); return old ? { status: 200, season: old } : { status: 503, error: "Team seasons are busy. Please retry.", retryAfter: 5 }; }
    active++;
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), TEAM_SEASON_WORKER_BUDGET_MS);
    try {
      const discovery = await json(teamScheduleUrl(teamId), controller.signal);
      const checkedAt = new Date(now()).toISOString();
      const { year, type } = activeSeason(discovery, teamId);
      const settled = (promise: Promise<unknown>) => promise.then(value => ({ ok: true as const, value }), () => ({ ok: false as const }));
      // The current answer doubles as the regular season only when that is what it reports.
      const [regular, postseason, stats] = await Promise.all([
        type === 2 ? Promise.resolve({ ok: true as const, value: discovery }) : settled(json(teamScheduleUrl(teamId, { year, type: 2 }), controller.signal)),
        settled(json(teamScheduleUrl(teamId, { year, type: 3 }), controller.signal)),
        settled(json(teamStatsUrl(teamId, year), controller.signal)),
      ]);
      if (controller.signal.aborted) throw new TeamSeasonSourceError("team season deadline expired");
      const body = object(discovery), team = object(body.team);
      const name = text(team.displayName), shortName = text(team.location, 48) ?? text(team.shortDisplayName, 48) ?? name;
      if (!name || !shortName) throw new TeamSeasonSourceError("team name");
      const season: TeamSeason = {
        v: 1, team: { id: teamId, name, shortName, abbreviation: text(team.abbreviation, 16) ?? "", logo: typeof team.logo === "string" && /^https:\/\/[a-z0-9.-]+\.espncdn\.com\//.test(team.logo) && team.logo.length <= 300 ? team.logo : null },
        season: { year }, record: overallRecord(discovery),
        stats: stats.ok ? seasonStats(stats.value, teamId, year) : null,
        regular: regular.ok ? scheduleSection(regular.value, teamId, year, 2, checkedAt) : { status: "unavailable" },
        postseason: postseason.ok ? scheduleSection(postseason.value, teamId, year, 3, checkedAt) : { status: "unavailable" },
        checkedAt,
      };
      // Event IDs are unique across both sections, or neither can be trusted.
      const ids = [...(season.regular.status === "complete" ? season.regular.entries : []), ...(season.postseason.status === "complete" ? season.postseason.entries : [])].map(entry => entry.game.id);
      if (new Set(ids).size !== ids.length) { season.regular = { status: "unavailable" }; season.postseason = { status: "unavailable" }; }
      cache.delete(teamId);
      cache.set(teamId, { season, expires: now() + seasonTtl(season) });
      while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
      return { status: 200, season };
    } catch (error) {
      console.error(JSON.stringify({ event: "team_season_failed", teamId, error: error instanceof Error ? error.message : String(error) }));
      const old = stale(teamId);
      return old ? { status: 200, season: old } : { status: 502, error: "This team's season is temporarily unavailable. Please retry.", retryAfter: 30 };
    } finally {
      clearTimeout(timeout);
      active--;
    }
  }
  async function get(teamId: string): Promise<TeamSeasonResult> {
    const deadlineAt = performance.now() + TEAM_SEASON_WORKER_BUDGET_MS;
    const result = await getBase(teamId);
    if (result.status !== 200) return result;
    const { season } = result;
    let leaders: SeasonLeaders | null = null;
    const allowance = Math.min(3000, Math.max(0, deadlineAt - performance.now()));
    if (allowance > 0) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        // KV reads have no abort API. A detached optional result cannot hold the base answer
        // or mutate it after the original root deadline (including noncooperative readers).
        leaders = await Promise.race([
          leaderReader(teamId, season.season.year, season.team.name, season.team.shortName),
          new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), allowance); }),
        ]);
      } catch { /* Optional KV failure preserves the base season. */ }
      finally { if (timer !== undefined) clearTimeout(timer); }
    }
    return { status: 200, season: { ...season, leaders } };
  }
  return { get, size: () => cache.size };
}
