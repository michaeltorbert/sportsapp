"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Game } from "./football";
import { changeDukeDefault, DUKE_STORAGE_KEY, decodeDukePreferences, parseDukePreferences, rememberDukeGames, type DukeMode, type DukePreferences } from "./duke-visibility";
export function useDukeVisibility(games: Game[]) {
  const [prefs, setPrefs] = useState<DukePreferences | null>(null);
  const current = useRef<DukePreferences | null>(null);
  const [readWarning, setReadWarning] = useState("");
  const [storageWarning, setStorageWarning] = useState("");
  const commit = useCallback((next: DukePreferences) => {
    current.current = next; setPrefs(next);
    try { localStorage.setItem(DUKE_STORAGE_KEY, JSON.stringify(next)); setStorageWarning(""); }
    catch { setStorageWarning("Your choice applies for this visit only. This browser could not save it."); }
  }, []);
  useEffect(() => {
    const read = () => {
      let next: DukePreferences;
      try { const decoded = decodeDukePreferences(localStorage.getItem(DUKE_STORAGE_KEY)); next = decoded.prefs; setReadWarning(decoded.corrupted ? "Saved Duke preferences were damaged. Duke is hidden until you choose a new setting." : ""); }
      catch { next = parseDukePreferences("invalid"); setStorageWarning("Saved preferences are unavailable. Duke is hidden until you choose to show a game."); }
      current.current = next; setPrefs(next);
    };
    read();
    const changed = (event: StorageEvent) => { if (event.key === DUKE_STORAGE_KEY || event.key === null) read(); };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, []);
  useEffect(() => {
    if (!current.current) return;
    const next = rememberDukeGames(current.current, games, Date.now());
    if (next !== current.current) commit(next);
  }, [games, prefs, commit]);
  const setHidden = (id: string, hidden: boolean) => {
    setReadWarning("");
    if (current.current) commit({ ...current.current, overrides: { ...current.current.overrides, [id]: hidden } });
  };
  const setMode = (mode: DukeMode) => {
    setReadWarning("");
    if (current.current) commit(changeDukeDefault(rememberDukeGames(current.current, games, Date.now()), mode, Date.now()));
  };
  return { prefs, setHidden, setMode, storageWarning: [readWarning, storageWarning].filter(Boolean).join(" ") };
}
export type DukeVisibility = ReturnType<typeof useDukeVisibility>;
