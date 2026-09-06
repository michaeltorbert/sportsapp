import { z } from "zod";
import type { Game, PregameLine, Scoreboard } from "./football";
import { preferredConference, teamRank } from "./upset";

const teamId = z.union([z.string().min(1), z.number().int().nonnegative()]).transform(String);
const spread = z.union([z.number(), z.string().trim().regex(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/).transform(Number)]).pipe(z.number().finite());
const side = z.object({ favorite: z.boolean(), team: z.object({ id: teamId.optional() }).passthrough().optional(), teamId: teamId.optional() });
const oddsSchema = z.object({
  spread, homeTeamOdds: side, awayTeamOdds: side,
  provider: z.object({ id: z.union([z.string(), z.number()]).optional(), name: z.string().optional(), priority: z.number().finite().optional() }).optional(),
  isLive: z.boolean().optional(), live: z.boolean().optional(), type: z.string().optional(),
});

/** Only call with pre-kickoff scoreboard odds or the summary's pregame pickcenter. */
export function parsePregameLine(raw: unknown, awayId: string, homeId: string): PregameLine | undefined {
  if (!Array.isArray(raw)) return undefined;
  const lines: { line: PregameLine; priority: number; provider: string }[] = [];
  for (const item of raw) {
    const parsed = oddsSchema.safeParse(item);
    if (!parsed.success) continue;
    const o = parsed.data;
    if (o.isLive || o.live || o.type?.toLowerCase().includes("live")) continue;
    if ([o.homeTeamOdds, o.awayTeamOdds].some(t => t.team?.id && t.teamId && t.team.id !== t.teamId)) continue;
    if ((o.homeTeamOdds.team?.id || o.homeTeamOdds.teamId) !== homeId || (o.awayTeamOdds.team?.id || o.awayTeamOdds.teamId) !== awayId) continue;
    const home = o.homeTeamOdds.favorite, away = o.awayTeamOdds.favorite;
    const pickem = o.spread === 0 && !home && !away;
    if (!pickem && (home === away || (home ? o.spread >= 0 : o.spread <= 0))) continue;
    lines.push({ line: { favoriteId: pickem ? null : home ? homeId : awayId, spread: Math.abs(o.spread), source: o.provider?.name || "ESPN" }, priority: o.provider?.priority ?? Number.MAX_SAFE_INTEGER, provider: String(o.provider?.id ?? "") });
  }
  lines.sort((a, b) => a.priority - b.priority || a.provider.localeCompare(b.provider) || a.line.source.localeCompare(b.line.source) || a.line.spread - b.line.spread);
  // Conflicting equally preferred sources are not evidence of a settled favorite.
  const first = lines[0];
  if (!first || lines.some(x => x.priority === first.priority && x.line.favoriteId !== first.line.favoriteId)) return undefined;
  return first.line;
}

const summarySchema = z.object({
  header: z.object({ id: z.string(), competitions: z.array(z.object({ competitors: z.array(z.object({ homeAway: z.string(), team: z.object({ id: z.string() }) })) })) }),
  pickcenter: z.unknown().optional(),
});
export function summaryPregameLine(raw: unknown, game: Game) {
  const parsed = summarySchema.safeParse(raw);
  if (!parsed.success || parsed.data.header.id !== game.id) return undefined;
  const competitors = parsed.data.header.competitions[0]?.competitors;
  const [away, home] = game.teams;
  if (competitors?.length !== 2 || competitors.find(t => t.homeAway === "away")?.team.id !== away.id || competitors.find(t => t.homeAway === "home")?.team.id !== home.id) return undefined;
  return parsePregameLine(parsed.data.pickcenter, away.id, home.id);
}

type Cached = { line?: PregameLine; expires: number };
// Finished public results only: no in-flight promise is shared across requests.
type Attempt = { order: number; retryAfter: number };
type EnrichmentState = { cache: Map<string, Cached>; attempts: Map<string, Attempt>; sequence: number };
const states = new WeakMap<typeof fetch, EnrichmentState>();
function key(game: Game) { return `${game.id}:${game.date}:${game.teams.map(t => t.id).join(":")}`; }

/** Optional enrichment has a 1.5s total budget; failed odds never discard scores. */
export async function enrichPregameLines(board: Scoreboard, parent: AbortSignal, fetcher: typeof fetch = fetch): Promise<Scoreboard> {
  if (parent.aborted || board.stale) return board;
  const state = states.get(fetcher) || { cache: new Map<string, Cached>(), attempts: new Map<string, Attempt>(), sequence: 0 };
  states.set(fetcher, state);
  const { cache, attempts } = state;
  const candidates = board.games.filter(g => !g.pregameLine && (g.state === "live" || g.state === "final" || (g.state === "delayed" && g.started))
    && g.teams.some(t => preferredConference(t) || teamRank(t) !== null)
    && (attempts.get(key(g))?.retryAfter ?? 0) <= Date.now()
    && (!cache.has(key(g)) || cache.get(key(g))!.expires <= Date.now()))
    .sort((a, b) => Number(b.state === "live") - Number(a.state === "live")
      || (attempts.get(key(a))?.order ?? 0) - (attempts.get(key(b))?.order ?? 0) || a.id.localeCompare(b.id)).slice(0, 12);
  if (candidates.length) {
    const controller = new AbortController(), abort = () => controller.abort();
    parent.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, 1500);
    let index = 0;
    try {
      await Promise.all(Array.from({ length: Math.min(4, candidates.length) }, async () => {
        while (index < candidates.length && !controller.signal.aborted) {
          const game = candidates[index++];
          let failed = true;
          try {
            const response = await fetcher(`https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event=${encodeURIComponent(game.id)}`, { signal: controller.signal, mode: "cors", credentials: "omit", cache: "no-store" });
            if (!response.ok) continue;
            const line = summaryPregameLine(await response.json(), game);
            if (controller.signal.aborted) continue;
            failed = false;
            cache.set(key(game), { line, expires: Date.now() + (line ? 6 * 3600000 : 300000) });
            if (cache.size > 250) cache.delete(cache.keys().next().value!);
          } catch { /* Missing favorite evidence is allowed; score refresh still succeeds. */ }
          finally {
            // Operational retry order is separate from evidence that no line exists.
            // Let later games proceed after errors/deadlines, but not caller cancellation.
            if (!parent.aborted) {
              attempts.delete(key(game)); attempts.set(key(game), { order: ++state.sequence, retryAfter: failed ? Date.now() + 60000 : 0 });
              if (attempts.size > 250) attempts.delete(attempts.keys().next().value!);
            }
          }
        }
      }));
    } finally { clearTimeout(timer); parent.removeEventListener("abort", abort); }
  }
  return { ...board, games: board.games.map(game => {
    const cached = cache.get(key(game));
    return !game.pregameLine && cached?.line && cached.expires > Date.now() ? { ...game, pregameLine: cached.line } : game;
  }) };
}
