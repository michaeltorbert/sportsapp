"use client";
import { useEffect, useState } from "react";
import { Bell, BellRing } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

type Config = { ready: boolean; publicKey: string };
type Credentials = { id: string; token: string };
// Response bodies are typed explicitly: the Workers runtime declarations make
// `Response.json()` generic, so an unannotated result is `unknown`.
type ServiceSettings = { serviceUrl?: string };
type SubscriptionStatus = { active: boolean; kickoff: boolean };
function saved(): Credentials | null { try { return JSON.parse(localStorage.getItem("ss:push") || "null"); } catch { return null; } }
function keyBytes(value: string) { return Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4)), c => c.charCodeAt(0)); }
export function Alerts() {
  const [ios, setIos] = useState(false), [standalone, setStandalone] = useState(false), [supported, setSupported] = useState(true);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [service, setService] = useState(""), [config, setConfig] = useState<Config | null>(null);
  const [enabled, setEnabled] = useState(false), [kickoff, setKickoff] = useState(false);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  useEffect(() => {
    let alive = true;
    let checking = false;
    setIos(/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
    const media = matchMedia("(display-mode: standalone)");
    const display = () => setStandalone(media.matches || !!(navigator as Navigator & { standalone?: boolean }).standalone);
    display(); media.addEventListener("change", display);
    setSupported("serviceWorker" in navigator && "PushManager" in window && "Notification" in window);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).then(() => navigator.serviceWorker.ready).then(r => { if (alive) setRegistration(r); }).catch(() => { if (alive) setMessage("Alert setup could not load. Try reopening the app."); });
    const checkAvailability = async () => {
      if (checking || document.visibilityState === "hidden") return;
      checking = true;
      try {
        const r = await fetch("/alerts-config.json", { cache: "no-store", signal: AbortSignal.timeout(10000) });
        const settings: ServiceSettings = await r.json();
        if (!settings.serviceUrl) return;
        const url = new URL(settings.serviceUrl);
        if (url.protocol !== "https:") return;
        const base = url.origin;
        const response = await fetch(`${base}/config`, { credentials: "omit", signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error();
        const state: Config = await response.json();
        if (!alive) return;
        setService(base); setConfig(state);
        setMessage(previous => previous === "The alert service is unavailable. Try again later." ? "" : previous);
        const credentials = saved();
        if (credentials && "Notification" in window && Notification.permission === "granted" && "serviceWorker" in navigator) {
          const status = await fetch(`${base}/subscriptions/${credentials.id}`, { headers: { Authorization: `Bearer ${credentials.token}` }, credentials: "omit", signal: AbortSignal.timeout(10000) });
          if (status.ok) {
            const details: SubscriptionStatus = await status.json();
            const local = await navigator.serviceWorker.getRegistration("/");
            const subscription = await local?.pushManager.getSubscription();
            if (alive) { setEnabled(!!details.active && !!subscription); setKickoff(details.kickoff); }
          }
        }
      } catch { if (alive) { setConfig(null); setMessage("The alert service is unavailable. Try again later."); } }
      finally { checking = false; if (alive) setLoading(false); }
    };
    void checkAvailability();
    const timer = window.setInterval(checkAvailability, 30000);
    document.addEventListener("visibilitychange", checkAvailability);
    return () => { alive = false; window.clearInterval(timer); document.removeEventListener("visibilitychange", checkAvailability); media.removeEventListener("change", display); };
  }, []);

  async function enable() {
    if (!registration || !config?.ready || (ios && !standalone)) return;
    setBusy(true); setMessage("");
    try {
      // Keep this request directly in the tap handler, before any network await.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setMessage("Alerts are blocked. You can allow them in your device’s notification settings."); return; }
      const existing = await registration.pushManager.getSubscription();
      const sub = existing || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(config.publicKey) });
      const credentials = saved();
      const response = await fetch(`${service}/subscriptions`, { method: "POST", credentials: "omit", headers: { "Content-Type": "application/json", ...(credentials ? { Authorization: `Bearer ${credentials.token}` } : {}) }, body: JSON.stringify({ subscription: sub.toJSON(), kickoff }) });
      if (!response.ok) throw new Error(response.status === 409 ? "This device’s saved alert access is missing. Reset alerts below, then enable again." : "Could not save alerts. Please try again.");
      const record = await response.json();
      try { localStorage.setItem("ss:push", JSON.stringify(record)); } catch { await sub.unsubscribe(); throw new Error("This browser cannot save alert settings. Allow website storage and try again."); }
      setEnabled(true); setMessage("Alerts are on for this device, including when the app is closed.");
    } catch (e) { setMessage(e instanceof Error ? e.message : "Could not enable alerts."); }
    finally { setBusy(false); }
  }
  async function updateKickoff(value: boolean) {
    if (!enabled) { setKickoff(value); return; }
    const credentials = saved(); if (!credentials) return;
    setBusy(true); setMessage("");
    try {
      const r = await fetch(`${service}/subscriptions/${credentials.id}`, { method: "PATCH", credentials: "omit", headers: { "Content-Type": "application/json", Authorization: `Bearer ${credentials.token}` }, body: JSON.stringify({ kickoff: value }) });
      if (!r.ok) throw new Error(); setKickoff(value);
    } catch { setMessage("Could not save the kickoff preference. Try again."); }
    finally { setBusy(false); }
  }
  async function disable() {
    setBusy(true); setMessage("");
    try {
      const credentials = saved();
      if (credentials && service) {
        const r = await fetch(`${service}/subscriptions/${credentials.id}`, { method: "DELETE", credentials: "omit", headers: { Authorization: `Bearer ${credentials.token}` } });
        if (!r.ok && r.status !== 404) throw new Error();
      }
      await (await registration?.pushManager.getSubscription())?.unsubscribe();
      localStorage.removeItem("ss:push"); setEnabled(false); setMessage("Alerts are off for this device.");
    } catch { setMessage("Could not turn off alerts. Try again, or block them in your device settings."); }
    finally { setBusy(false); }
  }
  return <Sheet><SheetTrigger asChild><button className="alerts-button">{enabled ? <BellRing size={16} /> : <Bell size={16} />}<span>{enabled ? "Alerts on" : "Alerts"}</span></button></SheetTrigger><SheetContent side="bottom" className="help-sheet"><SheetHeader><SheetTitle>Catch the game-changing moments.</SheetTitle><SheetDescription>One alert per game for each trigger.</SheetDescription></SheetHeader><div className="help-body"><ul className="alert-triggers"><li>A game reaches a one-score margin in the fourth quarter or overtime, including ties.</li><li>A ranked team trails in the fourth quarter or overtime.</li><li>A ranked team loses to an unranked or lower-ranked opponent.</li></ul><label className="toggle-label kickoff-toggle"><input type="checkbox" checked={kickoff} disabled={busy} onChange={e => updateKickoff(e.target.checked)} /><span>Also alert me 10 minutes before ACC kickoffs</span></label>{ios && !standalone ? <div className="install-tip"><h3>Add to Home Screen for alerts</h3><p>In Safari, tap Share → Add to Home Screen. Keep Open as Web App enabled if offered. Open the new icon, return to Alerts, and tap Enable alerts.</p></div> : !supported ? <p>This browser does not support push alerts. Try Safari on your iPhone’s Home Screen or Chrome on Android.</p> : loading ? <p>Checking alert availability…</p> : !config?.ready ? <div className="install-tip"><h3>Alerts are being set up</h3><p>Live scores are available now. Background alerts will become available when setup is complete.</p></div> : <button className="solid-button alert-enable" onClick={enabled ? disable : enable} disabled={busy || !registration}>{busy ? "Saving…" : enabled ? "Turn off alerts" : "Enable alerts"}</button>}{message && <p role="status">{message}</p>}{!enabled && message.includes("Reset alerts") && <button className="text-link" onClick={disable} disabled={busy}>Reset alerts</button>}<p className="alert-footnote">Alerts depend on ESPN’s feed and your device’s notification settings. Kickoff reminders are optional.</p></div></SheetContent></Sheet>;
}
