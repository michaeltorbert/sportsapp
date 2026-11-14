"use client";
import { useEffect, useState } from "react";
import { useOnline } from "./browser-state";
import { playerRequestKey, type PlayerRequest, type PlayerSeason } from "./player-season";
import { loadPlayerSeason } from "./player-season-client";
const memory = new Map<string, PlayerSeason>();
export function usePlayerSeason(request: PlayerRequest | null) {
  const key = request ? playerRequestKey(request) : "", online = useOnline();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ key: string; season: PlayerSeason | null; pending: boolean; failed: boolean }>({ key, season: memory.get(key) ?? null, pending: false, failed: false });
  useEffect(() => {
    if (!request || !online) return;
    let disposed = false; const controller = new AbortController();
    setState({ key, season: memory.get(key) ?? null, pending: true, failed: false });
    void loadPlayerSeason(request, controller.signal).then(result => {
      if (disposed) return;
      if (result.kind === "ok") {
        memory.delete(key); memory.set(key, result.season); while (memory.size > 16) memory.delete(memory.keys().next().value!);
        setState({ key, season: result.season, pending: false, failed: false });
      } else setState(current => current.key === key ? { ...current, pending: false, failed: true } : current);
    }).catch(() => { if (!disposed) setState(current => current.key === key ? { ...current, pending: false, failed: true } : current); });
    return () => { disposed = true; controller.abort(); };
    // request's primitive fingerprint owns cancellation; object identity is irrelevant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, online, attempt]);
  const current = state.key === key ? state : { key, season: memory.get(key) ?? null, pending: !!request && online, failed: false };
  const identity = current.season ?? [...memory.values()].reverse().find(s => request && s.id === request.id && s.anchor.team === request.team && s.anchor.year === request.anchorYear) ?? null;
  return { ...current, identity, online, retry: () => { if (!current.pending) setAttempt(n => n + 1); } };
}
