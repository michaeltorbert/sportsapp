"use client";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { guideUrl, parseGuide, type GuideSelection } from "./guide-state";
const EVENT = "ss:guide-url";
function subscribe(update: () => void) {
  window.addEventListener("popstate", update); window.addEventListener(EVENT, update);
  return () => { window.removeEventListener("popstate", update); window.removeEventListener(EVENT, update); };
}
const snapshot = () => location.search;
const serverSnapshot = () => null;
export function useGuideState() {
  const search = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const selection = parseGuide(search || "");
  useEffect(() => {
    const next = guideUrl(location.href, parseGuide(location.search));
    if (next !== location.pathname + location.search + location.hash) {
      history.replaceState(history.state, "", next); window.dispatchEvent(new Event(EVENT));
    }
  }, []);
  const choose = useCallback((next: GuideSelection) => {
    const href = guideUrl(location.href, next);
    if (href !== location.pathname + location.search + location.hash) history.pushState(history.state, "", href);
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return { ...selection, ready: search !== null, choose };
}
