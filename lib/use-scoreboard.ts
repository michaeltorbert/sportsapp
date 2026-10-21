"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { accWeek, easternDate, gameDay, retainFinalCategories, shiftDate, validDate, type Scoreboard, type Team } from "./football";
import { retainHalftimeEnvironment } from "./halftime-clock";
import { stripHalftimeTiming } from "./halftime";
import { enrichScores, requestScores, type ScoreRequest } from "./score-client";
import { createCdnDocuments } from "./cdn-documents";
import { boardKey, expiredBoardKey, matchingBoard, type BoardScope } from "./scoreboard-views";
import { readWeek } from "./app-update";

import { useInitialSearch, useOnline, useTimezone } from "./browser-state";

function readBoard(key: string): Scoreboard | null {
  try {
    const board = JSON.parse(localStorage.getItem(key) || "null");
    return board && validDate(board.date) && Number.isFinite(Date.parse(board.fetchedAt)) && Array.isArray(board.games) && board.games.every((g: { teams?: unknown[] }) => Array.isArray(g.teams) && g.teams.length === 2) ? stripHalftimeTiming(board) : null;
  } catch { return null; }
}
function refreshError(online: boolean, guide: boolean) {
  const subject = guide ? "schedule" : "scores";
  return online ? `Could not refresh ${subject}. Retrying automatically.` : `You're offline. Reconnect to refresh ${subject}.`;
}
// A neighboring range shown beside the results while a swipe is held (#172): its scores-only request,
// and that board with saved final categories once it arrives. `gesture` is the drag that asked for it.
type Preview = { key: string; gesture: number; controller: AbortController; promise: Promise<ScoreRequest>; request: ScoreRequest | null; board: Scoreboard | null; failed: boolean };
// A neighbor shows scores fetched within this long, the same age at which displayed scores count as stale.
const PREVIEW_FRESH = 90_000;
// A committed range adopts its preview's request only when it is no older than one poll.
const ADOPT_FRESH = 30_000;
const PREVIEW_LIMIT = 4;
const fresh = (board: Scoreboard | null | undefined, limit = PREVIEW_FRESH): board is Scoreboard => !!board && Date.now() - Date.parse(board.fetchedAt) <= limit;
// At most one speculative request runs at a time; completed previews are kept, bounded. `asked` holds the
// ranges the current drag has requested, so none is requested twice in one drag.
type PreviewStore = { entries: Map<string, Preview>; speculative: Preview | null; gesture: number; asked: Set<string> };
// The refresh of a range reuses that range's preview request, with the request's own generation and
// epoch, through the same history and enrichment path. An old, failed or canceled one is requested
// again; the refresh's cancellation cancels an adopted request still in flight.
function adoptPreview(store: PreviewStore, key: string, signal: AbortSignal, request: () => Promise<ScoreRequest>) {
  const entry = store.entries.get(key);
  if (!entry || entry.failed) return request();
  store.entries.delete(key);
  if (entry.request) return fresh(entry.request.board, ADOPT_FRESH) ? Promise.resolve(entry.request) : request();
  if (store.speculative === entry) store.speculative = null;
  const stop = () => entry.controller.abort();
  signal.addEventListener("abort", stop);
  if (signal.aborted) stop();
  return entry.promise.catch(error => { if (signal.aborted) throw error; return request(); }).finally(() => signal.removeEventListener("abort", stop));
}
// Cancels the speculative request in flight (if any but `keep`) and forgets it, so its late result is never shown.
function cancelSpeculative(store: PreviewStore, keep = "") {
  const entry = store.speculative;
  if (!entry || entry.key === keep) return;
  store.speculative = null;
  if (store.entries.get(entry.key) === entry) store.entries.delete(entry.key);
  entry.controller.abort();
}
export function useScoreboard(scope: BoardScope, dailyOnly = false, controlledDate?: string | null) {
  const search = useInitialSearch();
  const params = new URLSearchParams(search || ""), query = params.get("date");
  const [chosenDate, setSelection] = useState<string | null | undefined>(undefined);
  const selection = dailyOnly ? (controlledDate ?? null) : chosenDate === undefined ? (query && validDate(query) ? query : null) : chosenDate;
  // The chosen Week (#172): the Thursday starting it, or null to follow the current week. It is
  // independent of the Day selection, and the Guide's daily board never reads it.
  const [chosenWeek, setWeekSelection] = useState<string | null | undefined>(undefined);
  const weekAnchor = dailyOnly ? null : chosenWeek === undefined ? readWeek(params) : chosenWeek;
  const [today, setToday] = useState(""), [date, setDate] = useState("");
  const [boards, setBoards] = useState<Record<BoardScope, Scoreboard | null>>({ daily: null, week: null });
  const [errors, setErrors] = useState<Record<BoardScope, string>>({ daily: "", week: "" });
  const [overnightError, setOvernightError] = useState("");
  const [guideDailyErrors, setGuideDailyErrors] = useState<Record<string, string>>({});
  const [refreshing, setRefreshing] = useState(false);
  const online = useOnline(), timezone = useTimezone();
  const [now, setNow] = useState(0);
  const held = useRef(""), controller = useRef<AbortController | null>(null);
  const cache = useRef(new Map<string, Scoreboard>());
  const previews = useRef<PreviewStore>({ entries: new Map(), speculative: null, gesture: -1, asked: new Set() });
  const [, setPreviewed] = useState(0);

  useEffect(() => {
    try {
      held.current = localStorage.getItem("ss:game-day") || "";
      for (const key of Object.keys(localStorage)) if (expiredBoardKey(key, shiftDate(easternDate(), -1))) localStorage.removeItem(key);
    } catch { /* Browsing still works when storage is unavailable. */ }
    const timer = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(retainHalftimeEnvironment, []);
  // A speculative preview never outlives the page being shown or mounted. A committed range's
  // adopted request belongs to its refresh instead, and is canceled with it.
  useEffect(() => {
    const store = previews.current;
    const hidden = () => { if (document.hidden) cancelSpeculative(store); };
    document.addEventListener("visibilitychange", hidden);
    return () => { document.removeEventListener("visibilitychange", hidden); cancelSpeculative(store); };
  }, []);

  const refresh = useCallback(async () => {
    if (document.hidden || controller.current) return;
    const c = new AbortController(); controller.current = c; setRefreshing(true);
    const timeout = window.setTimeout(() => c.abort(), 40000);
    // Completed backup CDN documents are reused only within this refresh; the next refresh downloads again.
    const cdn = createCdnDocuments();
    try {
      const clock = new Date(), calendar = easternDate(clock), yesterday = shiftDate(calendar, -1);
      let prior: ScoreRequest | null = null, overnightWarning = "";
      const manualGuide = dailyOnly && selection !== null;
      // The probe is scores-only: enrichment cannot change the game-day decision,
      // and a discarded prior board needs no optional summary work.
      try { if (!manualGuide) prior = await requestScores(yesterday, c.signal, fetch, yesterday, false, cdn); }
      catch (e) {
        if (c.signal.aborted) throw e;
        overnightWarning = "Could not verify overnight games. Checking again shortly.";
      }
      const effective = gameDay(clock, prior?.board ?? null, held.current);
      if (controller.current !== c) return;
      held.current = effective; setToday(effective);
      try { localStorage.setItem("ss:game-day", effective); } catch { /* Optional. */ }
      const activeDate = selection || effective;
      setDate(activeDate);
      setOvernightError(overnightWarning);
      // Fetch both periods independently. Switching periods or categories never
      // discards the other board or restarts polling, and a failed board cannot
      // blank a healthy one. Every category reads the full-FBS weekly feed (ORD-011).
      const update = async (range: { start: string; end: string }, boardScope: BoardScope) => {
        // Daily history and the full-FBS weekly cache are stored separately.
        const key = boardKey(boardScope, range.start, range.end);
        try {
          // A displayed prior board is enriched here, once, with its original request's generation and epoch.
          const request = boardScope === "daily" && prior?.board.date === activeDate ? prior : await adoptPreview(previews.current, key, c.signal, () => requestScores(range.start, c.signal, fetch, range.end, false, cdn));
          if (controller.current !== c) return;
          // Read this scope's history once. The weekly board's pre-1.9 key keeps retained final categories across the upgrade.
          const old = cache.current.get(key) || readBoard(key) || (boardScope === "week" ? readBoard(boardKey(boardScope, range.start, range.end, true)) : null);
          // Retain the matching saved baseline before optional recovery: summary or cached
          // lines fill only absence, while a current pre-kickoff line or pick'em still wins.
          const next = await enrichScores({ ...request, board: retainFinalCategories(request.board, old) }, c.signal, fetch);
          // Late canceled or superseded enrichment writes nothing.
          if (controller.current !== c || c.signal.aborted) return;
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
      const week = accWeek(weekAnchor || effective);
      const checkOvernight = async () => {
        try {
          // Informational only: the selected Guide board owns any enrichment.
          const { board: overnight } = await requestScores(yesterday, c.signal, fetch, yesterday, false, cdn);
          if (controller.current !== c) return;
          const effective = gameDay(clock, overnight, held.current);
          held.current = effective; setToday(effective); setOvernightError("");
          try { localStorage.setItem("ss:game-day", effective); } catch { /* Optional. */ }
        } catch {
          if (controller.current === c) setOvernightError("Could not verify overnight games. Checking again shortly.");
        }
      };
      // A manual Guide date can load even when yesterday is slow or unavailable.
      await Promise.all([update({ start: activeDate, end: activeDate }, "daily"), ...(dailyOnly ? [] : [update(week, "week")]), ...(manualGuide ? [checkOvernight()] : [])]);
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
  }, [selection, dailyOnly, weekAnchor]);

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
  // A real change of day or week supersedes the running refresh at once, so none of its late
  // results or errors can land on the new range. Choosing the same value keeps polling as it is.
  const supersede = () => { controller.current?.abort(); controller.current = null; setRefreshing(false); };

  // Neighbor previews (#172). The best known scores for an adjacent range: fresh history first, then its
  // preview. Neither is ever written to the displayed board, its errors or saved history before a commit.
  const peek = (boardScope: BoardScope, start: string, end: string) => {
    const key = boardKey(boardScope, start, end), cached = cache.current.get(key), known = previews.current.entries.get(key), previewed = known?.board;
    if (fresh(cached)) return { board: cached, failed: false };
    if (fresh(previewed)) return { board: previewed, failed: false };
    return { board: null, failed: !!known?.failed };
  };
  // Requests a range the drag `gesture` has revealed, unless it is already known, in flight, or was
  // already requested in this drag. Revealing another range cancels the one in flight first.
  const preview = (boardScope: BoardScope, start: string, end: string, gesture: number) => {
    const store = previews.current, key = boardKey(boardScope, start, end), known = store.entries.get(key);
    if (dailyOnly || document.hidden || fresh(cache.current.get(key))) return;
    if (store.gesture !== gesture) { store.gesture = gesture; store.asked.clear(); }
    if (store.asked.has(key) || (known && !known.failed && (!known.request || fresh(known.board)))) return;
    store.asked.add(key);
    cancelSpeculative(store);
    const controller = new AbortController();
    const entry: Preview = { key, gesture, controller, promise: requestScores(start, controller.signal, fetch, end, false), request: null, board: null, failed: false };
    store.entries.delete(key); store.entries.set(key, entry); store.speculative = entry;
    for (const [other, kept] of store.entries) if (store.entries.size > PREVIEW_LIMIT && kept !== store.speculative) store.entries.delete(other);
    entry.promise.then(request => {
      if (store.entries.get(key) !== entry) return;
      entry.request = request;
      // Only the saved final categories, as the displayed board keeps them; no summaries or other enrichment.
      entry.board = retainFinalCategories(request.board, cache.current.get(key) || readBoard(key));
      setPreviewed(n => n + 1);
    }, () => {
      if (store.entries.get(key) !== entry) return;
      if (controller.signal.aborted) store.entries.delete(key);
      else { entry.failed = true; setPreviewed(n => n + 1); }
    }).finally(() => { if (store.speculative === entry) store.speculative = null; });
  };
  // A change to any other range cancels a speculative request; the chosen range's own is adopted by its refresh.
  // `seed` (a committed swipe) shows the chosen range's known scores at once while that refresh runs.
  const settle = (boardScope: BoardScope, start: string | null, end: string | null, seed: boolean) => {
    cancelSpeculative(previews.current, start && end ? boardKey(boardScope, start, end) : "");
    const known = seed && start && end ? peek(boardScope, start, end).board : null;
    if (known) setBoards(previous => ({ ...previous, [boardScope]: known }));
  };
  const chooseDate = (value: string | null, seed = false) => {
    if (value !== selection) supersede();
    settle("daily", value, value, seed);
    setErrors({ daily: "", week: "" }); setOvernightError(""); setSelection(value); setDate(value || held.current || easternDate());
  };
  const chooseWeek = (value: string | null, seed = false) => {
    const next = value && validDate(value) ? accWeek(value).start : null;
    if (next !== weekAnchor) { supersede(); setErrors(previous => ({ ...previous, week: "" })); }
    const target = next ? accWeek(next) : today ? accWeek(today) : null;
    settle("week", target?.start ?? null, target?.end ?? null, seed);
    setWeekSelection(next);
  };
  // The weekly period follows the current football week unless a week was chosen; manual dates apply to Day.
  const range = weekAnchor ? accWeek(weekAnchor) : today ? accWeek(today) : null;
  // Guide URL ownership includes null: Today must never fall back to a manual date.
  const displayDate = dailyOnly ? (selection ?? today) : date;
  const matching = {
    daily: matchingBoard(boards.daily, displayDate),
    week: range ? matchingBoard(boards.week, range.start, range.end) : null,
  };
  const data = matching[scope];
  const error = errors[scope] || overnightError;
  return { date: displayDate, today, data, boards: matching, error, scopeError: errors[scope], dailyError: dailyOnly ? guideDailyErrors[displayDate] || "" : errors.daily, overnightError, refreshing, online, now, timezone, refresh, setDate: chooseDate, followToday: selection === null, week: range, weekDate: weekAnchor, setWeek: chooseWeek, followWeek: weekAnchor === null, peek, preview };
}
