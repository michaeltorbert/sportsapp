import { parsePregameLine } from "./pregame-lines";
import { z } from "zod";
import { easternDate, shiftDate, type Game, type Scoreboard, type Team } from "./football";

const numberLike = z.union([z.string(), z.number()]);
const statusSchema = z.object({ period: z.number().optional(), clock: z.number().optional(), type: z.object({ name: z.string(), state: z.string(), completed: z.boolean().optional(), shortDetail: z.string().optional(), detail: z.string().optional(), description: z.string().optional() }) });
const competitorSchema = z.object({ id: z.string(), homeAway: z.string(), score: numberLike.nullish(), curatedRank: z.object({ current: z.number().optional() }).optional(), team: z.object({ id: z.string(), shortDisplayName: z.string().optional(), displayName: z.string().optional(), location: z.string().optional(), abbreviation: z.string().optional(), logo: z.string().optional(), conferenceId: numberLike.optional() }), records: z.array(z.object({ type: z.string().optional(), name: z.string().optional(), summary: z.string().optional() })).optional() });
const eventSchema = z.object({ id: z.string(), date: z.string(), status: statusSchema.optional(), links: z.array(z.object({ rel: z.array(z.string()).optional(), href: z.string() })).optional(), competitions: z.array(z.object({ date: z.string().optional(), timeValid: z.boolean().optional(), odds: z.unknown().optional(), status: statusSchema.optional(), competitors: z.array(competitorSchema), broadcasts: z.array(z.object({ names: z.array(z.string()).optional() })).optional(), broadcast: z.string().optional(), situation: z.object({ possession: numberLike.optional(), downDistanceText: z.string().optional(), isRedZone: z.boolean().optional() }).optional() })) });

function score(value: string | number | null | undefined) { if (value === null || value === undefined || value === "") return null; const n = Number(value); return Number.isFinite(n) && n >= 0 ? n : null; }
function espnLink(value: string | undefined, fallback: string) { try { const u = new URL(value || ""); return u.protocol === "https:" && (u.hostname === "espn.com" || u.hostname.endsWith(".espn.com")) ? u.href : fallback; } catch { return fallback; } }
function logoLink(value: string | undefined) { try { const u = new URL(value || ""); return u.protocol === "https:" && u.hostname.endsWith(".espncdn.com") ? u.href : null; } catch { return null; } }
function team(c: z.infer<typeof competitorSchema>): Team { const rank = c.curatedRank?.current; return { id: c.team.id, name: c.team.shortDisplayName || c.team.location || c.team.displayName || c.team.abbreviation || "Team", abbreviation: c.team.abbreviation || "", logo: logoLink(c.team.logo), conferenceId: c.team.conferenceId === undefined ? null : String(c.team.conferenceId), score: score(c.score), rank: rank && rank >= 1 && rank <= 25 ? rank : null, rankKnown: typeof rank === "number" && rank >= 1, record: c.records?.find(r => r.type === "total" || r.name === "overall")?.summary || "" }; }

const eventsEnvelopeSchema = z.object({ events: z.array(z.unknown()) });
function eventsEnvelope(raw: unknown) {
  const direct = eventsEnvelopeSchema.safeParse(raw);
  if (direct.success) return direct.data;
  return z.object({ content: z.object({ sbData: eventsEnvelopeSchema }) }).parse(raw).content.sbData;
}

export function normalizeScoreboard(raw: unknown, date: string, fetchedAt = new Date().toISOString(), endDate = date): Scoreboard {
  const envelope = eventsEnvelope(raw);
  const games = new Map<string, Game>(); let unreadable = 0;
  for (const item of envelope.events) {
    const parsed = eventSchema.safeParse(item);
    if (!parsed.success) { unreadable++; continue; }
    const e = parsed.data, c = e.competitions[0], s = c?.status || e.status;
    if (!c || !s || c.competitors.length !== 2) { unreadable++; continue; }
    const away = c.competitors.find(t => t.homeAway === "away"), home = c.competitors.find(t => t.homeAway === "home");
    const gameDate = c.date || e.date;
    if (!away || !home || !Number.isFinite(Date.parse(gameDate))) { unreadable++; continue; }
    const etDate = easternDate(new Date(gameDate));
    if (etDate < date || etDate > endDate) continue;
    const statusName = s.type.name;
    const state: Game["state"] = /CANCELED|CANCELLED|POSTPONED|NO_CONTEST|FORFEIT/.test(statusName) ? "other" : /DELAYED|SUSPENDED|INTERRUPTED/.test(statusName) ? "delayed" : s.type.completed || s.type.state === "post" ? "final" : s.type.state === "in" ? "live" : "upcoming";
    const teams: [Team, Team] = [team(away), team(home)];
    const clockKnown = typeof s.clock === "number" && Number.isFinite(s.clock) && s.clock >= 0 && s.clock <= 900;
    const intermission = /HALFTIME|END_PERIOD/.test(statusName);
    const started = (s.period || 0) > 0 || teams.some(t => (t.score || 0) > 0) || state === "final";
    games.set(e.id, { id: e.id, date: gameDate, timeValid: c.timeValid !== false, state, started, pregameLine: !started && (state === "upcoming" || state === "delayed") ? parsePregameLine(c.odds, teams[0].id, teams[1].id) : undefined, clockKnown, intermission, status: s.type.shortDetail || s.type.detail || s.type.description || "Status unavailable", period: s.period || 0, clock: s.clock || 0, teams, broadcast: [...new Set(c.broadcasts?.flatMap(b => b.names || []) || [])].join(" / ") || c.broadcast || "", possession: c.situation?.possession === undefined ? null : String(c.situation.possession), downDistance: c.situation?.downDistanceText || "", redZone: c.situation?.isRedZone === true, url: espnLink(e.links?.find(l => l.rel?.includes("summary"))?.href, `https://www.espn.com/college-football/game/_/gameId/${encodeURIComponent(e.id)}`) });
    const normalized = games.get(e.id)!;
    if (!started && (state === "upcoming" || state === "delayed") && c.odds != null && (!Array.isArray(c.odds) || c.odds.length > 0) && !normalized.pregameLine) normalized.pregameEvidenceInvalid = true;
  }
  if (envelope.events.length && unreadable === envelope.events.length) throw new Error("ESPN returned unreadable games");
  return { date, endDate, fetchedAt, games: [...games.values()], warnings: unreadable ? ["Some games could not be read from ESPN; the list may be incomplete."] : undefined };
}


export function scoreboardUrl(date: string, endDate = date, accOnly = false) {
  const url = new URL("https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard");
  // ESPN's range end is exclusive. Our app date windows are inclusive.
  // A Friday-Saturday request ending in Saturday returns only Friday's board.
  url.searchParams.set("dates", date.replaceAll("-", "") + (endDate !== date ? `-${shiftDate(endDate, 1).replaceAll("-", "")}` : ""));
  url.searchParams.set("groups", accOnly ? "1" : "80");
  // Oversized limits may silently fall back to 25. ESPN returns the full day with 200.
  url.searchParams.set("limit", "200");
  return url.toString();
}

export function scoreboardCdnUrl() {
  const url = new URL("https://cdn.espn.com/core/college-football/scoreboard");
  url.searchParams.set("xhr", "1");
  // The CDN endpoint uses singular `group`; plural `groups` silently returns
  // the default 25-game board instead of the complete FBS week.
  url.searchParams.set("group", "80");
  return url.toString();
}

// The CDN ignores `dates` and serves its selected football week. Only use it
// when its own calendar proves the entire requested Eastern-day range is covered.
export function normalizeCdnRange(raw: unknown, date: string, endDate = date, accOnly = false): Scoreboard {
  const entry = z.object({ value: z.string(), startDate: z.string().datetime({ offset: true }), endDate: z.string().datetime({ offset: true }) });
  const { content: { sbData } } = z.object({ content: z.object({ sbData: z.object({
    season: z.object({ type: z.number() }), week: z.object({ number: z.number() }),
    leagues: z.array(z.object({ calendar: z.array(z.object({ value: z.string(), entries: z.array(entry) })) })),
  }) }) }).parse(raw);
  const range = sbData.leagues[0]?.calendar.find(period => period.value === String(sbData.season.type))
    ?.entries.find(week => week.value === String(sbData.week.number));
  // Exclude boundary days conservatively: ESPN week boundaries are not ET midnight.
  if (!range || date <= easternDate(new Date(range.startDate)) || endDate >= easternDate(new Date(range.endDate)))
    throw new Error("CDN does not cover the requested dates");
  const board = normalizeScoreboard(raw, date, undefined, endDate);
  if (board.warnings?.length) throw new Error("CDN scoreboard is incomplete");
  if (accOnly) board.games = board.games.filter(game => game.teams.some(team => team.conferenceId === "1"));
  return board;
}
