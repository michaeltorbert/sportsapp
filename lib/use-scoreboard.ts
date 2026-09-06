"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { accWeek, easternDate, gameDay, retainFinalCategories, shiftDate, validDate, type Scoreboard, type Team } from "./football";
import { loadScores } from "./score-client";
import { expiredBoardKey, matchingBoard, type BoardScope } from "./scoreboard-views";

function readBoard(key: string): Scoreboard | null {
  try {
    const board = JSON.parse(localStorage.getItem(key) || "null");
    return board && validDate(board.date) && Number.isFinite(Date.parse(board.fetchedAt)) && Array.isArray(board.games) && board.games.every((g: { teams?: unknown[] }) => Array.isArray(g.teams) && g.teams.length === 2) ? board : null;
  } catch { return null; }
}
export function useScoreboard(scope: BoardScope) {
  const [selection, setSelection] = useState<string | null>(null);
  const [today, setToday] = useState(""), [date, setDate] = useState("");
  const [boards, setBoards] = useState<Record<BoardScope, Scoreboard | null>>({ daily: null, acc: null, top25: null });
  const [errors, setErrors] = useState<Record<BoardScope, string>>({ daily: "", acc: "", top25: "" });
  const [overnightError, setOvernightError] = useState("");
  const [refreshing, setRefreshing] = useState(false), [online, setOnline] = useState(true);
  const [now, setNow] = useState(0), [timezone, setTimezone] = useState("local time");
  const held = useRef(""), controller = useRef<AbortController | null>(null);
  const cache = useRef(new Map<string, Scoreboard>());

  useEffect(() => {
    const query = new URLSearchParams(location.search).get("date");
    if (query && validDate(query)) setSelection(query);
    try {
      held.current = localStorage.getItem("ss:game-day") || "";
      for (const key of Object.keys(localStorage)) if (expiredBoardKey(key, shiftDate(easternDate(), -1))) localStorage.removeItem(key);
    } catch { /* Browsing still works when storage is unavailable. */ }
    setNow(Date.now()); setOnline(navigator.onLine);
    setTimezone(new Intl.DateTimeFormat(undefined, { timeZoneName: "short" }).formatToParts(new Date()).find(p => p.type === "timeZoneName")?.value || "local time");
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
      try { prior = await loadScores(yesterday, c.signal); }
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
        } catch {
          if (controller.current === c) setErrors(previous => ({ ...previous, [boardScope]: navigator.onLine ? "Could not refresh scores. Retrying automatically." : "You're offline. Reconnect to refresh scores." }));
        }
      };
      const week = accWeek(effective);
      await Promise.all([update({ start: activeDate, end: activeDate }, "daily"), update(week, "acc"), update(week, "top25")]);
    } catch {
      if (controller.current === c) setOvernightError(navigator.onLine ? "Could not refresh scores. Retrying automatically." : "You're offline. Reconnect to refresh scores.");
    } finally {
      window.clearTimeout(timeout);
      if (controller.current === c) { controller.current = null; setRefreshing(false); }
    }
  }, [selection]);

  useEffect(() => {
    setErrors({ daily: "", acc: "", top25: "" }); setOvernightError(""); refresh();
    const interval = window.setInterval(refresh, 30000);
    const resume = () => { setOnline(navigator.onLine); if (!document.hidden && navigator.onLine) refresh(); };
    const offline = () => { setOnline(false); setOvernightError("You're offline. Reconnect to refresh scores."); };
    document.addEventListener("visibilitychange", resume); window.addEventListener("online", resume); window.addEventListener("offline", offline);
    return () => { window.clearInterval(interval); controller.current?.abort(); controller.current = null; document.removeEventListener("visibilitychange", resume); window.removeEventListener("online", resume); window.removeEventListener("offline", offline); };
  }, [refresh]);
  const chooseDate = (value: string | null) => { setSelection(value); setDate(value || held.current || easternDate()); };
  // Weekly views follow the current football week; manual dates apply to daily tabs.
  const range = today ? accWeek(today) : null;
  const matching = {
    daily: matchingBoard(boards.daily, date),
    acc: range ? matchingBoard(boards.acc, range.start, range.end) : null,
    top25: range ? matchingBoard(boards.top25, range.start, range.end) : null,
  };
  const data = matching[scope];
  const error = errors[scope] || overnightError;
  return { date, today, data, boards: matching, error, refreshing, online, now, timezone, refresh, setDate: chooseDate, followToday: selection === null };
}
