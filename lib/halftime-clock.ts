import { invalidateHalftime, subscribeHalftime } from "./halftime";

// One browser clock shared by mounted leaves; no page/list polling state.
const listeners = new Set<() => void>();
let interval: ReturnType<typeof setInterval> | undefined;
const serverSnapshot = { now: 0, online: false, visible: false };
let snapshot = serverSnapshot, previousWall = 0, previousMonotonic = 0;
let environmentUsers = 0;
let unsubscribeEvidence: (() => void) | undefined;
function tick() {
  const wall = Date.now(), monotonic = performance.now();
  if (previousWall && Math.abs((wall - previousWall) - (monotonic - previousMonotonic)) > 5000) {
    previousWall = wall; previousMonotonic = monotonic;
    invalidateHalftime();
  }
  previousWall = wall; previousMonotonic = monotonic;
  // Monotonically changing snapshot also wakes leaves for same-millisecond evidence changes.
  snapshot = { now: wall, online: navigator.onLine, visible: !document.hidden };
  for (const listener of listeners) listener();
}
function visibility() {
  if (interval) clearInterval(interval);
  interval = undefined;
  if (!document.hidden && listeners.size) interval = setInterval(tick, 1000);
  tick();
}
export function subscribeHalftimeClock(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    if (!previousWall) { previousWall = Date.now(); previousMonotonic = performance.now(); }
    unsubscribeEvidence = subscribeHalftime(tick);
    document.addEventListener("visibilitychange", visibility, true);
    window.addEventListener("online", tick); window.addEventListener("offline", tick);
    if (!document.hidden) interval = setInterval(tick, 1000);
    tick();
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      if (interval) clearInterval(interval); interval = undefined;
      unsubscribeEvidence?.(); unsubscribeEvidence = undefined;
      document.removeEventListener("visibilitychange", visibility, true);
      window.removeEventListener("online", tick); window.removeEventListener("offline", tick);
    }
  };
}
export const halftimeClockSnapshot = () => snapshot;
export const halftimeServerSnapshot = () => serverSnapshot;

// Scope lifetime outlives countdown leaves (tab switches, empty lists, Guide).
// Capture-phase invalidation precedes the hook's resume-triggered requests.
function boundary() { invalidateHalftime(); tick(); }
export function retainHalftimeEnvironment() {
  if (++environmentUsers === 1) document.addEventListener("visibilitychange", boundary, true);
  return () => {
    if (--environmentUsers === 0) {
      document.removeEventListener("visibilitychange", boundary, true);
      invalidateHalftime();
    }
  };
}
