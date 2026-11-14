import { parsePlayerSeason, type PlayerRequest, type PlayerSeason } from "./player-season";
export type PlayerOutcome = { kind: "ok"; season: PlayerSeason } | { kind: "failed"; reason: "invalid" | "unavailable" | "network" };
export function playerApiQuery(request: PlayerRequest) {
  return new URLSearchParams({ id: request.id, year: String(request.year), team: request.team, anchorYear: String(request.anchorYear), ...(request.stintTeam ? { stintTeam: request.stintTeam } : {}), ...(request.witnessTeam && request.witnessEvent ? { witnessTeam: request.witnessTeam, witnessEvent: request.witnessEvent } : {}) });
}
export async function loadPlayerSeason(request: PlayerRequest, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<PlayerOutcome> {
  if (signal.aborted) throw new DOMException("Player request canceled", "AbortError");
  const controller = new AbortController(), abort = () => controller.abort(); signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 180_000);
  try {
    const response = await fetcher(`/api/player?${playerApiQuery(request)}`, { signal: controller.signal, cache: "no-store", mode: "same-origin", credentials: "same-origin" });
    if (!response.ok) return { kind: "failed", reason: response.status === 400 ? "invalid" : "unavailable" };
    const reader = response.body?.getReader(); if (!reader) return { kind: "failed", reason: "invalid" };
    const chunks: Uint8Array[] = []; let count = 0;
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; count += value.byteLength; if (count > 500_000) { void reader.cancel().catch(() => {}); return { kind: "failed", reason: "invalid" }; } chunks.push(value); } }
    catch { return { kind: "failed", reason: "network" }; }
    if (controller.signal.aborted) { if (signal.aborted) throw new DOMException("Player request canceled", "AbortError"); return { kind: "failed", reason: "network" }; }
    const all = new Uint8Array(count); let offset = 0; for (const part of chunks) { all.set(part, offset); offset += part.byteLength; }
    const bytes = new TextDecoder().decode(all);
    let raw: unknown; try { raw = JSON.parse(bytes); } catch { return { kind: "failed", reason: "invalid" }; }
    const season = parsePlayerSeason(raw, request); return season ? { kind: "ok", season } : { kind: "failed", reason: "invalid" };
  } catch (error) { if (signal.aborted) throw error; return { kind: "failed", reason: "network" }; }
  finally { clearTimeout(timer); signal.removeEventListener("abort", abort); }
}
