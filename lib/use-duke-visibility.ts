"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Game } from "./football";
import { changeDukeDefault, DUKE_LEGACY_STORAGE_KEY, DUKE_STORAGE_KEY, decodeDukePreferences, defaultDukePreferences, migrateLegacyDukePreferences, rememberDukeGames, type DukeMode, type DukePreferences } from "./duke-visibility";
const REPAIR_NOTICE = "An earlier storage fallback was set to Always hide. It has been corrected to Hide away games during play.";
export function useDukeVisibility(games: Game[]) {
  const [prefs, setPrefs] = useState<DukePreferences | null>(null);
  const current = useRef<DukePreferences | null>(null);
  // Set while saved preferences are damaged or unreadable: the automatic fallback then stays in memory
  // and only an explicit choice saves, so background observations never overwrite saved data (ORD-020).
  const fallback = useRef(false);
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
      let next: DukePreferences, update = false, broken = false;
      try {
        // Without v2, a readable v1 is migrated and saved as v2; v1 itself stays for older open tabs.
        const saved = localStorage.getItem(DUKE_STORAGE_KEY), legacy = saved === null ? localStorage.getItem(DUKE_LEGACY_STORAGE_KEY) : null;
        const decoded = saved === null ? migrateLegacyDukePreferences(legacy) : { ...decodeDukePreferences(saved), cleared: 0 };
        next = decoded.prefs; broken = decoded.corrupted;
        update = !decoded.corrupted && (legacy !== null || decoded.repaired);
        setReadWarning(decoded.corrupted ? "Saved Duke preferences were damaged. Until you choose a setting, away Duke games are hidden during play and other Duke games are shown." : "");
        const notices = [
          decoded.cleared ? `Spoiler protection now hides away games only while they’re being played. Your earlier hide and show choices for individual Duke games were cleared${decoded.repaired ? "." : "; your default was kept."}` : "",
          decoded.repaired ? `${REPAIR_NOTICE} ${decoded.cleared ? "Any later default you chose was kept." : "Any later default and per-game choices you made were kept."}` : "",
        ].filter(Boolean);
        if (notices.length) setMigrationNotice(notices.join(" "));
      }
      catch { next = defaultDukePreferences(); broken = true; setStorageWarning("Saved preferences are unavailable. Away Duke games are hidden during play, and choices apply for this visit only."); }
      fallback.current = broken;
      current.current = next; setPrefs(next);
      // A migration or baseline repair was not the user's choice, so a failed save says so plainly.
      if (update) {
        try { localStorage.setItem(DUKE_STORAGE_KEY, JSON.stringify(next)); }
        catch { setStorageWarning("This browser could not save updated Duke preferences, so they apply for this visit only."); }
      }
    };
    read();
    const changed = (event: StorageEvent) => { if (event.key === DUKE_STORAGE_KEY || event.key === null) read(); };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, []);
  useEffect(() => {
    if (!current.current) return;
    const next = rememberDukeGames(current.current, games);
    if (next === current.current) return;
    if (fallback.current) { current.current = next; setPrefs(next); }
    else commit(next);
  }, [games, prefs, commit]);
  const setHidden = (id: string, hidden: boolean) => {
    setReadWarning(""); setMigrationNotice(""); fallback.current = false;
    if (current.current) commit({ ...current.current, manual: { ...current.current.manual, [id]: hidden } });
  };
  const setMode = (mode: DukeMode) => {
    setReadWarning(""); setMigrationNotice(""); fallback.current = false;
    // Mark games already started under the old default, then record the new one for games still waiting.
    if (current.current) commit(rememberDukeGames(changeDukeDefault(rememberDukeGames(current.current, games), mode, Date.now()), games));
  };
  return { prefs, setHidden, setMode, migrationNotice, storageWarning: [readWarning, storageWarning].filter(Boolean).join(" ") };
}
export type DukeVisibility = ReturnType<typeof useDukeVisibility>;
