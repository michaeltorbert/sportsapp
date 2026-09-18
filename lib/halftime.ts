import type { Game, Scoreboard } from "./football";

export const HALFTIME_MS = 20 * 60_000;
const FRESH_MS = 90_000, MAX_ANCHOR_AGE = 60 * 60_000;
export const halftimeKey = (game: Game) => JSON.stringify([game.id, game.date, ...game.teams.map(t => t.id)]);
type Status = "halftime" | "resumed" | "other" | "invalid";
export type HalftimeObservation = { status: Status; anchor?: number; reason?: string; observedAt: number; generation: number; epoch: number };
type Record = HalftimeObservation & { suppressed?: boolean };
const records = new Map<string, Record>();
let sequence = 0, epoch = 0, discardedGeneration = 0;
const listeners = new Set<() => void>();
export function nextHalftimeGeneration() { return ++sequence; }
export function halftimeEpoch() { return epoch; }
export function invalidateHalftime() { epoch++; emit(); }
export function subscribeHalftime(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
function emit() { for (const listener of listeners) listener(); }
function object(value: unknown): { [key: string]: unknown } { return value && typeof value === "object" && !Array.isArray(value) ? value as { [key: string]: unknown } : {}; }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function validAnchor(anchor: number, game: Game, now: number) { return Number.isFinite(anchor) && Number.isFinite(Date.parse(game.date)) && anchor >= Date.parse(game.date) && anchor <= now && now - anchor <= MAX_ANCHOR_AGE; }

/** Pure parser. Raw ESPN bodies never enter the session registry. */
export function parseHalftime(raw: unknown, game: Game, observedAt: number, generation: number, observationEpoch: number): HalftimeObservation {
  const result = (status: Status, reason?: string, anchor?: number): HalftimeObservation => ({ status, reason, anchor, observedAt, generation, epoch: observationEpoch });
  const body = object(raw), header = object(body.header), competition = object(array(header.competitions)[0]);
  const competitors = array(competition.competitors).map(object);
  if (header.id !== game.id || competitors.length !== 2
    || !competitors.some(c => c.homeAway === "away" && object(c.team).id === game.teams[0].id) || !competitors.some(c => c.homeAway === "home" && object(c.team).id === game.teams[1].id)) return result("invalid", "identity");
  const sourceDate = competition.date ?? header.date;
  if (sourceDate !== undefined && (typeof sourceDate !== "string" || !Number.isFinite(Date.parse(sourceDate)) || Date.parse(sourceDate) !== Date.parse(game.date))) return result("invalid", "date-identity");
  const status = object(competition.status), type = object(status.type);
  const drives = object(body.drives);
  const plays = [...array(drives.previous).flatMap(d => array(object(d).plays)), ...array(object(drives.current).plays)].map(object);
  if (plays.some(p => Number(object(p.period).number) >= 3) || Number(status.period) >= 3 || type.completed === true || type.state === "post") return result("resumed", "resumption");
  if (typeof type.name !== "string") return result("invalid", "missing-status");
  if (type.name !== "STATUS_HALFTIME") return result("other", "non-halftime");
  const markers = plays.filter(p => String(object(p.type).id) === "2" && Number(object(p.period).number) === 2);
  for (const marker of markers) {
    const signature = (p: { [key: string]: unknown }) => JSON.stringify([object(p.type).id, object(p.period).number, object(p.clock).displayValue, p.wallclock]);
    if (typeof marker.id === "string" && plays.some(p => p.id === marker.id && signature(p) !== signature(marker))) return result("invalid", "conflict");
  }
  const seen = new Map<string, string>(), anchors = new Set<number>();
  for (const play of plays) {
    if (String(object(play.type).id) !== "2" || Number(object(play.period).number) !== 2 || object(play.clock).displayValue !== "0:00") continue;
    if (typeof play.id !== "string" || !play.id || typeof play.wallclock !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(play.wallclock)) return result("invalid", "malformed-marker");
    if (seen.has(play.id) && seen.get(play.id) !== play.wallclock) return result("invalid", "conflict");
    seen.set(play.id, play.wallclock);
    const anchor = Date.parse(play.wallclock);
    if (!validAnchor(anchor, game, observedAt)) return result("invalid", "anchor-bounds");
    anchors.add(anchor);
  }
  if (anchors.size > 1) return result("invalid", "conflict");
  return result("halftime", anchors.size ? undefined : "missing-marker", [...anchors][0]);
}
function save(key: string, value: Record) {
  records.delete(key); records.set(key, value);
  while (records.size > 250) {
    const oldest = records.keys().next().value!;
    // One bounded scalar fence survives eviction: no older request can resurrect
    // any discarded status (especially a Q3 suppressor).
    discardedGeneration = Math.max(discardedGeneration, records.get(oldest)!.generation);
    records.delete(oldest);
  }
  emit();
}
export function observeHalftime(game: Game, observation: HalftimeObservation) {
  if (observation.generation <= discardedGeneration) return;
  const key = halftimeKey(game), old = records.get(key);
  if (old && (old.generation > observation.generation || old.suppressed)) return;
  if (observation.status === "invalid") {
    if (observation.reason === "conflict" || observation.reason === "malformed-marker" || observation.reason === "anchor-bounds") save(key, { ...observation, anchor: old?.anchor });
    return;
  }
  if (observation.status === "halftime" && !game.halftime) return;
  if (observation.status === "halftime" && observation.anchor !== undefined && old?.status === "halftime" && old.anchor !== undefined && old.anchor !== observation.anchor) {
    save(key, { ...observation, status: "invalid", reason: "conflict" }); return;
  }
  save(key, { ...observation, anchor: observation.anchor ?? old?.anchor, suppressed: observation.status === "resumed" });
}
export function observeHalftimeBoard(board: Scoreboard, generation: number) {
  if (board.stale || Date.now() - Date.parse(board.fetchedAt) > FRESH_MS) return;
  for (const game of board.games) if (!game.halftime || game.state !== "live") {
    observeHalftime(game, { status: game.period >= 3 || game.state === "final" ? "resumed" : "other", observedAt: Date.parse(board.fetchedAt), generation, epoch });
  }
}
export function halftimeLabel(game: Game, board: Pick<Scoreboard, "fetchedAt" | "stale">, scopeError: boolean, now: number, online: boolean, visible: boolean): string {
  const fallback = "Halftime", record = records.get(halftimeKey(game));
  if (!online || !visible || scopeError || board.stale || !game.halftime || game.state !== "live" || !record || record.suppressed || record.status !== "halftime" || record.epoch !== epoch) return fallback;
  const boardAge = now - Date.parse(board.fetchedAt), statusAge = now - record.observedAt;
  if (!Number.isFinite(now) || !Number.isFinite(boardAge) || boardAge < 0 || boardAge > FRESH_MS || statusAge < 0 || statusAge > FRESH_MS || record.anchor === undefined || !validAnchor(record.anchor, game, now)) return fallback;
  const remaining = Math.max(0, Math.ceil((record.anchor + HALFTIME_MS - now) / 1000));
  return remaining ? `Halftime ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}` : "Halftime · Awaiting 3rd quarter";
}

/** Drop untrusted/persisted timing fields rather than permitting evidence carry-forward. */
export function stripHalftimeTiming(board: Scoreboard): Scoreboard {
  return { ...board, games: board.games.map(game => Object.fromEntries(Object.entries(game).filter(([key]) => !/halftime|anchor|verifiedAt/i.test(key) || key === "halftime")) as Game) };
}
