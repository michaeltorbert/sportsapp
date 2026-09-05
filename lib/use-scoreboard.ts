"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { accWeek, easternDate, gameDay, retainFinalCategories, shiftDate, validDate, type Scoreboard, type Team } from "./football";
import { loadScores } from "./score-client";

function readBoard(key: string): Scoreboard | null {
  try {
    const board = JSON.parse(localStorage.getItem(key) || "null");
    return board && validDate(board.date) && Number.isFinite(Date.parse(board.fetchedAt)) && Array.isArray(board.games) && board.games.every((g: { teams?: unknown[] }) => Array.isArray(g.teams) && g.teams.length === 2) ? board : null;
  } catch { return null; }
}
export function useScoreboard(weekly: boolean) {
  const [selection, setSelection] = useState<string | null>(null);
  const [today, setToday] = useState(""), [date, setDate] = useState("");
  const [data, setData] = useState<Scoreboard | null>(null), [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false), [online, setOnline] = useState(true);
  const [now, setNow] = useState(0), [timezone, setTimezone] = useState("local time");
  const held = useRef(""), controller = useRef<AbortController | null>(null);
  const cache = useRef(new Map<string, Scoreboard>());

  useEffect(() => {
    const query = new URLSearchParams(location.search).get("date");
    if (query && validDate(query)) setSelection(query);
    try {
      held.current = localStorage.getItem("ss:game-day") || "";
      for (const key of Object.keys(localStorage)) if (key.startsWith("ss:board:") && key.slice(9, 19) < shiftDate(easternDate(), -1)) localStorage.removeItem(key);
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
      const activeDate = weekly ? effective : selection || effective;
      const range = weekly ? accWeek(effective) : { start: activeDate, end: activeDate };
      setDate(activeDate);
      const key = `ss:board:${range.start}:${range.end}`;
      const raw = !weekly && prior?.date === activeDate ? prior : await loadScores(range.start, c.signal, fetch, range.end, weekly);
      if (controller.current !== c) return;
      const old = cache.current.get(key) || readBoard(key);
      const next = retainFinalCategories(raw, old);
      next.games = next.games.map(g => ({ ...g, teams: g.teams.map(t => ({ ...t, changed: !!old?.games.some(p => p.id === g.id && p.teams.some(o => o.id === t.id && o.score !== null && o.score !== t.score)) })) as [Team, Team] }));
      cache.current.set(key, next);
      if (cache.current.size > 8) cache.current.delete(cache.current.keys().next().value!);
      try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* Optional. */ }
      setData(next); setError(overnightWarning); setNow(Date.now());
    } catch {
      if (controller.current === c) setError(navigator.onLine ? "Could not refresh scores. Retrying automatically." : "You're offline. Reconnect to refresh scores.");
    } finally {
      window.clearTimeout(timeout);
      if (controller.current === c) { controller.current = null; setRefreshing(false); }
    }
  }, [selection, weekly]);

  useEffect(() => {
    setData(null); setError(""); refresh();
    const interval = window.setInterval(refresh, 30000);
    const resume = () => { setOnline(navigator.onLine); if (!document.hidden && navigator.onLine) refresh(); };
    const offline = () => { setOnline(false); setError("You're offline. Reconnect to refresh scores."); };
    document.addEventListener("visibilitychange", resume); window.addEventListener("online", resume); window.addEventListener("offline", offline);
    return () => { window.clearInterval(interval); controller.current?.abort(); controller.current = null; document.removeEventListener("visibilitychange", resume); window.removeEventListener("online", resume); window.removeEventListener("offline", offline); };
  }, [refresh]);
  const chooseDate = (value: string | null) => { setSelection(value); setDate(value || held.current || easternDate()); };
  return { date, today, data, error, refreshing, online, now, timezone, refresh, setDate: chooseDate, followToday: selection === null };
}
