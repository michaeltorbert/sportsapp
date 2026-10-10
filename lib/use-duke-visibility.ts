"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Game } from "./football";
import { changeDukeDefault, DUKE_LEGACY_STORAGE_KEY, DUKE_STORAGE_KEY, decodeDukePreferences, migrateLegacyDukePreferences, parseDukePreferences, rememberDukeGames, type DukeMode, type DukePreferences } from "./duke-visibility";
export function useDukeVisibility(games: Game[]) {
  const [prefs, setPrefs] = useState<DukePreferences | null>(null);
  const current = useRef<DukePreferences | null>(null);
  const [readWarning, setReadWarning] = useState("");
  const [storageWarning, setStorageWarning] = useState("");
  const [migrationNotice, setMigrationNotice] = useState("");
  const commit = useCallback((next: DukePreferences) => {
    current.current = next; setPrefs(next);
    try { localStorage.setItem(DUKE_STORAGE_KEY, JSON.stringify(next)); setStorageWarning(""); }
    catch { setStorageWarning("Your choice applies for this visit only. This browser could not save it."); }
  }, []);
  useEffect(() => {
    const read = () => {
      let next: DukePreferences, migrated = false;
      try {
        // Without v2, a readable v1 is migrated and saved as v2; v1 itself stays for older open tabs.
        const saved = localStorage.getItem(DUKE_STORAGE_KEY), legacy = saved === null ? localStorage.getItem(DUKE_LEGACY_STORAGE_KEY) : null;
        const decoded = saved === null ? migrateLegacyDukePreferences(legacy) : { ...decodeDukePreferences(saved), cleared: 0 };
        next = decoded.prefs; migrated = legacy !== null && !decoded.corrupted;
        setReadWarning(decoded.corrupted ? "Saved Duke preferences were damaged. Duke is hidden until you choose a new setting." : "");
        if (decoded.cleared) setMigrationNotice("Spoiler protection now hides away games only once they start. Your earlier hide and show choices for individual Duke games were cleared; your default was kept.");
      }
      catch { next = parseDukePreferences("invalid"); setStorageWarning("Saved preferences are unavailable. Duke is hidden until you choose to show a game."); }
      if (migrated) commit(next);
      else { current.current = next; setPrefs(next); }
    };
    read();
    const changed = (event: StorageEvent) => { if (event.key === DUKE_STORAGE_KEY || event.key === null) read(); };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [commit]);
  useEffect(() => {
    if (!current.current) return;
    const next = rememberDukeGames(current.current, games);
    if (next !== current.current) commit(next);
  }, [games, prefs, commit]);
  const setHidden = (id: string, hidden: boolean) => {
    setReadWarning(""); setMigrationNotice("");
    if (current.current) commit({ ...current.current, manual: { ...current.current.manual, [id]: hidden } });
  };
  const setMode = (mode: DukeMode) => {
    setReadWarning(""); setMigrationNotice("");
    // Freeze started games under the old default, then record the new one for games still waiting.
    if (current.current) commit(rememberDukeGames(changeDukeDefault(rememberDukeGames(current.current, games), mode, Date.now()), games));
  };
  return { prefs, setHidden, setMode, migrationNotice, storageWarning: [readWarning, storageWarning].filter(Boolean).join(" ") };
}
export type DukeVisibility = ReturnType<typeof useDukeVisibility>;
