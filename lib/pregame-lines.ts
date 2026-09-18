import { z } from "zod";
import type { Game, PregameLine, Scoreboard } from "./football";
import { halftimeEpoch, halftimeKey, nextHalftimeGeneration, observeHalftime, observeHalftimeBoard, parseHalftime, type HalftimeObservation } from "./halftime";
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

export type PregameEvidence = { state: "absent" | "invalid" } | { state: "line" | "pickem"; line: PregameLine };
/** Alert-only evidence status; keep the existing display parser's API/behavior. */
export function classifyPregameEvidence(raw: unknown, awayId: string, homeId: string): PregameEvidence {
  if (raw == null) return { state: "absent" };
  if (!Array.isArray(raw)) return { state: "invalid" };
  const supplied: unknown[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return { state: "invalid" };
    if (!("spread" in item) || item.spread === undefined) {
      if (!oddsSchema.partial().extend({ overUnder: spread }).safeParse(item).success) return { state: "invalid" };
      continue; // A total-only market does not assert a point-spread favorite.
    }
    if (!parsePregameLine([item], awayId, homeId)) return { state: "invalid" };
    supplied.push(item);
  }
  if (!supplied.length) return { state: "absent" };
  const line = parsePregameLine(supplied, awayId, homeId);
  return line ? { state: line.favoriteId === null ? "pickem" : "line", line } : { state: "invalid" };
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
type Completed = { line?: PregameLine; timing: HalftimeObservation; expires: number };
type EnrichmentState = { cache: Map<string, Cached>; attempts: Map<string, Attempt>; completed: Map<string, Completed>; halftimeAttempts: Map<string, number>; claims: Map<string, symbol>; sequence: number };
const states = new WeakMap<typeof fetch, EnrichmentState>();
const key = halftimeKey;
const oddsEligible = (game: Game) => game.teams.some(t => preferredConference(t) || teamRank(t) !== null);

/** Optional enrichment has a 1.5s total budget; failed odds never discard scores. */
export async function enrichPregameLines(board: Scoreboard, parent: AbortSignal, fetcher: typeof fetch = fetch, generation = nextHalftimeGeneration(), observationEpoch = halftimeEpoch()): Promise<Scoreboard> {
  if (parent.aborted || board.stale) return board;
  observeHalftimeBoard(board, generation);
  const state = states.get(fetcher) || { cache: new Map<string, Cached>(), attempts: new Map<string, Attempt>(), completed: new Map<string, Completed>(), halftimeAttempts: new Map<string, number>(), claims: new Map<string, symbol>(), sequence: 0 };
  states.set(fetcher, state);
  const { cache, attempts, completed, halftimeAttempts, claims } = state;
  const rememberLine = (game: Game, line: PregameLine | undefined, observedAt: number) => {
    if (!oddsEligible(game)) return;
    const known = cache.get(key(game));
    // Reuse may become odds-eligible after another scope supplies ranking or
    // conference metadata. Promote its evidence without restamping its TTL.
    if (line || !known?.line || known.expires <= Date.now())
      cache.set(key(game), { line, expires: observedAt + (line ? 6 * 3600000 : 300000) });
    if (cache.size > 250) cache.delete(cache.keys().next().value!);
  };
  for (const [id, value] of completed) if (value.expires <= Date.now()) completed.delete(id);
  const games = [...new Map(board.games.map(game => [key(game), game])).values()];
  // Reuse only minimized completed records, retaining their original time and generation.
  for (const game of games) {
    const value = completed.get(key(game));
    if (value) observeHalftime(game, value.timing);
  }
  const candidates = games.filter(g => !g.pregameLine && (g.state === "live" || g.state === "final" || (g.state === "delayed" && g.started))
    && oddsEligible(g)
    && (attempts.get(key(g))?.retryAfter ?? 0) <= Date.now()
    && (!cache.has(key(g)) || cache.get(key(g))!.expires <= Date.now()))
    .sort((a, b) => Number(b.state === "live") - Number(a.state === "live")
      || (attempts.get(key(a))?.order ?? 0) - (attempts.get(key(b))?.order ?? 0) || a.id.localeCompare(b.id)).slice(0, 12);
  const selected = new Set(candidates.map(key));
  const extra = games.filter(g => g.halftime && g.state === "live" && !selected.has(key(g))
    && !(completed.get(key(g))?.timing.epoch === observationEpoch))
    .sort((a, b) => (halftimeAttempts.get(key(a)) ?? 0) - (halftimeAttempts.get(key(b)) ?? 0) || a.id.localeCompare(b.id))
    .slice(0, 12 - candidates.length);
  if (candidates.length || extra.length) {
    const controller = new AbortController(), abort = () => controller.abort();
    parent.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, 1500);
    const run = async (queue: Game[], odds: boolean) => {
      let index = 0;
      await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
        while (index < queue.length && !controller.signal.aborted) {
          const game = queue[index++];
          let failed = true, skippedClaim = false;
          let releaseClaim: (() => void) | undefined;
          try {
            const reuse = completed.get(key(game));
            if (reuse && reuse.timing.epoch === observationEpoch) { rememberLine(game, reuse.line, reuse.timing.observedAt); failed = false; continue; }
            if (!odds) {
              // Only the owner fetches this extra need. Losers neither await nor
              // share its promise or cancellation; a canceled owner may recover
              // on a later poll. A new visibility epoch has an independent key.
              const claimKey = `${observationEpoch}:${key(game)}`;
              if (claims.has(claimKey) || claims.size >= 250) { skippedClaim = true; continue; }
              const owner = Symbol(); claims.set(claimKey, owner);
              releaseClaim = () => { if (claims.get(claimKey) === owner) claims.delete(claimKey); };
              controller.signal.addEventListener("abort", releaseClaim, { once: true });
            }
            const response = await fetcher(`https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event=${encodeURIComponent(game.id)}`, { signal: controller.signal, mode: "cors", credentials: "omit", cache: "no-store" });
            if (!response.ok) continue;
            const raw = await response.json();
            if (controller.signal.aborted) continue;
            const observedAt = Date.now(), line = summaryPregameLine(raw, game);
            const timing = parseHalftime(raw, game, observedAt, generation, observationEpoch);
            observeHalftime(game, timing);
            if ((completed.get(key(game))?.timing.generation ?? -1) <= generation) {
              completed.set(key(game), { line, timing, expires: observedAt + 30000 });
              if (completed.size > 250) completed.delete(completed.keys().next().value!);
            }
            failed = false;
            // Concurrent tab refreshes may finish out of order; absence cannot erase valid evidence.
            rememberLine(game, line, observedAt);
          } catch { /* Missing favorite evidence is allowed; score refresh still succeeds. */ }
          finally {
            releaseClaim?.();
            if (releaseClaim) controller.signal.removeEventListener("abort", releaseClaim);
            // Operational retry order is separate from evidence that no line exists.
            // Let later games proceed after errors/deadlines, but not caller cancellation.
            if (!parent.aborted && !skippedClaim) {
              halftimeAttempts.delete(key(game)); halftimeAttempts.set(key(game), ++state.sequence);
              if (halftimeAttempts.size > 250) halftimeAttempts.delete(halftimeAttempts.keys().next().value!);
            }
            if (!parent.aborted && odds) {
              attempts.delete(key(game)); attempts.set(key(game), { order: ++state.sequence, retryAfter: failed ? Date.now() + 60000 : 0 });
              if (attempts.size > 250) attempts.delete(attempts.keys().next().value!);
            }
          }
        }
      }));
    };
    try {
      // Extra halftime work starts only after the original odds queue has completed.
      // Both phases share the original deadline and twelve-candidate allowance.
      await run(candidates, true);
      await run(extra, false);
    } finally { clearTimeout(timer); parent.removeEventListener("abort", abort); }
  }
  return { ...board, games: board.games.map(game => {
    const cached = cache.get(key(game));
    return !game.pregameLine && oddsEligible(game) && cached?.line && cached.expires > Date.now() ? { ...game, pregameLine: cached.line } : game;
  }) };
}
