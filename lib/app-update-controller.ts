import { metadata, observe, validCommit, type Candidate } from "./app-update";
export type UpdateState = { target: string | null; status: string; refreshing: boolean };
export function createAppUpdater(loadedValue: string | undefined, publish: (state: UpdateState) => void, navigate: (commit: string) => void) {
  const loaded = validCommit(loadedValue);
  let alive = true, candidate: Candidate = null, confirmed: string | null = null, busy = false, manualCandidate = "";
  const dismissed = new Set<string>();
  let state: UpdateState = { target: null, status: loaded ? "" : "App update checking is unavailable for this build.", refreshing: false };
  let flight: Promise<ReturnType<typeof metadata>> | null = null, controller: AbortController | null = null;
  let last = -Infinity, scheduled: ReturnType<typeof setTimeout> | undefined, confirmation: ReturnType<typeof setTimeout> | undefined;
  let manualPending = false, manualFeedback = false;
  let requestSequence = 0, handledSequence = 0;
  let navigationRecovery: ReturnType<typeof setTimeout> | undefined;
  const available = () => !document.hidden && navigator.onLine;
  const emit = (patch: Partial<UpdateState>) => { if (alive) { state = { ...state, ...patch }; publish(state); } };
  try { const saved: unknown = JSON.parse(sessionStorage.getItem("ss:app-update-dismissed") || "[]"); if (Array.isArray(saved)) for (const item of saved) { const commit = validCommit(item); if (commit) dismissed.add(commit); } } catch { /* Tab-local fallback. */ }
  const request = () => {
    if (flight) return flight;
    const c = new AbortController(); controller = c; last = Date.now(); requestSequence++;
    const timeout = setTimeout(() => c.abort(), 10_000);
    flight = (async () => {
      try {
        const response = await fetch("/api/health", { cache: "no-store", signal: c.signal });
        if (!response.ok) return null;
        const result = metadata(await response.json());
        return alive && !c.signal.aborted ? result : null;
      } catch { return null; }
      finally { clearTimeout(timeout); if (controller === c) { controller = null; flight = null; } }
    })();
    return flight;
  };
  function accept(result: NonNullable<ReturnType<typeof metadata>>, manual: boolean) {
    if (!alive || !loaded) return;
    if (candidate?.commit !== result.commit) manualCandidate = "";
    if (manual) manualCandidate = result.commit;
    candidate = observe(candidate, loaded, result.commit, Date.now());
    clearTimeout(confirmation); confirmation = undefined;
    if (manual) manualFeedback = true;
    if (!candidate) {
      confirmed = null;
      emit({ target: null, status: manualFeedback || state.target ? "The app is up to date." : "" });
      manualFeedback = false; return;
    }
    if (candidate.confirmed) {
      confirmed = candidate.commit;
      if (manualCandidate === confirmed) { dismissed.delete(confirmed); try { sessionStorage.setItem("ss:app-update-dismissed", JSON.stringify([...dismissed])); } catch { /* Optional. */ } }
      emit({ target: dismissed.has(confirmed) ? null : confirmed, status: dismissed.has(confirmed) ? "" : "An app update is available." });
      manualFeedback = false;
    } else {
      emit({ status: manualFeedback ? "An app update is being verified." : "" });
      confirmation = setTimeout(() => { confirmation = undefined; void check(); }, Math.max(0, candidate.since + 10_000 - Date.now()));
    }
  }
  async function check(manual = false) {
    if (!alive || busy) return;
    if (!loaded) { emit({ status: "App update checking is unavailable for this build." }); return; }
    if (!available()) { if (manual) emit({ status: "Unable to check for an app update. Reconnect and return to the app." }); return; }
    if (manual) { manualPending = true; manualFeedback = true; emit({ status: "Checking for an app update…" }); }
    if (!flight && Date.now() - last < 2000) {
      if (!scheduled) scheduled = setTimeout(() => { scheduled = undefined; void check(manualPending); }, 2000 - (Date.now() - last));
      return;
    }
    const pending = request(), sequence = requestSequence;
    const result = await pending;
    if (!alive || busy || sequence === handledSequence) return;
    handledSequence = sequence;
    const requested = manualPending; manualPending = false;
    if (result) accept(result, requested);
    else {
      emit({ status: requested || manualFeedback ? "Unable to check for an app update. Please try again." : "" });
      manualFeedback = false;
    }
  }
  async function refresh() {
    if (!alive || busy || !loaded) return;
    busy = true; manualPending = false; manualFeedback = false; manualCandidate = ""; clearTimeout(scheduled); scheduled = undefined; clearTimeout(confirmation); confirmation = undefined;
    emit({ refreshing: true, status: "Verifying the app update…" });
    try {
      if (flight) await flight;
      if (!alive) return;
      if (!available()) throw new Error("Unavailable");
      const result = await request();
      if (!alive) return;
      if (!result || !available()) throw new Error("Unavailable");
      if (result.commit === loaded) accept(result, true);
      else {
        navigate(result.commit);
        // If the document stays open (for example, cancelled navigation), permit
        // a later explicit retry. This timer never starts navigation itself.
        navigationRecovery = setTimeout(() => {
          navigationRecovery = undefined; busy = false;
          emit({ refreshing: false, status: "The app is still open. Refresh did not finish. You can try again." });
        }, 15_000);
        return;
      }
    } catch { emit({ status: "Refresh could not be verified. Your current app is still open. Please try again." }); }
    busy = false; emit({ refreshing: false });
  }
  const resume = () => { if (available()) void check(); };
  const pageshow = (event: PageTransitionEvent) => { if (event.persisted) resume(); };
  window.addEventListener("focus", resume); window.addEventListener("online", resume); window.addEventListener("pageshow", pageshow);
  document.addEventListener("visibilitychange", resume);
  const initial = setTimeout(resume, 3000), interval = setInterval(resume, 300_000);
  emit({});
  return {
    check: () => check(true), refresh,
    dismiss() { if (!confirmed || busy) return; dismissed.add(confirmed); manualCandidate = ""; manualFeedback = false; try { sessionStorage.setItem("ss:app-update-dismissed", JSON.stringify([...dismissed])); } catch { /* Optional. */ } emit({ target: null, status: "" }); },
    dispose() { alive = false; controller?.abort(); clearTimeout(navigationRecovery); clearTimeout(initial); clearInterval(interval); clearTimeout(scheduled); clearTimeout(confirmation); window.removeEventListener("focus", resume); window.removeEventListener("online", resume); window.removeEventListener("pageshow", pageshow); document.removeEventListener("visibilitychange", resume); },
  };
}
