"use client";
import { useEffect, useState } from "react";
import { useOnline } from "./browser-state";
import { parseTeamDefense, type TeamDefense } from "./team-defense";

export type TeamDefenseOutcome = { kind: "ok"; defense: TeamDefense } | { kind: "failed"; reason: "invalid" | "unavailable" | "network" };
/** Same-origin, bounded (size, deadline, schema, exact team/year), abortable. Same pattern as loadPlayerSeason. */
export async function loadTeamDefense(teamId: string, year: number, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<TeamDefenseOutcome> {
  if (signal.aborted) throw new DOMException("Team defense request canceled", "AbortError");
  const controller = new AbortController(), abort = () => controller.abort(); signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 180_000);
  try {
    const response = await fetcher(`/api/team-defense?${new URLSearchParams({ team: teamId, year: String(year) })}`, { signal: controller.signal, cache: "no-store", mode: "same-origin", credentials: "same-origin" });
    if (!response.ok) return { kind: "failed", reason: response.status === 400 ? "invalid" : "unavailable" };
    const reader = response.body?.getReader(); if (!reader) return { kind: "failed", reason: "invalid" };
    const chunks: Uint8Array[] = []; let count = 0;
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; count += value.byteLength; if (count > 300_000) { void reader.cancel().catch(() => {}); return { kind: "failed", reason: "invalid" }; } chunks.push(value); } }
    catch { return { kind: "failed", reason: "network" }; }
    if (controller.signal.aborted) { if (signal.aborted) throw new DOMException("Team defense request canceled", "AbortError"); return { kind: "failed", reason: "network" }; }
    const all = new Uint8Array(count); let offset = 0; for (const part of chunks) { all.set(part, offset); offset += part.byteLength; }
    let raw: unknown; try { raw = JSON.parse(new TextDecoder().decode(all)); } catch { return { kind: "failed", reason: "invalid" }; }
    const defense = parseTeamDefense(raw, teamId, year); return defense ? { kind: "ok", defense } : { kind: "failed", reason: "invalid" };
  } catch (error) { if (signal.aborted) throw error; return { kind: "failed", reason: "network" }; }
  finally { clearTimeout(timer); signal.removeEventListener("abort", abort); }
}

const memory = new Map<string, TeamDefense>();
export type TeamDefenseState = { defense: TeamDefense | null; pending: boolean; failed: boolean; retry: () => void };
/** Loads only while `enabled` (the base team season is shown). Retry never forces upstream work: the server
 *  returns the cached generation or an honest delayed state under ordinary admission. */
/** Request ownership: each load is identified by `${key}#${attempt}`. State is only set from the settled
 *  load that owns the current request (never synchronously in the effect), so pending is derived: an
 *  active, online request whose outcome hasn't arrived. A failed revisit keeps the retained generation
 *  (memory) and reports failed, so the screen can say "Refresh delayed" and offer an ordinary Retry. */
export function useTeamDefense(teamId: string | null, year: number | null, enabled: boolean): TeamDefenseState {
  const key = teamId && year !== null ? `${teamId}:${year}` : "", online = useOnline(), active = !!key && enabled;
  const [attempt, setAttempt] = useState(0);
  // A load restarted by reconnecting or re-enabling (live false→true) gets a new owner, so it is pending
  // until it settles. `cycle` is adjusted during render (React's supported pattern), never in an effect.
  const live = active && online;
  const [lastLive, setLastLive] = useState(live), [cycle, setCycle] = useState(0);
  if (live !== lastLive) { setLastLive(live); if (live) setCycle(n => n + 1); }
  const request = `${key}#${attempt}#${cycle}`;
  const [settled, setSettled] = useState<{ request: string; key: string; defense: TeamDefense | null; failed: boolean } | null>(null);
  useEffect(() => {
    if (!active || !online || !teamId || year === null) return;
    let disposed = false; const controller = new AbortController();
    const fail = () => { if (!disposed) setSettled({ request, key, defense: memory.get(key) ?? null, failed: true }); };
    void loadTeamDefense(teamId, year, controller.signal).then(result => {
      if (disposed) return;
      if (result.kind === "ok") {
        memory.delete(key); memory.set(key, result.defense); while (memory.size > 16) memory.delete(memory.keys().next().value!);
        setSettled({ request, key, defense: result.defense, failed: false });
      } else fail();
    }).catch(fail);
    return () => { disposed = true; controller.abort(); };
    // `request` encodes teamId, year and attempt; enablement and connectivity own cancellation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, active, online]);
  const owned = settled?.request === request ? settled : null;
  const pending = active && online && !owned;
  const defense = !active ? null : (settled?.key === key ? settled.defense : null) ?? memory.get(key) ?? null;
  return { defense, pending, failed: active && !!owned?.failed, retry: () => { if (!pending) setAttempt(n => n + 1); } };
}
