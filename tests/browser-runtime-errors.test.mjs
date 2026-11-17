import test from "node:test";
import assert from "node:assert/strict";
import { classifyRuntimeErrors, nativeRscUrl, NATIVE_CANCEL_REASONS, incompleteNativeControl } from "../scripts/browser-runtime-errors.mjs";

const origin = "http://127.0.0.1:4837", url = `${origin}/.rsc?_rsc=KsQaSH2L7Z4e6Q5N`;
function evidence() {
 return {
  browserName: "webkit", origin, hostPlatform: "synthetic",
  errors: [{ id: 1, seq: 9, epoch: "old", navigation: 1, name: "Fetch API cannot load http", message: `${url.slice(6)} due to access control checks.`, stack: `Fetch API cannot load ${url} due to access control checks.\n    at unknown (http://127.0.0.1:4837/assets/types.js:2:1)` }],
  documents: [{ epoch: "old", ready: true, seq: 1, gap: false }], dom: [],
  requests: [{ id: 1, seq: 7, epoch: "old", mainFrame: true, url, method: "GET", type: "fetch", status: null, failure: NATIVE_CANCEL_REASONS[0], failed: 8, finished: null }],
  navigations: [{ id: 1, start: 5, fromEpoch: "old", toEpoch: "new", documentRequest: 6, commit: 10, settled: 11, success: true }],
 };
}
test("recorded native shape plus unique obsolete-document cancellation qualifies without mutating raw evidence", () => {
 const raw = evidence(), before = JSON.stringify(raw), result = classifyRuntimeErrors(raw);
 assert.equal(result.classified.length, 1); assert.equal(result.unexpected.length, 0);
 assert.equal(result.classified[0].requestId, 1); assert.equal(JSON.stringify(raw), before);
 assert.equal(nativeRscUrl(raw.errors[0], origin), url);
});

const negatives = {
 "wrong engine": e => { e.browserName = "chromium"; },
 "generic name": e => { e.errors[0].name = "TypeError"; },
 "malformed native message": e => { e.errors[0].message += " extra"; },
 "HTTPS unverified": e => { e.errors[0].name = "Fetch API cannot load https"; },
 "foreign origin": e => { e.origin = "http://localhost:4837"; },
 "wrong query": e => { e.requests[0].url += "x"; },
 "API path": e => { const old = e.errors[0]; old.stack = old.stack.replace("/.rsc?", "/api/player?"); old.message = old.message.replace("/.rsc?", "/api/player?"); },
 "credentials": e => { const old = e.errors[0]; old.stack = old.stack.replace("127.0.0.1", "user@127.0.0.1"); old.message = old.message.replace("127.0.0.1", "user@127.0.0.1"); },
 "wrong method": e => { e.requests[0].method = "POST"; },
 "wrong resource": e => { e.requests[0].type = "document"; },
 "subframe": e => { e.requests[0].mainFrame = false; },
 "zero request before actual replacement request": e => { e.requests = []; e.errors[0].seq = 6; e.navigations[0].documentRequest = 7; },
 "unknown runtime reason": e => { e.requests[0].failure = "ERR_ABORTED"; },
 "no failure": e => { e.requests[0].failed = null; },
 "HTTP policy denial": e => { e.requests[0].status = 403; },
 "successful response conflict": e => { e.requests[0].status = 200; },
 "no replacement": e => { e.navigations = []; },
 "same document": e => { e.navigations[0].toEpoch = "old"; },
 "failed destination": e => { e.navigations[0].success = false; },
 "no document request": e => { e.navigations[0].documentRequest = null; },
 "overlapping navigation": e => { e.navigations[0].ambiguous = true; },
 "new document diagnostic": e => { e.errors[0].epoch = "new"; },
 "missing outgoing epoch": e => { e.errors[0].epoch = null; e.navigations[0].fromEpoch = null; e.documents[0].epoch = null; },
 "postcommit error": e => { e.errors[0].seq = 12; },
 "postcommit failure": e => { e.requests[0].failed = 12; },
 "old unmatched failure": e => { e.requests[0].failed = 4; },
 "duplicate request": e => { e.requests.push({ ...e.requests[0], id: 2 }); },
 "duplicate errors": e => { e.errors.push({ ...e.errors[0], id: 2 }); },
 "observer gap": e => { e.documents[0].gap = true; },
 "subframe ownership ambiguity despite otherwise qualifying main request": e => { e.documents[0].frameAmbiguous = true; },
 "observer not ready": e => { e.documents = []; },
 "genuine native-looking throw": e => { e.dom.push({ epoch: "old", kind: "error", seq: 9, message: e.errors[0].message }); },
 "unhandled rejection counterpart": e => { e.dom.push({ epoch: "old", kind: "unhandledrejection", seq: 9 }); },
};
for (const [name, mutate] of Object.entries(negatives)) test(`fails closed: ${name}`, () => {
 const raw = evidence(); mutate(raw); const result = classifyRuntimeErrors(raw);
 assert.equal(result.classified.length, 0); assert.equal(result.unexpected.length, raw.errors.length);
});

test("earlier completed same-URL reads do not fabricate cancellation ambiguity", () => {
 const raw = evidence(); raw.requests.unshift({ ...raw.requests[0], id: 2, seq: 2, finished: 3, failed: null, status: 200 });
 assert.equal(classifyRuntimeErrors(raw).classified.length, 1);
});

test("cancellation collection control rejects unrelated/genuine errors instead of calling them inconclusive", () => {
 const raw = evidence(); raw.requests[0].failed = 12;
 assert.equal(classifyRuntimeErrors(raw).unexpected.length, 1);
 assert.equal(incompleteNativeControl(raw.errors[0], raw), true); // Exact outgoing native diagnostic with late failure observation; ordinary harness still fails it.
 const generic = { ...raw.errors[0], name: "Error", message: "deliberate genuine error", stack: "Error: deliberate genuine error" };
 assert.equal(incompleteNativeControl(generic, raw), false);
 raw.dom.push({ epoch: "old", kind: "error", message: raw.errors[0].message });
 assert.equal(incompleteNativeControl(raw.errors[0], raw), false);
 raw.dom = []; raw.documents[0].frameAmbiguous = true;
 assert.equal(incompleteNativeControl(raw.errors[0], raw), false);
 raw.documents[0].frameAmbiguous = false; raw.requests[0].status = 403;
 assert.equal(incompleteNativeControl(raw.errors[0], raw), false);
});

test("only the two executed native failure values qualify actual-request cancellation", () => {
 for (const reason of NATIVE_CANCEL_REASONS) {
  const raw = evidence(); raw.requests[0].failure = reason;
  assert.equal(classifyRuntimeErrors(raw).classified[0].classification, "native_obsolete_document_rsc_cancellation");
 }
 for (const reason of ["aborted", "CANCELLED", "request cancelled", "net::ERR_ABORTED", "failed"]) {
  const raw = evidence(); raw.requests[0].failure = reason;
  assert.equal(classifyRuntimeErrors(raw).unexpected.length, 1);
 }
});

test("zero ALL owning-epoch request rows is a distinct provisional diagnostic, never invented cancellation proof", () => {
 const raw = evidence(); raw.requests = []; const before = JSON.stringify(raw);
 const result = classifyRuntimeErrors(raw);
 assert.equal(result.unexpected.length, 0); assert.equal(result.classified.length, 1);
 assert.equal(result.classified[0].classification, "native_replacement_rsc_diagnostic");
 assert.equal(result.classified[0].requestId, null);
 assert.equal(result.classified[0].qualification, "requires_actual_current_platform_control");
 assert.equal(result.classified[0].publicRequestEvents, 0);
 assert.equal(JSON.stringify(raw), before);
});

test("prior and future activation requests are not borrowed as zero-event causal evidence", () => {
 const raw = evidence(); raw.requests[0].epoch = "prior";
 raw.requests.push({ ...raw.requests[0], id: 2, epoch: "future", status: 200 });
 const result = classifyRuntimeErrors(raw);
 assert.equal(result.classified[0].classification, "native_replacement_rsc_diagnostic");
 assert.equal(result.classified[0].requestId, null);
});

test("completed, policy, pending and unknown failures in the owning activation never enter zero-event branch", () => {
 for (const change of [
  { status: 200, seq: 2, finished: 3, failed: null, failure: null },
  { status: 403, seq: 2, finished: 3 }, { status: 500, seq: 2, finished: 3 },
  { status: null, failed: null, failure: null }, { status: null, failure: "unknown failure" },
 ]) {
  const raw = evidence(); Object.assign(raw.requests[0], change);
  const result = classifyRuntimeErrors(raw);
  assert.equal(result.classified.length, 0); assert.equal(result.unexpected.length, 1);
 }
});

test("any same-epoch same-path query conflict vetoes zero-event classification regardless of terminal state", () => {
 for (const state of [
  { status: 200, seq: 2, finished: 3, failed: null, failure: null },
  { status: 403, seq: 2, finished: 3 },
  { status: 500, seq: 2, finished: 3 },
  { status: null, finished: null, failed: null, failure: null },
  { status: null, failure: "unknown failure" },
  { status: null, failure: "cancelled" },
  { status: 200, seq: 12, finished: 14, failed: null, failure: null },
 ]) {
  const raw = evidence(); raw.requests[0].url += "x"; Object.assign(raw.requests[0], state);
  const result = classifyRuntimeErrors(raw);
  assert.equal(result.classified.length, 0); assert.equal(result.unexpected.length, 1);
  assert.equal(result.unexpected[0].reason, "same_epoch_query_conflict");
 }
});

test("prior and future epoch query conflicts are never borrowed into the owning activation", () => {
 const raw = evidence(); raw.requests[0].url += "x"; raw.requests[0].epoch = "prior";
 raw.requests.push({ ...raw.requests[0], id: 2, epoch: "future", status: 403 });
 const result = classifyRuntimeErrors(raw);
 assert.equal(result.unexpected.length, 0);
 assert.equal(result.classified[0].classification, "native_replacement_rsc_diagnostic");
 assert.equal(result.classified[0].requestId, null);
});

test("different paths do not create query conflicts and exact request-proven classification is unchanged", () => {
 const otherPath = evidence(); otherPath.requests[0].url = `${origin}/guide.rsc?_rsc=other`;
 assert.equal(classifyRuntimeErrors(otherPath).classified[0].classification, "native_replacement_rsc_diagnostic");
 const exact = evidence(); exact.requests.push({ ...exact.requests[0], id: 2, url: `${url}x`, status: 403 });
 assert.equal(classifyRuntimeErrors(exact).classified[0].classification, "native_obsolete_document_rsc_cancellation");
});

for (const name of ["wrong engine", "generic name", "malformed native message", "foreign origin", "API path", "credentials", "no replacement", "same document", "failed destination", "no document request", "overlapping navigation", "new document diagnostic", "missing outgoing epoch", "postcommit error", "duplicate errors", "observer gap", "observer not ready", "subframe ownership ambiguity despite otherwise qualifying main request", "genuine native-looking throw", "unhandled rejection counterpart"]) {
 test(`zero-event diagnostic fails closed: ${name}`, () => {
  const raw = evidence(); raw.requests = []; negatives[name](raw);
  const result = classifyRuntimeErrors(raw);
  assert.equal(result.classified.length, 0); assert.equal(result.unexpected.length, raw.errors.length);
 });
}
