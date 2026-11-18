import { VERSION } from "./releases";

export const DIAGNOSTICS_KEY = "ss:schedule-diagnostics:v1";
const RETENTION = 7 * 86400000, MAX_BYTES = 65536;
const stages = ["primary", "cdn", "cdn-week", "hosted", "cache", "request", "publication"] as const;
const codes = ["ok", "http", "fetch-unclassified", "parse", "validation", "coverage", "continuity", "week-identity", "deadline", "parent-cancel", "stale", "fresh-cache", "detail-unavailable", "reused-or-acquired", "failed", "published", "refresh-deadline", "superseded", "unmounted", "preview-cancel"] as const;
export type Scope = "daily" | "week" | "overnight" | "preview" | "standalone";
export type Observation = { stage: typeof stages[number]; code: typeof codes[number]; ms: number; status?: number };
export type Diagnostic = { schema: 1; id: string; at: number; date: string; end: string; scope: Scope; side: "client" | "server"; source: "primary" | "cdn" | "hosted" | "cache" | "unknown"; version: string; commit: string; observations: Observation[]; omitted: number; outcome: "failed" | "degraded" | "stale" | "canceled" | "success"; recoveredAt?: number; relatedId?: string };
const integer = (n: unknown, max = Number.MAX_SAFE_INTEGER): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= max;
const date = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
/** Reconstruct every field. Never spread untrusted source, stored or server data. */
export function sanitizeDiagnostic(raw: unknown): Diagnostic | null {
  try {
    const x = raw as Diagnostic;
    if (!x || x.schema !== 1 || typeof x.id !== "string" || !/^[a-z0-9-]{1,48}$/.test(x.id) || !integer(x.at) || !date(x.date) || !date(x.end) || x.end < x.date || Date.parse(x.end) - Date.parse(x.date) > 4 * 86400000 || !["daily", "week", "overnight", "preview", "standalone"].includes(x.scope) || !["client", "server"].includes(x.side) || !["primary", "cdn", "hosted", "cache", "unknown"].includes(x.source) || typeof x.version !== "string" || !/^\d+\.\d+\.\d+$/.test(x.version) || typeof x.commit !== "string" || !/^(development|[a-f0-9]{40})$/.test(x.commit) || !["failed", "degraded", "stale", "canceled", "success"].includes(x.outcome) || !Array.isArray(x.observations) || x.observations.length > 32 || !integer(x.omitted)) return null;
    const observations: Observation[] = [];
    for (const o of x.observations) {
      if (!stages.includes(o.stage) || !codes.includes(o.code) || !integer(o.ms, 3600000) || (o.status !== undefined && (!integer(o.status, 599) || o.status < 100))) return null;
      observations.push({ stage: o.stage, code: o.code, ms: o.ms, ...(o.status === undefined ? {} : { status: o.status }) });
    }
    return { schema: 1, id: x.id, at: x.at, date: x.date, end: x.end, scope: x.scope, side: x.side, source: x.source, version: x.version, commit: x.commit, observations, omitted: x.omitted, outcome: x.outcome, ...(integer(x.recoveredAt) ? { recoveredAt: x.recoveredAt } : {}), ...(typeof x.relatedId === "string" && /^[a-z0-9-]{1,48}$/.test(x.relatedId) ? { relatedId: x.relatedId } : {}) };
  } catch { return null; }
}
export function createTrace(date: string, end: string, scope: Scope = "standalone", side: "client" | "server" = "client") {
  const start = Date.now();
  const data: Diagnostic = { schema: 1, id: `${start.toString(36)}-${Math.random().toString(36).slice(2, 12)}`, at: start, date, end, scope, side, source: "unknown", version: VERSION, commit: process.env.SOURCE_COMMIT || "development", observations: [], omitted: 0, outcome: "success" };
  const add = (stage: Observation["stage"], code: Observation["code"], status?: number) => {
    try {
      // Keep the initial causal chain and newest terminal landmarks, even on long multiweek paths.
      if (data.observations.length === 32) {
        const protectedCodes = ["deadline", "parent-cancel", "refresh-deadline", "superseded", "unmounted", "preview-cancel"];
        const failures = ["http", "fetch-unclassified", "parse", "validation", "coverage", "continuity", "week-identity", "failed"];
        const protectedIndexes = new Set([
          data.observations.findIndex(o => failures.includes(o.code)),
          data.observations.findLastIndex(o => failures.includes(o.code)),
          ...protectedCodes.map(code => data.observations.findIndex(o => o.code === code)),
        ]);
        let remove = data.observations.findIndex((_o, i) => i >= 16 && !protectedIndexes.has(i));
        if (remove < 0) remove = data.observations.findIndex((_o, i) => i > 0 && !protectedIndexes.has(i));
        data.observations.splice(remove, 1); data.omitted++;
      }
      data.observations.push({ stage, code, ms: Math.max(0, Math.min(3600000, Date.now() - start)), ...(status === undefined ? {} : { status }) });
    } catch { /* Metadata is never a score dependency. */ }
  };
  return { data, add };
}
export type Trace = ReturnType<typeof createTrace>;
export function validationCode(error: unknown): Observation["code"] {
  // Match only fixed errors emitted by our validators, never export the error string.
  const message = error instanceof Error ? error.message : "";
  if (message === "CDN returned a different requested week") return "week-identity";
  if (message === "CDN does not cover the requested dates continuously") return "continuity";
  if (message === "CDN does not cover the requested dates") return "coverage";
  if (message === "CDN scoreboard is incomplete" || (error instanceof Error && error.name === "ZodError")) return "validation";
  return "failed";
}
export async function diagnosticJson(response: Response, trace: Trace | undefined, stage: Observation["stage"], provenance = true) {
  if (provenance || !response.ok) trace?.add(stage, response.ok ? "ok" : "http", response.status);
  else trace?.add(stage, "reused-or-acquired");
  if (!response.ok) throw new Error(`Score request returned ${response.status}`);
  try { return await response.json(); } catch (error) { trace?.add(stage, "parse"); throw error; }
}
let memory: Diagnostic[] = [], persistent = false, skipDisk = false;
function bounded(items: Diagnostic[], now = Date.now()) {
  const result = items.filter(x => x.at <= now && now - x.at <= RETENTION);
  while (result.length > 20 || JSON.stringify(result).length * 2 > MAX_BYTES) {
    const routine = result.findIndex(x => x.outcome === "degraded" || x.outcome === "canceled" || x.recoveredAt !== undefined);
    result.splice(routine < 0 ? 0 : routine, 1);
  }
  return result;
}
function read() {
  try {
    if (skipDisk) throw new Error("Diagnostic storage unavailable");
    const text = localStorage.getItem(DIAGNOSTICS_KEY);
    if (text && text.length * 2 <= MAX_BYTES) { const raw = JSON.parse(text); if (Array.isArray(raw)) { const disk = raw.map(sanitizeDiagnostic).filter((x): x is Diagnostic => !!x); memory = bounded([...new Map([...disk, ...memory].map(x => [x.id, x])).values()].sort((a, b) => a.at - b.at)); } }
    else if (text) memory = [];
    persistent = true;
  } catch { persistent = false; }
  memory = bounded(memory); return memory;
}
function write(items: Diagnostic[], notify = true) {
  memory = bounded(items);
  try { localStorage.setItem(DIAGNOSTICS_KEY, JSON.stringify(memory)); persistent = true; skipDisk = false; } catch { persistent = false; }
  if (notify && typeof window !== "undefined") window.dispatchEvent(new Event("schedule-diagnostics"));
}
export function saveDiagnostic(raw: unknown) {
  try {
    const item = sanitizeDiagnostic(raw); if (!item || item.outcome === "success") return;
    let items = read().filter(x => x.id !== item.id);
    // Routine fallback and cancellation cannot evict terminal or stale evidence.
    if (items.length >= 20) {
      const expendable = items.findIndex(x => x.outcome === "degraded" || x.outcome === "canceled" || x.recoveredAt !== undefined);
      if (expendable >= 0) items.splice(expendable, 1);
      else if (item.outcome === "degraded" || item.outcome === "canceled") return;
    }
    items = [...items, item]; write(items);
  } catch { /* Score loading must survive storage failures. */ }
}
/** Call only after this exact scope/range has actually published its fresh board. */
export function publishedDiagnostic(raw: unknown, scope: Scope, stale = false) {
  try {
    const item = sanitizeDiagnostic(raw); if (!item) return;
    if (stale) { item.outcome = "stale"; item.scope = scope; saveDiagnostic(item); return; }
    const items = read();
    for (const prior of items) if ((prior.outcome === "failed" || prior.outcome === "stale") && prior.date === item.date && prior.end === item.end && prior.scope === scope && prior.at <= item.at && !prior.recoveredAt) prior.recoveredAt = Date.now();
    write(items);
  } catch { /* Diagnostic only. */ }
}
export function diagnosticsSnapshot() {
  const items = read(); write(items, false);
  return { count: memory.length, persistent, text: JSON.stringify({ schema: 1, retentionDays: 7, limitIncidents: 20, storageLimitBytes: MAX_BYTES, incidents: memory }, null, 2) };
}
export function clearDiagnostics() {
  memory = [];
  try { localStorage.removeItem(DIAGNOSTICS_KEY); persistent = true; skipDisk = false; } catch { persistent = false; skipDisk = true; }
  return diagnosticsSnapshot();
}

const cancellations = new WeakMap<AbortSignal, Observation["code"]>();
export function markDiagnosticCancellation(signal: AbortSignal, code: "refresh-deadline" | "superseded" | "unmounted" | "preview-cancel") { cancellations.set(signal, code); }
export function recordDiagnosticCancellation(trace: Trace, signal: AbortSignal) {
  trace.add("request", "parent-cancel");
  const origin = cancellations.get(signal); if (origin) trace.add("request", origin);
}
