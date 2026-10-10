"use client";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Game } from "./football";
import { expectedPhase, LIVE_STATS_ENABLED, STATS_BACKOFF_MS, STATS_POLL_MS, STATS_SETTLED_TTL_MS, STATS_SNAPSHOT_LIMIT, statsTtl, type GameStats, type StatsPhase } from "./game-stats";
import { loadGameStats, type StatsOutcome, type StatsRequest } from "./stats-client";
import { statsScheduler, type Clock } from "./stats-scheduler";
import { useOnline } from "./browser-state";

type Failure = Extract<StatsOutcome, { kind: "failed" }>["reason"];
export type StatsInput = { game: Pick<Game, "id" | "date" | "state" | "started" | "teams">; expanded: boolean; visible: boolean; online: boolean };
export type StatsState = {
  mode: "off" | "exception" | "disabled" | "active"; generation: string; expected: StatsPhase | null;
  snapshot: GameStats | null; pending: "waiting" | "loading" | null; failure: Failure | null; retryAt: number;
};
// The latest observation of one event. It belongs to exactly one generation;
// any other generation for that event is a correction and starts a new one.
// `failure` persists until a successful retrieval or a new generation, so a remount
// (for example live → paused moving the card between sections) keeps the warning.
type Observation = { generation: string; stats: GameStats | null; failure: Failure | null; revalidate: boolean; failures: number; retryAt: number; lastAttempt: number };
type Scheduler = Pick<typeof statsScheduler, "enqueue" | "cancel">;
type Load = (request: StatsRequest, deadline: number, signal: AbortSignal) => Promise<StatsOutcome>;

// Identity, scheduled date and expected phase define a generation.
export function statsGeneration(game: StatsInput["game"]) {
  return [game.id, game.teams[0].id, game.teams[1].id, game.date, expectedPhase(game) ?? "none"].join("|");
}

/**
 * Card-owned stats lifecycle, independent of scoreboard refresh. Memory-only:
 * nothing reaches Game, Scoreboard or localStorage. Snapshots replace whole.
 * Memory outlives a card's mount so collapse, reopen and section moves reuse
 * an unchanged observation; it never restores one from an earlier generation.
 */
export function createStatsMemory() { return { observations: new Map<string, Observation>() }; }
const sharedMemory = createStatsMemory();
const systemClock: Clock = { now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: timer => clearTimeout(timer) };

/** The remembered state for this card's current generation, read synchronously on mount. */
export function rememberedStats(game: StatsInput["game"], memory = sharedMemory, liveEnabled = LIVE_STATS_ENABLED): StatsState | null {
  const generation = statsGeneration(game), known = memory.observations.get(game.id), expected = expectedPhase(game);
  if (known?.generation !== generation || expected === null || (expected === "started" && !liveEnabled)) return null;
  return { mode: "active", generation, expected, snapshot: known.stats, pending: null, failure: known.failure, retryAt: known.retryAt };
}

export class StatsController {
  state: StatsState = { mode: "off", generation: "", expected: null, snapshot: null, pending: null, failure: null, retryAt: 0 };
  private input: StatsInput | null = null;
  private eligible = false;
  private manual = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private listener: (state: StatsState) => void = () => {};
  constructor(private owner: string, private scheduler: Scheduler = statsScheduler, private load: Load = loadGameStats, private clock: Clock = systemClock, private memory = sharedMemory, private liveEnabled = LIVE_STATS_ENABLED) {}
  subscribe(listener: (state: StatsState) => void) { this.listener = listener; }
  private emit(changes: Partial<StatsState>) { this.state = { ...this.state, ...changes }; this.listener(this.state); }
  private observation(): Observation {
    const known = this.input && this.memory.observations.get(this.input.game.id);
    return known && known.generation === this.state.generation ? known : { generation: this.state.generation, stats: null, failure: null, revalidate: false, failures: 0, retryAt: 0, lastAttempt: 0 };
  }
  private remember(changes: Partial<Observation>) {
    const id = this.input!.game.id, map = this.memory.observations;
    const next = { ...this.observation(), ...changes };
    map.delete(id); map.set(id, next);
    while (map.size > STATS_SNAPSHOT_LIMIT) map.delete(map.keys().next().value!);
  }

  update(input: StatsInput) {
    this.input = input;
    const generation = statsGeneration(input.game), expected = expectedPhase(input.game), changed = generation !== this.state.generation;
    if (changed) {
      this.cancel();
      this.manual = false;
      const known = this.memory.observations.get(input.game.id);
      this.emit({ generation, expected, failure: null });
      if (known?.generation === generation) this.emit({ snapshot: known.stats, failure: known.failure, retryAt: known.retryAt });
      else {
        // A phase, date, matchup or exceptional-status change for an event already
        // observed is a correction: the old snapshot is dropped, never restored on a
        // return, and the next load asks the Worker to bypass its completed cache.
        this.remember({ generation, stats: null, failure: null, revalidate: !!known, failures: 0, retryAt: 0, lastAttempt: 0 });
        this.emit({ snapshot: null, retryAt: 0 });
      }
    }
    const mode = expected === null ? "exception" : expected === "started" && !this.liveEnabled ? "disabled" : "active";
    if (mode !== this.state.mode) this.emit({ mode });
    const eligible = mode === "active" && input.expanded && input.visible && input.online;
    const resumed = eligible && (!this.eligible || changed);
    this.eligible = eligible;
    if (!eligible) { this.cancel(); return; }
    this.plan(resumed);
  }
  /** Explicit retry or refresh: one bounded attempt, never before the backoff or Retry-After allows it. */
  retry() {
    if (!this.eligible || this.state.pending || this.observation().retryAt > this.clock.now()) return false;
    if (this.timer !== undefined) { this.clock.clearTimeout(this.timer); this.timer = undefined; }
    this.manual = true; this.start(); return true;
  }
  dispose() { this.eligible = false; this.cancel(); this.listener = () => {}; }

  private cancel() {
    if (this.timer !== undefined) { this.clock.clearTimeout(this.timer); this.timer = undefined; }
    this.scheduler.cancel(this.owner);
    if (this.state.pending) this.emit({ pending: null });
  }
  private plan(resumed: boolean) {
    if (this.state.pending) return;
    if (this.timer !== undefined) { this.clock.clearTimeout(this.timer); this.timer = undefined; }
    const now = this.clock.now(), observation = this.observation(), snapshot = this.state.snapshot, expected = this.state.expected!;
    let due: number | null;
    if (observation.retryAt > now) due = observation.retryAt;
    else if (!snapshot) due = now;
    else {
      const age = now - Date.parse(snapshot.checkedAt);
      // Opening or resuming refreshes once when the applicable TTL has passed.
      if (resumed && age >= statsTtl(expected)) due = now;
      // While open, started games poll; pregame revalidates once its reuse expires; finals wait for reopen/manual.
      else if (expected === "started") due = Math.max(observation.lastAttempt + STATS_POLL_MS, now);
      else if (expected === "pregame") due = Math.max(Date.parse(snapshot.checkedAt) + STATS_SETTLED_TTL_MS, observation.lastAttempt + STATS_SETTLED_TTL_MS, now);
      else due = null;
    }
    if (due === null) return;
    if (due <= now) this.start();
    else this.timer = this.clock.setTimeout(() => { this.timer = undefined; if (this.eligible) this.plan(false); }, due - now);
  }
  private start() {
    const input = this.input!, generation = this.state.generation, expected = this.state.expected!;
    const request: StatsRequest = { eventId: input.game.id, teamIds: [input.game.teams[0].id, input.game.teams[1].id], phase: expected, refresh: this.observation().revalidate || this.manual };
    this.manual = false;
    this.emit({ pending: "waiting" });
    this.scheduler.enqueue(this.owner, (deadline, signal) => this.load(request, deadline, signal), outcome => {
      if (generation !== this.state.generation) return; // Late generation: rejected.
      this.settle(outcome);
    }, () => { if (generation === this.state.generation) this.emit({ pending: "loading" }); });
  }
  private settle(outcome: StatsOutcome) {
    const now = this.clock.now(), observation = this.observation();
    if (outcome.kind === "ok") {
      this.remember({ stats: outcome.stats, failure: null, revalidate: false, failures: 0, retryAt: 0, lastAttempt: now });
      this.emit({ pending: null, snapshot: outcome.stats, failure: null, retryAt: 0 });
    } else {
      // Queue expiry is local: it does not advance upstream backoff.
      const failures = outcome.reason === "expired" ? observation.failures : observation.failures + 1;
      const backoff = outcome.reason === "expired" ? STATS_POLL_MS : STATS_BACKOFF_MS[Math.min(failures, STATS_BACKOFF_MS.length) - 1];
      const retryAt = now + Math.min(STATS_BACKOFF_MS.at(-1)!, Math.max(backoff, (outcome.retryAfter ?? 0) * 1000));
      this.remember({ failure: outcome.reason, failures, retryAt, lastAttempt: now });
      this.emit({ pending: null, failure: outcome.reason, retryAt });
    }
    if (this.eligible) this.plan(false);
  }
}

const subscribeVisibility = (update: () => void) => { document.addEventListener("visibilitychange", update); return () => document.removeEventListener("visibilitychange", update); };
const browserVisible = () => document.visibilityState !== "hidden";
const serverVisible = () => true;

export function useGameStats(game: Game, expanded: boolean) {
  const online = useOnline();
  const visible = useSyncExternalStore(subscribeVisibility, browserVisible, serverVisible) ?? true;
  const controller = useRef<StatsController | null>(null);
  // Seeded from memory so a remounted card renders its stats controls in the first paint.
  const [state, setState] = useState<StatsState | null>(rememberedStats(game));
  const [now, setNow] = useState(0);
  const generation = statsGeneration(game);
  const input = useMemo(() => ({ game: { id: game.id, date: game.date, state: game.state, started: game.started, teams: game.teams }, expanded, visible, online }),
    // The generation captures identity, date and phase; teams are compared via it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [generation, game.state, game.started, expanded, visible, online]);
  useEffect(() => {
    const owned = new StatsController(`card:${game.id}`);
    controller.current = owned;
    owned.subscribe(setState);
    return () => { owned.dispose(); if (controller.current === owned) controller.current = null; };
  }, [game.id]);
  useEffect(() => { controller.current?.update(input); }, [input]);
  // Independent age timer: cached age becomes visible without any refresh.
  useEffect(() => {
    if (!expanded) return;
    const tick = () => setNow(Date.now());
    const first = window.setTimeout(tick, 0), timer = window.setInterval(tick, 5000);
    return () => { window.clearTimeout(first); window.clearInterval(timer); };
  }, [expanded]);
  return { state, now, online, retry: () => controller.current?.retry() };
}
