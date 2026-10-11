import { STATS_MAX_ACTIVE, STATS_TOTAL_DEADLINE_MS } from "./game-stats";
import type { StatsOutcome } from "./stats-client";

type Run = (deadline: number, signal: AbortSignal) => Promise<StatsOutcome>;
type Job = { owner: string; run: Run; deadline: number; settle: (outcome: StatsOutcome) => void; onStart?: () => void; controller: AbortController; timer?: ReturnType<typeof setTimeout>; active: boolean };
export type Clock = { now: () => number; setTimeout: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>; clearTimeout: (timer: ReturnType<typeof setTimeout>) => void };
const systemClock: Clock = { now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: timer => clearTimeout(timer) };

/**
 * FIFO queue shared by expanded cards: at most two active loads and one
 * queued-or-active entry per card. One absolute eight-second deadline starts
 * at enqueue, so queue time counts toward the total. Canceled work settles
 * nothing; queued expiry settles as a local "expired" failure.
 */
export function createStatsScheduler(clock: Clock = systemClock, maxActive = STATS_MAX_ACTIVE, totalMs = STATS_TOTAL_DEADLINE_MS) {
  const queue: Job[] = [], active = new Set<Job>(), owners = new Map<string, Job>();
  const finish = (job: Job) => {
    if (job.timer !== undefined) clock.clearTimeout(job.timer);
    if (owners.get(job.owner) === job) owners.delete(job.owner);
    active.delete(job);
    const index = queue.indexOf(job);
    if (index >= 0) queue.splice(index, 1);
  };
  const pump = () => {
    while (active.size < maxActive && queue.length) {
      const job = queue.shift()!;
      if (job.timer !== undefined) clock.clearTimeout(job.timer);
      job.active = true; active.add(job); job.onStart?.();
      job.run(job.deadline, job.controller.signal).then(
        outcome => { if (!job.controller.signal.aborted && owners.get(job.owner) === job) { finish(job); job.settle(outcome); } else finish(job); },
        () => { const live = !job.controller.signal.aborted && owners.get(job.owner) === job; finish(job); if (live) job.settle({ kind: "failed", reason: "network" }); },
      ).finally(pump);
    }
  };
  function enqueue(owner: string, run: Run, settle: (outcome: StatsOutcome) => void, onStart?: () => void) {
    // A card never holds more than one entry; new demand while queued/active is ignored.
    if (owners.has(owner)) return () => cancel(owner);
    const job: Job = { owner, run, settle, onStart, deadline: clock.now() + totalMs, controller: new AbortController(), active: false };
    job.timer = clock.setTimeout(() => {
      if (job.active || owners.get(owner) !== job) return;
      finish(job); job.settle({ kind: "failed", reason: "expired" });
    }, totalMs);
    owners.set(owner, job); queue.push(job); pump();
    return () => { if (owners.get(owner) === job) cancel(owner); };
  }
  function cancel(owner: string) {
    const job = owners.get(owner);
    if (!job) return;
    job.controller.abort(); finish(job); pump();
  }
  return { enqueue, cancel, pending: (owner: string) => owners.has(owner), stats: () => ({ active: active.size, queued: queue.length }) };
}

export const statsScheduler = createStatsScheduler();
