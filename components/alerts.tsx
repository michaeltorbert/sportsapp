"use client";
import { useEffect, useRef, useState } from "react";
import { Bell, BellRing } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { usePushEnvironment } from "@/lib/browser-state";

type Config = { ready: boolean; publicKey: string; preferencesVersion?: number };
type Credentials = { id: string; token: string };
type Choices = { upsetWatch: boolean; closeGame: boolean; upsetFinal: boolean; kickoff: boolean };
type Status = Choices & { active: boolean; revision: number; preferencesVersion: number };
const defaults: Choices = { upsetWatch: true, closeGame: false, upsetFinal: false, kickoff: false };
const types: { key: keyof Choices; name: string; description: string }[] = [
  { key: "upsetWatch", name: "Upset watch", description: "A meaningful threat to a ranked favorite in Q4 or overtime, including ties and an underdog within 8 points." },
  { key: "closeGame", name: "Any close game", description: "Any game tied or within 8 points in Q4 or overtime." },
  { key: "upsetFinal", name: "Upset final results", description: "A ranked team loses to an unranked or lower-ranked opponent. A separate result alert." },
  { key: "kickoff", name: "ACC kickoff reminders", description: "10 minutes before a game involving an ACC team." },
];
function saved(): Credentials | null { try { const v = JSON.parse(localStorage.getItem("ss:push") || "null"); return typeof v?.id === "string" && typeof v?.token === "string" ? v : null; } catch { return null; } }
function keyBytes(v: string) { return Uint8Array.from(atob(v.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - v.length % 4) % 4)), c => c.charCodeAt(0)); }
function valid(v: Status) { return v.preferencesVersion === 1 && Number.isSafeInteger(v.revision) && v.revision >= 0 && typeof v.active === "boolean" && types.every(t => typeof v[t.key] === "boolean"); }
async function read(base: string, credentials: Credentials): Promise<Status> {
  const r = await fetch(`${base}/subscriptions/${credentials.id}`, { headers: { Authorization: `Bearer ${credentials.token}` }, credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw Error(r.status === 404 ? "This device’s saved alert access is missing. Reset alerts below, then enable again." : "Could not read alert settings.");
  const v: Status = await r.json(); if (!valid(v)) throw Error("Alert settings need a newer service version. Try again later."); return v;
}
export function Alerts() {
  const { ios, standalone, supported } = usePushEnvironment();
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [service, setService] = useState(""), [config, setConfig] = useState<Config | null>(null), [record, setRecord] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [resetNeeded, setResetNeeded] = useState(false), [online, setOnline] = useState(true);
  const [localReady, setLocalReady] = useState(false);
  const writing = useRef(false), sequence = useRef(0);
  const enabled = !!record?.active && localReady, choices = record || defaults;
  useEffect(() => {
    let alive = true, checking = false;
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).then(() => navigator.serviceWorker.ready).then(r => { if (alive) setRegistration(r); }).catch(() => { if (alive) setMessage("Alert setup could not load. Try reopening the app."); });
    const check = async () => {
      setOnline(navigator.onLine);
      if (checking || writing.current || document.visibilityState === "hidden" || !navigator.onLine) { if (alive) setLoading(false); return; }
      checking = true; const generation = sequence.current;
      try {
        const r = await fetch("/alerts-config.json", { cache: "no-store", signal: AbortSignal.timeout(10000) });
        const settings: { serviceUrl?: string } = await r.json(); if (!settings.serviceUrl) return;
        const url = new URL(settings.serviceUrl); if (url.protocol !== "https:") return;
        const response = await fetch(`${url.origin}/config`, { credentials: "omit", signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw Error(); const state: Config = await response.json();
        if (!alive || writing.current || generation !== sequence.current) return;
        setService(url.origin); setConfig(state);
        setMessage(previous => previous === "The alert service is unavailable. Try again later." ? "" : previous);
        const credentials = saved();
        if (credentials) {
          const details = await read(url.origin, credentials);
          const local = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration("/") : undefined;
          const subscription = await local?.pushManager.getSubscription();
          if (alive && !writing.current && generation === sequence.current) {
            setLocalReady("Notification" in window && Notification.permission === "granted" && !!subscription);
            setRecord(previous => previous && previous.revision > details.revision ? previous : details);
          }
        }
      } catch (e) {
        if (alive && !writing.current && generation === sequence.current) { const text = e instanceof Error && e.message.includes("Reset alerts") ? e.message : "The alert service is unavailable. Try again later."; setMessage(text); setResetNeeded(text.includes("Reset alerts")); setConfig(null); }
      } finally { checking = false; if (alive) setLoading(false); }
    };
    void check(); const timer = window.setInterval(check, 30000);
    document.addEventListener("visibilitychange", check); window.addEventListener("online", check); window.addEventListener("offline", check);
    return () => { alive = false; window.clearInterval(timer); document.removeEventListener("visibilitychange", check); window.removeEventListener("online", check); window.removeEventListener("offline", check); };
  }, []);
  function start() { if (writing.current) return false; writing.current = true; sequence.current++; setBusy(true); setMessage("Saving…"); return true; }
  function finish() { writing.current = false; setBusy(false); }
  async function update(patch: Partial<Choices> & { active?: boolean }) {
    const credentials = saved(); if (!credentials || !record || !start()) return;
    try {
      const r = await fetch(`${service}/subscriptions/${credentials.id}`, { method: "PATCH", credentials: "omit", headers: { "Content-Type": "application/json", Authorization: `Bearer ${credentials.token}` }, body: JSON.stringify({ ...patch, revision: record.revision }), signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw Error(); const v: Status = await r.json(); if (!valid(v)) throw Error();
      setRecord(v); setMessage(v.active ? "Saved for this device." : "Alerts are off for this device. Your type choices are saved.");
    } catch {
      try { setRecord(await read(service, credentials)); setMessage("Settings checked with the service. Review your choices before trying again."); }
      catch { setMessage("Could not confirm the save. Showing the last confirmed choices; reconnect to check before trying again."); }
    } finally { finish(); }
  }
  async function enable() {
    if (!registration || !config?.ready || config.preferencesVersion !== 1 || !online || (ios && !standalone) || !start()) return;
    try {
      // Keep the permission request directly in the user gesture before any network await.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setMessage("Alerts are blocked. You can allow them in your device’s notification settings."); return; }
      const existing = await registration.pushManager.getSubscription();
      const sub = existing || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(config.publicKey) });
      const credentials = saved();
      const r = await fetch(`${service}/subscriptions`, { method: "POST", credentials: "omit", headers: { "Content-Type": "application/json", ...(credentials ? { Authorization: `Bearer ${credentials.token}` } : {}) }, body: JSON.stringify({ subscription: sub.toJSON(), ...Object.fromEntries(types.map(t => [t.key, choices[t.key]])), ...(record ? { revision: record.revision } : {}) }), signal: AbortSignal.timeout(10000) });
      if (!r.ok) {
        const failure = await r.json().catch(() => ({}));
        const code = failure && typeof failure === "object" && "code" in failure ? failure.code : undefined;
        if (r.status === 409 && code === "revision-conflict") {
          setResetNeeded(false);
          try { if (credentials) setRecord(await read(service, credentials)); setMessage("Settings changed on the service. Review the reloaded choices, then try again."); }
          catch { setMessage("Settings changed on the service. Could not reload them; reconnect and review before trying again."); }
          return;
        }
        throw Error(r.status === 409 && code === "ownership-conflict" ? "This device’s saved alert access is missing. Reset alerts below, then enable again." : "Could not save alerts. Please try again.");
      }
      const stored: Credentials = await r.json();
      try { localStorage.setItem("ss:push", JSON.stringify(stored)); } catch { await sub.unsubscribe(); throw Error("This browser cannot save alert settings. Allow website storage and try again."); }
      setRecord(await read(service, stored)); setLocalReady(true); setResetNeeded(false); setMessage("Alerts are on for this device, including when the app is closed.");
    } catch (e) {
      const text = e instanceof Error ? e.message : "Could not enable alerts."; const credentials = saved();
      if (credentials) { try { setRecord(await read(service, credentials)); } catch { /* Last confirmed state remains visible. */ } }
      setMessage(text); setResetNeeded(text.includes("Reset alerts"));
    } finally { finish(); }
  }
  async function reset() {
    if (!start()) return;
    try {
      const credentials = saved();
      if (credentials) { const r = await fetch(`${service}/subscriptions/${credentials.id}`, { method: "DELETE", credentials: "omit", headers: { Authorization: `Bearer ${credentials.token}` }, signal: AbortSignal.timeout(10000) }); if (!r.ok && r.status !== 404) throw Error(); }
      await (await registration?.pushManager.getSubscription())?.unsubscribe(); localStorage.removeItem("ss:push"); setRecord(null); setResetNeeded(false); setMessage("Alerts are off for this device.");
    } catch { setMessage("Could not reset alerts. Reconnect and try again."); } finally { finish(); }
  }
  const canEnable = supported && (!ios || standalone) && !!registration && config?.ready && config.preferencesVersion === 1 && online;
  return <Sheet><SheetTrigger asChild><button className="alerts-button">{enabled ? <BellRing size={16} /> : <Bell size={16} />}<span>{enabled ? "Alerts on" : "Alerts"}</span></button></SheetTrigger><SheetContent side="bottom" className="help-sheet"><SheetHeader><SheetTitle>Catch the game-changing moments.</SheetTitle><SheetDescription>Choose alerts for this device.</SheetDescription></SheetHeader><div className="help-body">
<label className="alert-setting"><span><strong>Notifications</strong><small>Off keeps your choices. A notification already sent cannot be recalled.</small></span><input role="switch" aria-label="Notifications" type="checkbox" checked={enabled} aria-disabled={busy} aria-busy={busy} disabled={!online || (enabled ? !service : !canEnable)} onChange={e => { if (writing.current) return; if (e.target.checked) void enable(); else void update({ active: false }); }} /></label>
    {types.map(t => <label key={t.key} className="alert-setting"><span><strong>{t.name}</strong><small id={`alert-${t.key}`}>{t.description}</small></span><input role="switch" aria-label={t.name} aria-describedby={`alert-${t.key}`} type="checkbox" checked={choices[t.key]} aria-disabled={busy} aria-busy={busy} disabled={!enabled || !online} onChange={e => { if (!writing.current) void update({ [t.key]: e.target.checked }); }} /></label>)}
    {enabled && types.every(t => !choices[t.key]) && <p>No alert types are selected. You will not receive game alerts.</p>}
    {ios && !standalone ? <div className="install-tip"><h3>Add to Home Screen for alerts</h3><p>In Safari, tap Share → Add to Home Screen. Keep Open as Web App enabled if offered. Open the new icon, return to Alerts, and tap Enable alerts.</p></div> : !supported ? <p>This browser does not support push alerts. Try Safari on your iPhone’s Home Screen or Chrome on Android.</p> : loading ? <p>Checking alert availability…</p> : !online ? <p>You are offline. Reconnect to save or check alert settings.</p> : !config?.ready ? <div className="install-tip"><h3>Alerts are being set up</h3><p>Live scores are available now. Background alerts will become available when setup is complete.</p></div> : config.preferencesVersion !== 1 ? <p>Alert settings need a newer service version. Try again later.</p> : !enabled && <button className="solid-button alert-enable" onClick={enable} disabled={busy || !registration}>Enable alerts</button>}
    {message && <p role="status">{message}</p>}{resetNeeded && <button className="text-link" onClick={reset} disabled={busy}>Reset alerts</button>}
    <p className="alert-footnote">Alerts cover all qualifying games. Scoreboard tabs do not filter notifications. Close games and upset watch share at most one live notification attempt per game; optional finals are separate. New selections start from the next successful score check and do not replay current or past conditions.</p>
    <p className="alert-footnote">Upset watch requires a ranked pregame favorite of 7+ points. Without a line, it uses a ranked team against a confirmed unranked opponent, or a rank gap of 10+. Pick’em and conflicting expectations do not qualify. Alerts depend on ESPN’s feed and your device’s settings.</p>
  </div></SheetContent></Sheet>;
}
