"use client";
import { useEffect, useState } from "react";
import { useOnline } from "./browser-state";
import { playerRequestKey, type PlayerRequest, type PlayerSeason } from "./player-season";
import { loadPlayerSeason } from "./player-season-client";
const memory = new Map<string, PlayerSeason>();
export function usePlayerSeason(request: PlayerRequest | null) {
  const key = request ? playerRequestKey(request) : "", online = useOnline();
  const [attempt, setAttempt] = useState(0);
  // Request ownership (`${key}#${attempt}`): state is set only by the settled load owning the current
  // request, never synchronously in the effect, so pending is derived. Same fetch, abort, retained-season,
  // failure and identity behavior as before.
  const owner = `${key}#${attempt}`;
  const [settled, setSettled] = useState<{ owner: string; key: string; season: PlayerSeason | null; failed: boolean } | null>(null);
  useEffect(() => {
    if (!request || !online) return;
    let disposed = false; const controller = new AbortController();
    const fail = () => { if (!disposed) setSettled({ owner, key, season: memory.get(key) ?? null, failed: true }); };
    void loadPlayerSeason(request, controller.signal).then(result => {
      if (disposed) return;
      if (result.kind === "ok") {
        memory.delete(key); memory.set(key, result.season); while (memory.size > 16) memory.delete(memory.keys().next().value!);
        setSettled({ owner, key, season: result.season, failed: false });
      } else fail();
    }).catch(fail);
    return () => { disposed = true; controller.abort(); };
    // request's primitive fingerprint (in `owner`) owns cancellation; object identity is irrelevant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, online]);
  const mine = settled?.owner === owner ? settled : null;
  const current = { key, season: (settled?.key === key ? settled.season : null) ?? memory.get(key) ?? null, pending: !!request && online && !mine, failed: !!mine?.failed };
  const identity = current.season ?? [...memory.values()].reverse().find(s => request && s.id === request.id && s.anchor.team === request.team && s.anchor.year === request.anchorYear) ?? null;
  return { ...current, identity, online, retry: () => { if (!current.pending) setAttempt(n => n + 1); } };
}
