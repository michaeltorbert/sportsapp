"use client";
import { useEffect, useRef, useState, type InputHTMLAttributes } from "react";
import { Bell, BellRing } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { usePushEnvironment } from "@/lib/browser-state";

type Config = { ready: boolean; publicKey: string; preferencesVersion?: number; sampleVersion?: number };
type Credentials = { id: string; token: string };
// Nonsecret: enough to read the same sample again, never to send one.
type SampleRecord = { testId: string; at: number; subscriptionId: string };
type Choices = { upsetWatch: boolean; closeGame: boolean; upsetFinal: boolean; kickoff: boolean };
type Status = Choices & { active: boolean; revision: number; preferencesVersion: number };
const defaults: Choices = { upsetWatch: true, closeGame: false, upsetFinal: false, kickoff: false };
const types: { key: keyof Choices; name: string; description: string }[] = [
  { key: "upsetWatch", name: "Upset watch", description: "A ranked favorite under threat in Q4 or overtime." },
  { key: "closeGame", name: "Any close game", description: "Games tied or within 8 points in Q4 or overtime. Stronger games take priority." },
  { key: "upsetFinal", name: "Upset final results", description: "A ranked team loses to an unranked or lower-ranked opponent." },
  { key: "kickoff", name: "ACC kickoff reminders", description: "10 minutes before a game involving an ACC team." },
];
function AlertSwitch({ pending, ...input }: InputHTMLAttributes<HTMLInputElement> & { pending: boolean }) {
  return <span className="alert-switch" data-pending={pending}>
    <input {...input} type="checkbox" role="switch" />
    <span className="alert-switch-face" aria-hidden="true"><span className="alert-switch-thumb"><svg className="alert-switch-check" viewBox="0 0 16 16"><path d="m4 8 3 3 5-6" /></svg></span></span>
  </span>;
}
function saved(): Credentials | null { try { const v = JSON.parse(localStorage.getItem("ss:push") || "null"); return typeof v?.id === "string" && typeof v?.token === "string" ? v : null; } catch { return null; } }
function keyBytes(v: string) { return Uint8Array.from(atob(v.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - v.length % 4) % 4)), c => c.charCodeAt(0)); }
function valid(v: Status) { return v.preferencesVersion === 1 && Number.isSafeInteger(v.revision) && v.revision >= 0 && typeof v.active === "boolean" && types.every(t => typeof v[t.key] === "boolean"); }
async function read(base: string, credentials: Credentials): Promise<Status> {
  const r = await fetch(`${base}/subscriptions/${credentials.id}`, { headers: { Authorization: `Bearer ${credentials.token}` }, credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw Error(r.status === 404 ? "This device’s saved alert access is missing. Reset alerts below, then enable again." : "Could not read alert settings.");
  const v: Status = await r.json(); if (!valid(v)) throw Error("Alert settings need a newer service version. Try again later."); return v;
}
// The service ID is the base64url SHA-256 of the normalized push endpoint.
async function endpointId(endpoint: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(new URL(endpoint).href)));
  return btoa(String.fromCharCode(...digest)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function savedSample(id: string): SampleRecord | null {
  try { const v = JSON.parse(localStorage.getItem("ss:sample") || "null"); return typeof v?.testId === "string" && Number.isFinite(v?.at) && v?.subscriptionId === id ? { testId: v.testId, at: v.at, subscriptionId: id } : null; } catch { return null; }
}
// Forget a sample the service definitely refused, unless another tab has saved a newer one.
// If removal fails the record stays, and a later readback stays conservative.
function forgetSample(sample: SampleRecord) {
  try {
    const v = JSON.parse(localStorage.getItem("ss:sample") || "null");
    if (v?.testId !== sample.testId || v?.subscriptionId !== sample.subscriptionId) return false;
    localStorage.removeItem("ss:sample"); return true;
  } catch { return false; }
}
function sampleStatusOf(v: unknown) {
  const body = v && typeof v === "object" ? v as { status?: unknown; overdue?: unknown } : {};
  const status = typeof body.status === "string" ? body.status : "";
  if ((status === "scheduled" || status === "sending") && body.overdue === true) return "overdue";
  return /^(scheduled|sending|accepted|uncertain|late|suppressed|http-\d{3})$/.test(status) ? status : "unreachable";
}
// GET only: reading a sample can never create or send one.
async function readSample(base: string, credentials: Credentials, testId: string) {
  const r = await fetch(`${base}/subscriptions/${credentials.id}/test/${testId}`, { headers: { Authorization: `Bearer ${credentials.token}` }, credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(10000) });
  if (r.status === 404) return "not-recorded";
  if (!r.ok && r.status !== 202) throw Error();
  return sampleStatusOf(await r.json());
}
const sampleOpen = ["", "scheduled", "sending", "overdue", "not-recorded", "unreachable"];
const sampleCopy: Record<string, string> = {
  posting: "Scheduling the sample…",
  scheduled: "Sample scheduled. Lock your iPhone now; it should be sent in about 10 seconds.",
  sending: "The sample is being sent now.",
  accepted: "The push service accepted the sample. That does not confirm it appeared on your iPhone or Watch.",
  uncertain: "The sample’s result is not known. It may or may not appear, and it will not be retried.",
  overdue: "No result has been recorded yet. The sample may or may not have been sent, and it will not be retried.",
  late: "The sample was not sent because the service started it too late.",
  suppressed: "The sample was not sent because this device’s alert settings changed.",
  "not-recorded": "Could not confirm a record for this sample yet. A delayed request could still deliver it; it will not be resent.",
  unreachable: "Could not check the sample’s status. It will not be resent. Reopen Alerts to check again.",
  seen: "You saw the sample. This confirms only this one sample on this device.",
};
function describeSample(status: string) {
  if (status.startsWith("refused:")) return status.slice("refused:".length);
  if (status.startsWith("http-")) return `The push service refused the sample (HTTP ${status.slice(5)}). It will not be retried.`;
  return sampleCopy[status] || "";
}
export function Alerts({ iconOnly = false }: { iconOnly?: boolean }) {
  const { ios, standalone, supported } = usePushEnvironment();
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [service, setService] = useState(""), [config, setConfig] = useState<Config | null>(null), [record, setRecord] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [pending, setPending] = useState<keyof Choices | "active" | null>(null);
  const [resetNeeded, setResetNeeded] = useState(false), [online, setOnline] = useState(true);
  const [localReady, setLocalReady] = useState(false);
  const [accessConfirmed, setAccessConfirmed] = useState(false);
  const [localId, setLocalId] = useState<string | null>(null), [sampleStatus, setSampleStatus] = useState(""), [cooling, setCooling] = useState(false), [sampleCheck, setSampleCheck] = useState(0);
  const writing = useRef(false), sequence = useRef(0), sampling = useRef(false);
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
          try {
          const details = await read(url.origin, credentials);
          const local = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration("/") : undefined;
          const subscription = await local?.pushManager.getSubscription();
          const id = subscription ? await endpointId(subscription.endpoint).catch(() => null) : null;
          if (alive && !writing.current && generation === sequence.current) {
            setLocalReady("Notification" in window && Notification.permission === "granted" && !!subscription);
            setLocalId(id);
            setRecord(previous => previous && previous.revision > details.revision ? previous : details);
            setAccessConfirmed(true); setResetNeeded(false);
            setMessage(previous => previous.includes("Could not read alert settings") || previous.includes("Reset alerts") ? "" : previous);
          }
          } catch (e) {
            if (alive && !writing.current && generation === sequence.current) {
              const text = e instanceof Error ? e.message : "Could not read alert settings.";
              setAccessConfirmed(false); setResetNeeded(text.includes("Reset alerts"));
              setMessage(text.includes("Reset alerts") ? text : "Could not read alert settings. Your saved access is unchanged; the next check will retry. No changes can be saved yet.");
            }
          }
        }
      } catch {
        if (alive && !writing.current && generation === sequence.current) { setMessage("The alert service is unavailable. Try again later."); setConfig(null); }
      } finally { checking = false; if (alive) setLoading(false); }
    };
    void check(); const timer = window.setInterval(check, 30000);
    document.addEventListener("visibilitychange", check); window.addEventListener("online", check); window.addEventListener("offline", check);
    return () => { alive = false; window.clearInterval(timer); document.removeEventListener("visibilitychange", check); window.removeEventListener("online", check); window.removeEventListener("offline", check); };
  }, []);
  // Resume, poll and cool down from the saved sample record. Reads use GET only.
  useEffect(() => {
    const credentials = saved(); if (!service || !accessConfirmed || !credentials) return;
    const record = savedSample(credentials.id); if (!record) return;
    let alive = true;
    const age = () => Date.now() - record.at;
    const cool = () => { if (alive) setCooling(age() < 60000); };
    const refresh = async () => {
      if (!alive || sampling.current || document.visibilityState === "hidden" || !navigator.onLine) return;
      let next: string; try { next = await readSample(service, credentials, record.testId); } catch { next = "unreachable"; }
      if (alive && !sampling.current) { setSampleStatus(next); setSampleCheck(n => n + 1); }
    };
    const open = sampleOpen.includes(sampleStatus);
    const timers = [window.setTimeout(cool, 0), window.setTimeout(cool, Math.max(0, 60000 - age()) + 50)];
    // A fresh page resumes a sample from the last ten minutes; active polling stops after two.
    if (open && age() < (sampleStatus ? 120000 : 600000)) timers.push(window.setTimeout(() => void refresh(), sampleStatus ? 5000 : 0));
    const visible = () => { if (open && document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", visible);
    return () => { alive = false; timers.forEach(timer => window.clearTimeout(timer)); document.removeEventListener("visibilitychange", visible); };
  }, [service, accessConfirmed, sampleStatus, sampleCheck]);
  async function sendSample() {
    const credentials = saved();
    if (!credentials || sampling.current || writing.current || !service) return;
    sampling.current = true; setSampleStatus("posting");
    try {
      const previous = savedSample(credentials.id);
      if (previous && Date.now() - previous.at < 60000) { setCooling(true); setSampleStatus("refused:Wait one minute after the previous sample. No sample was sent."); return; }
      // Recheck this installed device immediately before the one POST.
      const local = await navigator.serviceWorker.getRegistration("/");
      const current = await local?.pushManager.getSubscription();
      const id = current ? await endpointId(current.endpoint).catch(() => null) : null;
      if (!navigator.onLine) { setSampleStatus("refused:You are offline. No sample was sent."); return; }
      if (!("Notification" in window) || Notification.permission !== "granted") { setSampleStatus("refused:Notifications are not allowed on this device. No sample was sent."); return; }
      if (id !== credentials.id) { setLocalId(id); setSampleStatus("refused:This device no longer matches its saved alert subscription. No sample was sent."); return; }
      const sample: SampleRecord = { testId: crypto.randomUUID(), at: Date.now(), subscriptionId: credentials.id };
      try { localStorage.setItem("ss:sample", JSON.stringify(sample)); } catch { setSampleStatus("refused:This browser cannot save the sample status. No sample was sent."); return; }
      setCooling(true);
      let next: string, refused = false;
      try {
        const r = await fetch(`${service}/subscriptions/${credentials.id}/test`, { method: "POST", credentials: "omit", headers: { "Content-Type": "application/json", Authorization: `Bearer ${credentials.token}` }, body: JSON.stringify({ testId: sample.testId, sample: "one-score" }), signal: AbortSignal.timeout(10000) });
        const v = await r.json().catch(() => ({}));
        if (r.ok) next = sampleStatusOf(v);
        else if (r.status === 429) { next = "refused:Wait one minute after the previous test. No sample was sent."; refused = true; }
        else if (r.status === 409 && !(v && typeof v === "object" && "code" in v && v.code === "test-kind-conflict")) { next = "refused:Enable alerts on this device first. No sample was sent."; refused = true; }
        else throw Error();
      } catch {
        // Never repeat the POST. Read the same sample instead.
        try { next = await readSample(service, credentials, sample.testId); } catch { next = "unreachable"; }
      }
      // These two answers recorded nothing for this UUID, so there is nothing to read back.
      // Without the record, this attempt's one-minute lock is released here.
      if (refused && forgetSample(sample)) window.setTimeout(() => setCooling(false), Math.max(0, sample.at + 60000 - Date.now()) + 50);
      setSampleStatus(next);
    } finally { sampling.current = false; }
  }
  function start(key?: keyof Choices | "active") { if (writing.current) return false; writing.current = true; sequence.current++; setPending(key ?? null); setBusy(true); setMessage("Saving…"); return true; }
  function finish() { writing.current = false; setPending(null); setBusy(false); }
  async function update(patch: Partial<Choices> & { active?: boolean }, key: keyof Choices | "active") {
    const credentials = saved(); if (!credentials || !record || !accessConfirmed || !start(key)) return;
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
    if (!registration || !config?.ready || config.preferencesVersion !== 1 || !online || (saved() && !accessConfirmed) || (ios && !standalone) || !start("active")) return;
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
      setRecord(await read(service, stored)); setAccessConfirmed(true); setLocalReady(true); setLocalId(await endpointId(sub.endpoint).catch(() => null)); setResetNeeded(false); setMessage("Alerts are on for this device, including when the app is closed.");
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
      await (await registration?.pushManager.getSubscription())?.unsubscribe(); localStorage.removeItem("ss:push"); setRecord(null); setLocalId(null); setSampleStatus(""); setResetNeeded(false); setMessage("Alerts are off for this device.");
    } catch { setMessage("Could not reset alerts. Reconnect and try again."); } finally { finish(); }
  }
  const canEnable = supported && (!ios || standalone) && !!registration && config?.ready && config.preferencesVersion === 1 && online && (!saved() || accessConfirmed);
  // Only this installed device: its current push endpoint must hash to the saved subscription ID.
  const sampleReady = enabled && accessConfirmed && online && config?.sampleVersion === 1 && !!localId && localId === saved()?.id;
  const sampleBusy = sampleStatus === "posting" || sampleStatus === "scheduled" || sampleStatus === "sending";
  const canConfirm = ["sending", "accepted", "uncertain", "overdue", "not-recorded", "unreachable"].includes(sampleStatus);
  return <Sheet><SheetTrigger asChild><button className={iconOnly ? "icon-button alerts-trigger" : "alerts-button"} aria-label={iconOnly ? enabled ? "Alerts on" : "Alerts off" : undefined}>{enabled ? <BellRing size={16} /> : <Bell size={16} />}<span className={iconOnly ? "sr-only" : undefined}>{enabled ? "Alerts on" : iconOnly ? "Alerts off" : "Alerts"}</span></button></SheetTrigger><SheetContent side="bottom" className="help-sheet alerts-sheet"><SheetHeader><SheetTitle>Catch the game-changing moments.</SheetTitle><SheetDescription>Choose alerts for this device.</SheetDescription></SheetHeader><div className="help-body">
<label className="alert-setting"><span><strong>Notifications</strong><small id="alert-active">Turning off stops future alerts; your choices stay saved.</small></span><AlertSwitch pending={pending === "active"} aria-label="Notifications" aria-describedby="alert-active" checked={enabled} aria-disabled={busy} aria-busy={busy} disabled={!online || (!!saved() && !accessConfirmed) || (enabled ? !service : !canEnable)} onChange={e => { if (writing.current) return; if (e.target.checked) void enable(); else void update({ active: false }, "active"); }} /></label>
    {types.map(t => <label key={t.key} className="alert-setting"><span><strong>{t.name}</strong><small id={`alert-${t.key}`}>{t.description}</small></span><AlertSwitch pending={pending === t.key} aria-label={t.name} aria-describedby={`alert-${t.key}`} checked={choices[t.key]} aria-disabled={busy} aria-busy={busy} disabled={!enabled || !online || !accessConfirmed} onChange={e => { if (!writing.current) void update({ [t.key]: e.target.checked }, t.key); }} /></label>)}
    {enabled && types.every(t => !choices[t.key]) && <p role="status">No alert types are selected. You will not receive game alerts.</p>}
    {(sampleReady || (accessConfirmed && !!sampleStatus)) && <div className="alert-sample">
      <p id="alert-sample-help">Sends a made-up game alert labeled SAMPLE to this device in about 10 seconds. To check Apple Watch, lock your iPhone and keep the Watch unlocked on your wrist.</p>
      {sampleReady && <button className="solid-button alert-sample-button" aria-describedby="alert-sample-help" onClick={() => void sendSample()} disabled={busy || sampleBusy || cooling}>Send sample alert</button>}
      {sampleReady && cooling && !sampleBusy && <p className="alert-footnote">Another sample can be sent one minute after the last one.</p>}
      {sampleStatus && <p role="status">{describeSample(sampleStatus)}</p>}
      {canConfirm && <button className="text-link" onClick={() => setSampleStatus("seen")}>I saw it</button>}
    </div>}
    {ios && !standalone ? <div className="install-tip"><h3>Add to Home Screen for alerts</h3><p>In Safari, tap Share → Add to Home Screen. Keep Open as Web App enabled if offered. Open the new icon, return to Alerts, and tap Enable alerts.</p></div> : !supported ? <p>This browser does not support push alerts. Try Safari on your iPhone’s Home Screen or Chrome on Android.</p> : loading ? <p>Checking alert availability…</p> : !online ? <p>You are offline. Reconnect to save or check alert settings.</p> : !config?.ready ? <div className="install-tip"><h3>Alerts are being set up</h3><p>Live scores are available now. Background alerts will become available when setup is complete.</p></div> : config.preferencesVersion !== 1 ? <p>Alert settings need a newer service version. Try again later.</p> : !enabled && (!saved() || accessConfirmed) && !resetNeeded && <button className="solid-button alert-enable" onClick={enable} disabled={busy || !registration || !canEnable}>Enable alerts</button>}
    {message && <p role="status">{message}</p>}{resetNeeded && <button className="text-link" onClick={reset} disabled={busy}>Reset alerts</button>}
    <p className="alert-footnote">Duke alerts stay off. Scoreboard filters do not affect alerts.</p>
    <details className="alert-details"><summary>How alerts work</summary>
      <p>Game alerts are off when ESPN confirms both teams are unranked and from Group-of-Six conferences. Unknown rankings or conferences do not count as confirmed.</p>
      <p>Close games and upset watch share at most one live notification attempt per game; optional finals are separate.</p>
      <p>New selections start from the next successful score check and do not replay current or past conditions. A notification already sent cannot be recalled.</p>
      <p>Upset watch requires a ranked pregame favorite of 7+ points. Without a line, it uses a ranked team against a confirmed unranked opponent, or a rank gap of 10+. Pick’em and conflicting expectations do not qualify.</p>
      <p>Upset watch looks for a meaningful threat to a ranked favorite in Q4 or overtime, including ties and an underdog within 8 points.</p>
      <p>Scoreboard categories do not filter notifications. Alerts depend on ESPN’s feed and the device’s settings.</p>
    </details>
  </div></SheetContent></Sheet>;
}
