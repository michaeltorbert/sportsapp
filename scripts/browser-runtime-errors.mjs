// Test policy only. Native cancellation provenance: microsoft/playwright#43120
// (maintainer explanation) and #42823 (runtime requestfailed observations).
// Keep raw evidence; classify no missing-request or ambiguous-document errors.
// Current recorded WebKit request: "cancelled". Installed Playwright preserves
// server _failureText in both HAR response._failureText and client failure().errorText.
export const NATIVE_CANCEL_REASON = "cancelled";
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

export function classifyRuntimeErrors(evidence) {
 const classified = [], unexpected = [];
 const urls = evidence.errors.map(error => nativeRscUrl(error, evidence.origin));
 for (const [index, error] of evidence.errors.entries()) {
  const reject = reason => unexpected.push({ ...error, reason });
  const url = urls[index];
  if (evidence.browserName !== "webkit" || !url) { reject("not_native_loopback_rsc"); continue; }
  if (urls.filter(value => value === url).length !== 1) { reject("ambiguous_errors"); continue; }
  const nav = evidence.navigations.find(row => row.id === error.navigation);
  if (!nav || nav.ambiguous || !nav.success || !nav.toEpoch || nav.fromEpoch === nav.toEpoch || error.epoch !== nav.fromEpoch || !(nav.start < nav.documentRequest && nav.documentRequest < nav.commit && nav.commit < nav.settled && nav.start < error.seq && error.seq < nav.commit)) { reject("replacement_not_proven"); continue; }
  const observer = evidence.documents.find(row => row.epoch === error.epoch);
  if (!observer || !observer.ready || observer.seq >= error.seq || observer.gap) { reject("observer_gap"); continue; }
  if (observer.frameAmbiguous) { reject("frame_ownership_ambiguous"); continue; }
  if (evidence.dom.some(row => row.epoch === error.epoch)) { reject("dom_counterpart"); continue; }
  // Completed older requests are irrelevant. Pending/failed same-URL requests
  // belonging to this outgoing activation must be unique, not guessed by time.
  const candidates = evidence.requests.filter(row => row.url === url && row.epoch === nav.fromEpoch && row.mainFrame && row.seq < nav.commit && (!row.finished || row.finished > nav.start));
  if (candidates.length !== 1) { reject("ambiguous_requests"); continue; }
  const request = candidates[0];
  if (request.method !== "GET" || request.type !== "fetch" || request.status !== null || request.failure !== NATIVE_CANCEL_REASON || !(nav.start < request.failed && request.failed < nav.commit)) { reject("cancellation_not_proven"); continue; }
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
 if (!request.mainFrame || request.method !== "GET" || request.type !== "fetch" || request.status !== null || request.failure !== NATIVE_CANCEL_REASON || !request.failed) return false;
 const observer = evidence.documents.find(row => row.epoch === request.epoch);
 return !!observer?.ready && evidence.navigations.some(nav => nav.id === error.navigation && nav.success && !nav.ambiguous && nav.fromEpoch === request.epoch && error.epoch === nav.fromEpoch && nav.toEpoch && nav.toEpoch !== nav.fromEpoch && nav.start < nav.documentRequest && nav.documentRequest < nav.commit && nav.commit < nav.settled && nav.start < error.seq && error.seq < nav.commit && nav.start < request.failed);
}
