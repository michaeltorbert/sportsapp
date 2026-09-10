"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { accWeek, easternDate, gameDay, retainFinalCategories, shiftDate, validDate, type Scoreboard, type Team } from "./football";
import { loadScores } from "./score-client";
import { expiredBoardKey, matchingBoard, type BoardScope } from "./scoreboard-views";

import { useInitialSearch, useOnline, useTimezone } from "./browser-state";

function readBoard(key: string): Scoreboard | null {
  try {
    const board = JSON.parse(localStorage.getItem(key) || "null");
    return board && validDate(board.date) && Number.isFinite(Date.parse(board.fetchedAt)) && Array.isArray(board.games) && board.games.every((g: { teams?: unknown[] }) => Array.isArray(g.teams) && g.teams.length === 2) ? board : null;
  } catch { return null; }
}
function refreshError(online: boolean, guide: boolean) {
  const subject = guide ? "schedule" : "scores";
  return online ? `Could not refresh ${subject}. Retrying automatically.` : `You're offline. Reconnect to refresh ${subject}.`;
}
export function useScoreboard(scope: BoardScope, dailyOnly = false, controlledDate?: string | null) {
  const search = useInitialSearch();
  const query = new URLSearchParams(search || "").get("date");
  const [chosenDate, setSelection] = useState<string | null | undefined>(undefined);
  const selection = dailyOnly ? (controlledDate ?? null) : chosenDate === undefined ? (query && validDate(query) ? query : null) : chosenDate;
  const [today, setToday] = useState(""), [date, setDate] = useState("");
  const [boards, setBoards] = useState<Record<BoardScope, Scoreboard | null>>({ daily: null, acc: null, top25: null });
  const [errors, setErrors] = useState<Record<BoardScope, string>>({ daily: "", acc: "", top25: "" });
  const [overnightError, setOvernightError] = useState("");
  const [guideDailyErrors, setGuideDailyErrors] = useState<Record<string, string>>({});
  const [refreshing, setRefreshing] = useState(false);
  const online = useOnline(), timezone = useTimezone();
  const [now, setNow] = useState(0);
  const held = useRef(""), controller = useRef<AbortController | null>(null);
  const cache = useRef(new Map<string, Scoreboard>());

  useEffect(() => {
    try {
      held.current = localStorage.getItem("ss:game-day") || "";
      for (const key of Object.keys(localStorage)) if (expiredBoardKey(key, shiftDate(easternDate(), -1))) localStorage.removeItem(key);
    } catch { /* Browsing still works when storage is unavailable. */ }
    const timer = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, []);

  const refresh = useCallback(async () => {
    if (document.hidden || controller.current) return;
    const c = new AbortController(); controller.current = c; setRefreshing(true);
    const timeout = window.setTimeout(() => c.abort(), 40000);
    try {
      const clock = new Date(), calendar = easternDate(clock), yesterday = shiftDate(calendar, -1);
      let prior: Scoreboard | null = null, overnightWarning = "";
      const manualGuide = dailyOnly && selection !== null;
      try { if (!manualGuide) prior = await loadScores(yesterday, c.signal); }
      catch (e) {
        if (c.signal.aborted) throw e;
        overnightWarning = "Could not verify overnight games. Checking again shortly.";
      }
      const effective = gameDay(clock, prior, held.current);
      if (controller.current !== c) return;
      held.current = effective; setToday(effective);
      try { localStorage.setItem("ss:game-day", effective); } catch { /* Optional. */ }
      const activeDate = selection || effective;
      setDate(activeDate);
      setOvernightError(overnightWarning);
      // Fetch all scopes independently. Switching tabs never discards another
      // scope or restarts polling, and a failed scope cannot blank a healthy one.
      const update = async (range: { start: string; end: string }, boardScope: BoardScope) => {
        // Keep existing daily/ACC history, with a separate full-FBS weekly cache.
        const key = `ss:board:${boardScope === "top25" ? "top25:" : ""}${range.start}:${range.end}`;
        try {
          const raw = boardScope === "daily" && prior?.date === activeDate ? prior : await loadScores(range.start, c.signal, fetch, range.end, boardScope === "acc");
          if (controller.current !== c) return;
          const old = cache.current.get(key) || readBoard(key);
          const next = retainFinalCategories(raw, old);
          next.games = next.games.map(g => ({ ...g, teams: g.teams.map(t => ({ ...t, changed: !!old?.games.some(p => p.id === g.id && p.teams.some(o => o.id === t.id && o.score !== null && o.score !== t.score)) })) as [Team, Team] }));
          cache.current.set(key, next);
          if (cache.current.size > 8) cache.current.delete(cache.current.keys().next().value!);
          try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* Optional. */ }
          setBoards(previous => ({ ...previous, [boardScope]: next }));
          setErrors(previous => ({ ...previous, [boardScope]: "" })); setNow(Date.now());
          if (dailyOnly && boardScope === "daily") setGuideDailyErrors(previous => {
            const next = { ...previous }; delete next[activeDate]; return next;
          });
        } catch {
          if (controller.current === c) {
            if (dailyOnly && boardScope === "daily") setGuideDailyErrors(previous => ({ ...previous, [activeDate]: refreshError(navigator.onLine, true) }));
            setErrors(previous => ({ ...previous, [boardScope]: refreshError(navigator.onLine, dailyOnly) }));
          }
        }
      };
      const week = accWeek(effective);
      const checkOvernight = async () => {
        try {
          const overnight = await loadScores(yesterday, c.signal);
          if (controller.current !== c) return;
          const effective = gameDay(clock, overnight, held.current);
          held.current = effective; setToday(effective); setOvernightError("");
          try { localStorage.setItem("ss:game-day", effective); } catch { /* Optional. */ }
        } catch {
          if (controller.current === c) setOvernightError("Could not verify overnight games. Checking again shortly.");
        }
      };
      // A manual Guide date can load even when yesterday is slow or unavailable.
      await Promise.all([update({ start: activeDate, end: activeDate }, "daily"), ...(dailyOnly ? [] : [update(week, "acc"), update(week, "top25")]), ...(manualGuide ? [checkOvernight()] : [])]);
    } catch {
      if (controller.current === c) {
        const message = refreshError(navigator.onLine, dailyOnly);
        setOvernightError(message);
        if (dailyOnly) { const failedDate = selection || gameDay(new Date(), null, held.current); setDate(failedDate); if (selection === null) setToday(failedDate); setGuideDailyErrors(previous => ({ ...previous, [failedDate]: message })); setErrors(previous => ({ ...previous, daily: message })); }
      }
    } finally {
      window.clearTimeout(timeout);
      if (controller.current === c) { controller.current = null; setRefreshing(false); }
    }
  }, [selection, dailyOnly]);

  const queryReady = search !== null;
  useEffect(() => {
    if (!queryReady) return;
    // Schedule the initial poll alongside the interval, with matching cleanup.
    // Hydration must resolve the initial query before any scores are requested.
    const initial = window.setTimeout(refresh, 0);
    const interval = window.setInterval(refresh, 30000);
    const resume = () => { if (!document.hidden && navigator.onLine) refresh(); };
    const offline = () => { setOvernightError(refreshError(false, dailyOnly)); };
    document.addEventListener("visibilitychange", resume); window.addEventListener("online", resume); window.addEventListener("offline", offline);
    return () => { window.clearTimeout(initial); window.clearInterval(interval); controller.current?.abort(); controller.current = null; document.removeEventListener("visibilitychange", resume); window.removeEventListener("online", resume); window.removeEventListener("offline", offline); };
  }, [refresh, queryReady, dailyOnly]);
  const chooseDate = (value: string | null) => { setErrors({ daily: "", acc: "", top25: "" }); setOvernightError(""); setSelection(value); setDate(value || held.current || easternDate()); };
  // Weekly views follow the current football week; manual dates apply to daily tabs.
  const range = today ? accWeek(today) : null;
  // Guide URL ownership includes null: Today must never fall back to a manual date.
  const displayDate = dailyOnly ? (selection ?? today) : date;
  const matching = {
    daily: matchingBoard(boards.daily, displayDate),
    acc: range ? matchingBoard(boards.acc, range.start, range.end) : null,
    top25: range ? matchingBoard(boards.top25, range.start, range.end) : null,
  };
  const data = matching[scope];
  const error = errors[scope] || overnightError;
  return { date: displayDate, today, data, boards: matching, error, dailyError: dailyOnly ? guideDailyErrors[displayDate] || "" : errors.daily, overnightError, refreshing, online, now, timezone, refresh, setDate: chooseDate, followToday: selection === null };
}
