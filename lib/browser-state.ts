"use client";
import { useSyncExternalStore } from "react";

const subscribeStatic = () => () => {};
const serverSearch = () => null;
const browserSearch = () => location.search;
// Browser-only values retain the server fallback during hydration. Query state
// is the initial URL; explicit date choices are owned by the scoreboard hook.
export function useInitialSearch() {
  return useSyncExternalStore(subscribeStatic, browserSearch, serverSearch);
}
const serverTimezone = () => "local time";
const browserTimezone = () => new Intl.DateTimeFormat(undefined, { timeZoneName: "short" }).formatToParts(new Date()).find(p => p.type === "timeZoneName")?.value || "local time";
export function useTimezone() {
  return useSyncExternalStore(subscribeStatic, browserTimezone, serverTimezone);
}
const serverFalse = () => false;
const serverTrue = () => true;
const browserIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const browserSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const browserStandalone = () => matchMedia("(display-mode: standalone)").matches || !!(navigator as Navigator & { standalone?: boolean }).standalone;
function subscribeStandalone(update: () => void) {
  const media = matchMedia("(display-mode: standalone)");
  media.addEventListener("change", update);
  return () => media.removeEventListener("change", update);
}
export function usePushEnvironment() {
  const ios = useSyncExternalStore(subscribeStatic, browserIos, serverFalse);
  const supported = useSyncExternalStore(subscribeStatic, browserSupported, serverTrue);
  const standalone = useSyncExternalStore(subscribeStandalone, browserStandalone, serverFalse);
  return { ios, supported, standalone };
}
const browserOnline = () => navigator.onLine;
function subscribeOnline(update: () => void) {
  window.addEventListener("online", update);
  window.addEventListener("offline", update);
  return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
}
export function useOnline() {
  return useSyncExternalStore(subscribeOnline, browserOnline, serverTrue);
}
