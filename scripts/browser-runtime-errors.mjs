// Test policy only. Native cancellation provenance: microsoft/playwright#43120
// (maintainer explanation) and #42823 (runtime requestfailed observations).
// Keep raw evidence. The separately named zero-request diagnostic requires
// current-platform native-control qualification before its results count.
// Recorded WebKit reasons differ across executed local and CI controls.
// Installed Playwright preserves
// server _failureText in both HAR response._failureText and client failure().errorText.
export const NATIVE_CANCEL_REASONS = Object.freeze(["cancelled", "Load request cancelled"]);
export function nativeRscUrl(error, origin) {
 if (error.name !== "Fetch API cannot load http") return null;
 const first = error.stack?.split("\n")[0];
 const match = /^Fetch API cannot load (http:\/\/\S+) due to access control checks\.$/.exec(first ?? "");
 if (!match || error.message !== `${match[1].slice(6)} due to access control checks.`) return null;
 try {
  const url = new URL(match[1]), base = new URL(origin);
  if (url.href !== match[1] || url.origin !== base.origin || url.username || url.password || url.hash || base.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname)) return null;
  if (!["/.rsc", "/guide.rsc", "/leaders.rsc"].includes(url.pathname)) return null;
  return url.href;
 } catch { return null; }
}

// #181 completed-read diagnostic (agreed bounded plan). Reachable ONLY for WebKit on a RECORDED darwin/arm64
// host (observeRuntimeErrors records process.platform/process.arch); missing, synthetic, Linux, x64 or any
// other host keeps the original completed-read rejection. It is a limited observable diagnostic that a run
// may rely on only with a matching FINAL-PASS same-run native control (enforced by server-exit-reporter.mjs).
export const COMPLETED_READ_LABEL = "native_completed_read_rsc_diagnostic";
export const COMPLETED_READ_USAGE_ANNOTATION = "ss181-completed-read-diagnostic-usage";
export const COMPLETED_READ_CONTROL_ANNOTATION = "ss181-completed-read-control-qualified";
export const COMPLETED_READ_CONTROL_TITLE = "held replacement boundary: native after completed same-epoch read";
export const COMPLETED_READ_IDENTITY_KEYS = Object.freeze(["browser", "hostPlatform", "hostArchitecture", "engineVersion", "sourceCommit", "browserRunId", "browserTestSourcesHash"]);
const positiveSeq = value => Number.isFinite(value) && value > 0;
// Returns the single prior completed row, or null (then the caller's existing logic is unchanged).
function completedReadBaseline(evidence, error, url, nav) {
 if (evidence.browserName !== "webkit" || evidence.hostPlatform !== "darwin" || evidence.hostArchitecture !== "arm64") return null;
 if (!(nav.documentRequest < error.seq)) return null;
 const exact = evidence.requests.filter(row => row.url === url);
 // An exact-URL row whose owner is unknown cannot be excluded from "no new owning-epoch row".
 if (exact.some(row => typeof row.epoch !== "string" || !row.epoch)) return null;
 const owned = exact.filter(row => row.epoch === nav.fromEpoch);
 if (owned.length !== 1) return null;
 const row = owned[0];
 if (row.mainFrame !== true || row.method !== "GET" || row.type !== "fetch" || row.status !== 200 || row.failed !== null || row.failure !== null) return null;
 if (![row.seq, row.response, row.finished, nav.start].every(positiveSeq) || !(row.seq < row.response && row.response < row.finished && row.finished < nav.start)) return null;
 const target = new URL(url);
 const queryConflict = evidence.requests.some(other => {
  if (other.epoch !== nav.fromEpoch) return false;
  try {
   const requestUrl = new URL(other.url);
   return requestUrl.origin === target.origin && requestUrl.pathname === target.pathname && other.url !== url;
  } catch { return false; }
 });
 return queryConflict ? null : row;
}

export function classifyRuntimeErrors(evidence) {
 const classified = [], unexpected = [];
 const urls = evidence.errors.map(error => nativeRscUrl(error, evidence.origin));
 for (const [index, error] of evidence.errors.entries()) {
  const reject = reason => unexpected.push({ ...error, reason });
  const url = urls[index];
  if (evidence.browserName !== "webkit" || !url) { reject("not_native_loopback_rsc"); continue; }
  // Uniqueness is per URL within the error's own non-empty owning epoch (not per whole test, not per
  // navigation id alone). Another same-URL error in the same epoch, or any same-URL error whose epoch is
  // unknown/empty (in either direction), keeps it ambiguous. All later guards are unchanged.
  const own = typeof error.epoch === "string" && error.epoch ? error.epoch : null;
  if (evidence.errors.some((other, j) => j !== index && urls[j] === url && (!own || typeof other.epoch !== "string" || !other.epoch || other.epoch === own))) { reject("ambiguous_errors"); continue; }
  const nav = evidence.navigations.find(row => row.id === error.navigation);
  if (!nav || nav.ambiguous || !nav.success || typeof nav.fromEpoch !== "string" || !nav.fromEpoch || typeof nav.toEpoch !== "string" || !nav.toEpoch || nav.fromEpoch === nav.toEpoch || error.epoch !== nav.fromEpoch || !(nav.start < nav.documentRequest && nav.documentRequest < nav.commit && nav.commit < nav.settled && nav.start < error.seq && error.seq < nav.commit)) { reject("replacement_not_proven"); continue; }
  const observer = evidence.documents.find(row => row.epoch === error.epoch);
  if (!observer || !observer.ready || observer.seq >= error.seq || observer.gap) { reject("observer_gap"); continue; }
  if (observer.frameAmbiguous) { reject("frame_ownership_ambiguous"); continue; }
  if (evidence.dom.some(row => row.epoch === error.epoch)) { reject("dom_counterpart"); continue; }
  const sameEpochRows = evidence.requests.filter(row => row.url === url && row.epoch === nav.fromEpoch);
  if (sameEpochRows.length === 0) {
   const target = new URL(url);
   const queryConflict = evidence.requests.some(row => {
    if (row.epoch !== nav.fromEpoch) return false;
    try {
     const requestUrl = new URL(row.url);
     return requestUrl.origin === target.origin && requestUrl.pathname === target.pathname && row.url !== url;
    } catch { return false; }
   });
   if (queryConflict) { reject("same_epoch_query_conflict"); continue; }
   if (!(nav.documentRequest < error.seq)) { reject("replacement_phase_not_proven"); continue; }
   classified.push({ errorId: error.id, requestId: null, navigationId: nav.id, epoch: error.epoch, url,
    classification: "native_replacement_rsc_diagnostic", publicRequestEvents: 0,
    qualification: "requires_actual_current_platform_control",
    causalLimit: "No same-activation public Request event; individual cancellation and server ingress are not established." });
   continue;
  }
  // Completed older requests are irrelevant. Pending/failed same-URL requests
  // belonging to this outgoing activation must be unique, not guessed by time.
  const candidates = evidence.requests.filter(row => row.url === url && row.epoch === nav.fromEpoch && row.mainFrame && row.seq < nav.commit && (!row.finished || row.finished > nav.start));
  // Only when there is NO active candidate (so a unique in-window request-proven cancellation is never
  // intercepted). Any completed-read veto leaves the existing ambiguous_requests result exactly as before.
  const baseline = candidates.length === 0 ? completedReadBaseline(evidence, error, url, nav) : null;
  if (baseline) {
   classified.push({ errorId: error.id, requestId: null, navigationId: nav.id, epoch: error.epoch, url,
    classification: COMPLETED_READ_LABEL,
    priorCompletedRequests: [{ requestId: baseline.id, status: baseline.status, finished: baseline.finished }],
    owningEpochExactUrlRequestEvents: 1, newOwningEpochExactUrlRequestEventsAfterReplacementStart: 0,
    qualification: "requires_same_run_final_pass_darwin_arm64_webkit_completed_read_control",
    causalLimit: "One prior successful same-activation public request completed before replacement; no new exact-URL public Request event was observed after replacement started. Individual diagnostic cause, request cancellation and server ingress are not established." });
   continue;
  }
  if (candidates.length !== 1) { reject("ambiguous_requests"); continue; }
  const request = candidates[0];
  if (request.method !== "GET" || request.type !== "fetch" || request.status !== null || !NATIVE_CANCEL_REASONS.includes(request.failure) || !(nav.start < request.failed && request.failed < nav.commit)) { reject("cancellation_not_proven"); continue; }
  classified.push({ errorId: error.id, requestId: request.id, navigationId: nav.id, epoch: error.epoch, url, classification: "native_obsolete_document_rsc_cancellation" });
 }
 return { classified, unexpected };
}

// Collection-control verdict only, NOT an exemption in the ordinary harness.
// A late failure observation can leave the synthetic race inconclusive only with
// its unique actual cancellation/replacement and no genuine-error evidence.
export function incompleteNativeControl(error, evidence) {
 const url = nativeRscUrl(error, evidence.origin);
 if (evidence.browserName !== "webkit" || !url || evidence.dom.length || evidence.documents.some(row => row.gap || row.frameAmbiguous)) return false;
 if (evidence.errors.filter(row => nativeRscUrl(row, evidence.origin) === url).length !== 1) return false;
 const matching = evidence.requests.filter(row => row.url === url);
 if (matching.length !== 1) return false;
 const request = matching[0];
 if (!request.mainFrame || request.method !== "GET" || request.type !== "fetch" || request.status !== null || !NATIVE_CANCEL_REASONS.includes(request.failure) || !request.failed) return false;
 const observer = evidence.documents.find(row => row.epoch === request.epoch);
 return !!observer?.ready && evidence.navigations.some(nav => nav.id === error.navigation && nav.success && !nav.ambiguous && nav.fromEpoch === request.epoch && error.epoch === nav.fromEpoch && nav.toEpoch && nav.toEpoch !== nav.fromEpoch && nav.start < nav.documentRequest && nav.documentRequest < nav.commit && nav.commit < nav.settled && nav.start < error.seq && error.seq < nav.commit && nav.start < request.failed);
}
