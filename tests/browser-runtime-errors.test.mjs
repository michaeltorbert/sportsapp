import test from "node:test";
import assert from "node:assert/strict";
import { classifyRuntimeErrors, nativeRscUrl, NATIVE_CANCEL_REASONS, incompleteNativeControl, COMPLETED_READ_LABEL } from "../scripts/browser-runtime-errors.mjs";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

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

// Stage A: error uniqueness is per URL within the error's own non-empty owning epoch (reason enums unchanged).
test("stage A: same URL in a different known epoch no longer makes an otherwise unique error ambiguous", () => {
 const raw = evidence();
 raw.errors.push({ ...raw.errors[0], id: 2, seq: 30, epoch: "later", navigation: 2 }); // SYNTHETIC later activation
 raw.navigations.push({ id: 2, start: 20, fromEpoch: "later", toEpoch: "after", documentRequest: 25, commit: 40, settled: 41, success: true });
 const result = classifyRuntimeErrors(raw), first = result.classified.find(c => c.errorId === 1);
 assert.equal(first?.classification, "native_obsolete_document_rsc_cancellation");
 assert.ok(!result.unexpected.some(u => u.errorId === 1 || (u.id === 1 && u.reason === "ambiguous_errors")));
});
test("stage A: same URL in the same epoch, or a same-URL error with an unknown/empty epoch, stays ambiguous in both directions", () => {
 for (const [label, other, selfEpoch] of [
  ["same epoch", { epoch: "old" }, "old"],
  ["other unknown epoch", { epoch: null }, "old"],
  ["other empty epoch", { epoch: "" }, "old"],
  ["other missing epoch", { epoch: undefined }, "old"],
  ["own unknown epoch", { epoch: "later" }, null],
  ["own empty epoch", { epoch: "later" }, ""],
 ]) {
  const raw = evidence(); raw.errors[0].epoch = selfEpoch;
  raw.errors.push({ ...raw.errors[0], id: 2, seq: 9, ...other }); // SYNTHETIC
  const result = classifyRuntimeErrors(raw);
  assert.equal(result.classified.length, 0, label);
  assert.deepEqual(result.unexpected.map(u => u.reason), ["ambiguous_errors", "ambiguous_errors"], label);
 }
});
test("stage A: different URLs are independent; the downstream completed-200 veto still rejects (not as ambiguous_errors)", () => {
 const raw = evidence(); raw.requests[0].status = 200;
 raw.errors.push({ ...raw.errors[0], id: 2, epoch: "old", stack: raw.errors[0].stack.replace("/.rsc?", "/guide.rsc?"), message: raw.errors[0].message.replace("/.rsc?", "/guide.rsc?") }); // SYNTHETIC other URL, same epoch
 const result = classifyRuntimeErrors(raw), first = result.unexpected.find(u => u.id === 1);
 assert.ok(first); assert.notEqual(first.reason, "ambiguous_errors");
});

// Stage B: immutable actual controlled provenance from the failed v3 WebKit All-FBS run (local loopback RSC only).
const historical = () => {
 const bytes = readFileSync(new URL("./fixtures/ss181-runtime-provenance-v3.json", import.meta.url));
 assert.equal(bytes.length, 8064);
 assert.equal(createHash("sha256").update(bytes).digest("hex"), "35f2ce6a1eeaf9e60114d31092dbdb7be0bfacb3d5450eea513cef3442a98362");
 const wrapper = JSON.parse(bytes.toString());
 assert.equal(wrapper.sourceCommit, "f1e3a8aeb7e3b9bbc0d5cbf4834ef806985ac3db"); assert.equal(wrapper.runtimeProvenance.browserName, "webkit");
 return wrapper.runtimeProvenance;
};
const assertOldZeroEvent = result => {
 for (const id of [2, 3, 4]) {
  const c = result.classified.find(row => row.errorId === id);
  assert.equal(c.classification, "native_replacement_rsc_diagnostic");
  assert.equal(c.publicRequestEvents, 0); assert.equal(c.qualification, "requires_actual_current_platform_control");
  assert.match(c.causalLimit, /individual cancellation and server ingress are not established/);
 }
};
test("stage B: actual v3 provenance on its RECORDED darwin/arm64 host — ID1 is the distinct completed-read diagnostic (not an exoneration); IDs 2-4 unchanged; raw unchanged", () => {
 const raw = historical(), before = JSON.stringify(raw), result = classifyRuntimeErrors(raw);
 assert.equal(JSON.stringify(raw), before, "classifier never mutates raw evidence (deep)");
 // Every error is accounted for exactly once.
 const seen = [...result.classified.map(c => c.errorId), ...result.unexpected.map(u => u.id)].sort();
 assert.deepEqual(seen, [1, 2, 3, 4]);
 assert.deepEqual(result.unexpected, []);
 const id1 = result.classified.find(row => row.errorId === 1);
 assert.equal(id1.classification, COMPLETED_READ_LABEL, "qualified-platform diagnostic only; no historical cause, cancellation or ingress");
 assert.equal(id1.requestId, null); assert.equal(id1.navigationId, 3);
 assert.deepEqual(id1.priorCompletedRequests, [{ requestId: 4, status: 200, finished: 70 }]);
 assert.equal(id1.owningEpochExactUrlRequestEvents, 1); assert.equal(id1.newOwningEpochExactUrlRequestEventsAfterReplacementStart, 0);
 assertOldZeroEvent(result);
});
test("stage B: EXPLICITLY SYNTHETIC host mutations of the historical evidence keep ID1 unexpected ambiguous_requests", () => {
 for (const change of [{ hostPlatform: undefined }, { hostPlatform: "linux" }, { hostPlatform: "synthetic" }, { hostArchitecture: "x64" }, { hostArchitecture: undefined }]) {
  const raw = structuredClone(historical()); // a mutated copy, NOT original raw history
  for (const [key, value] of Object.entries(change)) { if (value === undefined) delete raw[key]; else raw[key] = value; }
  const result = classifyRuntimeErrors(raw);
  assert.deepEqual(result.unexpected.map(u => [u.id, u.reason]), [[1, "ambiguous_requests"]], JSON.stringify(change));
  assert.ok(!result.classified.some(row => row.classification === COMPLETED_READ_LABEL));
  assertOldZeroEvent(result);
 }
});

// Immutable actual completed-read native control (source 3dbe7c33, run eef2fea2, WebKit 27.2 per same-run
// browser-evidence; Darwin/arm64). Recorded raw collection result (old policy) stays as recorded.
test("actual v4 completed-read native control: exact bytes, raw unchanged, distinct diagnostic under the current policy", () => {
 const bytes = readFileSync(new URL("./fixtures/ss181-completedread-native-v4.json", import.meta.url));
 assert.equal(bytes.length, 5075);
 assert.equal(createHash("sha256").update(bytes).digest("hex"), "31ae5fb8356082dd37bca5afc8c6f3cef97fa50def1b108a47f13a1874b193b1");
 const raw = JSON.parse(bytes.toString()), before = JSON.stringify(raw);
 assert.deepEqual([raw.browserName, raw.hostPlatform, raw.hostArchitecture], ["webkit", "darwin", "arm64"]);
 assert.deepEqual(raw.result.unexpected.map(u => [u.id, u.reason]), [[1, "ambiguous_requests"]], "recorded old-policy collection result");
 const result = classifyRuntimeErrors(raw);
 assert.equal(JSON.stringify(raw), before);
 assert.deepEqual(result.unexpected, []);
 assert.deepEqual(result.classified, [{ errorId: 1, requestId: null, navigationId: 3, epoch: raw.errors[0].epoch, url: raw.requests[0].url, classification: COMPLETED_READ_LABEL,
  priorCompletedRequests: [{ requestId: 1, status: 200, finished: 11 }], owningEpochExactUrlRequestEvents: 1, newOwningEpochExactUrlRequestEventsAfterReplacementStart: 0,
  qualification: "requires_same_run_final_pass_darwin_arm64_webkit_completed_read_control",
  causalLimit: "One prior successful same-activation public request completed before replacement; no new exact-URL public Request event was observed after replacement started. Individual diagnostic cause, request cancellation and server ingress are not established." }]);
});

// Synthetic completed-read predicate cases (eligible recorded host; strict seq 2 < response 3 < finished 4 < start 5).
function completedRead() {
 const raw = evidence(); raw.hostPlatform = "darwin"; raw.hostArchitecture = "arm64";
 Object.assign(raw.requests[0], { seq: 2, response: 3, finished: 4, status: 200, failed: null, failure: null });
 return raw;
}
test("completed-read: one strict prior 200 on the eligible host is the distinct diagnostic with exact metadata", () => {
 const raw = completedRead(), before = JSON.stringify(raw), result = classifyRuntimeErrors(raw);
 assert.equal(JSON.stringify(raw), before);
 assert.deepEqual(result.unexpected, []);
 assert.deepEqual(result.classified, [{ errorId: 1, requestId: null, navigationId: 1, epoch: "old", url, classification: COMPLETED_READ_LABEL,
  priorCompletedRequests: [{ requestId: 1, status: 200, finished: 4 }], owningEpochExactUrlRequestEvents: 1, newOwningEpochExactUrlRequestEventsAfterReplacementStart: 0,
  qualification: "requires_same_run_final_pass_darwin_arm64_webkit_completed_read_control",
  causalLimit: "One prior successful same-activation public request completed before replacement; no new exact-URL public Request event was observed after replacement started. Individual diagnostic cause, request cancellation and server ingress are not established." }]);
 assert.doesNotMatch(result.classified[0].causalLimit, /No same-activation public Request event/);
 assert.equal("publicRequestEvents" in result.classified[0], false, "never a zero-ALL-public-events claim");
});
test("completed-read: unsupported or unrecorded hosts keep the original completed-read veto", () => {
 for (const change of [{ hostPlatform: "synthetic" }, { hostPlatform: "linux" }, { hostPlatform: undefined }, { hostArchitecture: "x64" }, { hostArchitecture: undefined }, { hostPlatform: ["darwin"] }]) {
  const raw = completedRead();
  for (const [key, value] of Object.entries(change)) { if (value === undefined) delete raw[key]; else raw[key] = value; }
  assert.deepEqual(classifyRuntimeErrors(raw).unexpected.map(u => u.reason), ["ambiguous_requests"], JSON.stringify(change));
 }
});
const completedReadNegatives = {
 "two completed rows": e => { e.requests.unshift({ ...e.requests[0], id: 2, seq: 1.1, response: 1.2, finished: 1.3 }); },
 "extra pending exact row": e => { e.requests.push({ ...e.requests[0], id: 2, seq: 7, response: null, status: null, finished: null }); },
 "extra failed exact row after start": e => { e.requests.push({ ...e.requests[0], id: 2, seq: 7, response: null, status: null, finished: null, failed: 8, failure: "unknown failure" }); },
 "extra completed exact row after start": e => { e.requests.push({ ...e.requests[0], id: 2, seq: 6.5, response: 7, finished: 8 }); },
 "exact row with unknown owner epoch": e => { e.requests.push({ ...e.requests[0], id: 2, epoch: null }); },
 "status 204": e => { e.requests[0].status = 204; }, "status 403": e => { e.requests[0].status = 403; },
 "status 500": e => { e.requests[0].status = 500; }, "status null": e => { e.requests[0].status = null; },
 "failed non-null": e => { e.requests[0].failed = 3.5; }, "failure non-null": e => { e.requests[0].failure = "cancelled"; },
 "failed missing": e => { delete e.requests[0].failed; },
 "response missing": e => { delete e.requests[0].response; }, "response NaN": e => { e.requests[0].response = Number.NaN; },
 "seq zero": e => { e.requests[0].seq = 0; }, "seq negative": e => { e.requests[0].seq = -1; },
 "response equals finished": e => { e.requests[0].response = 4; }, "seq equals response": e => { e.requests[0].seq = 3; },
 "finished equals start": e => { e.requests[0].finished = 5; }, "finished after start": e => { e.requests[0].finished = 5.5; },
 "wrong method": e => { e.requests[0].method = "POST"; }, "wrong resource": e => { e.requests[0].type = "xhr"; },
 "subframe row": e => { e.requests[0].mainFrame = false; },
 "error before documentRequest": e => { e.navigations[0].documentRequest = 9.5; },
 "error equal to documentRequest": e => { e.navigations[0].documentRequest = 9; },
 "same-epoch duplicate error on a different navigation": e => { e.errors.push({ ...e.errors[0], id: 2, navigation: 2 }); },
 "other same-URL error with unknown epoch": e => { e.errors.push({ ...e.errors[0], id: 2, epoch: null }); },
};
// V6 reviewed inversion: the former first state here ({status:200, seq:2.1, response:2.2, finished:2.3}), a
// same-path other query that completed 200 strictly before the replacement started, is now the positive
// "completed-read: one strict prior 200 plus a strict completed same-path other query" below. The other
// three states (pending, failed, completed after start) stay negatives.
for (const state of [{ status: null, finished: null, failed: null, failure: null }, { status: null, failed: 8, failure: "cancelled" }, { status: 200, seq: 7, response: 7.5, finished: 8, failed: null, failure: null }]) {
 completedReadNegatives[`same-path query conflict ${JSON.stringify(state)}`] = e => { e.requests.push({ ...e.requests[0], id: 2, url: `${url}x`, ...state }); };
}
// A strict completed same-path other query (owning epoch "old"; 2.1 < 2.2 < 2.3 < start 5), then one mutation.
const goodOther = (id = 2, change = {}) => ({ id, seq: 2.1, epoch: "old", mainFrame: true, url: `${url}&date=2026-09-06`, method: "GET", type: "fetch", status: 200, failed: null, failure: null, response: 2.2, finished: 2.3, ...change });
const withOther = change => e => { const row = goodOther(2, change); for (const [key, value] of Object.entries(change)) if (value === undefined) delete row[key]; e.requests.push(row); };
for (const [name, change] of Object.entries({
 "status 204": { status: 204 }, "status 304": { status: 304 }, "status 403": { status: 403 }, "status 500": { status: 500 }, "status null": { status: null },
 "failed set": { failed: 2.25 }, "failed missing": { failed: undefined }, "failure set": { failure: "cancelled" }, "failure missing": { failure: undefined },
 "pending (finished null)": { finished: null }, "response missing": { response: undefined }, "response NaN": { response: Number.NaN }, "response zero": { response: 0 },
 "seq zero": { seq: 0 }, "seq negative": { seq: -1 }, "seq equals response": { seq: 2.2 }, "response equals finished": { response: 2.3 }, "reversed order": { seq: 2.3, finished: 2.1 },
 "finished equals start": { finished: 5 }, "finished after start": { finished: 6 }, "started after start": { seq: 6, response: 6.5, finished: 7 },
 "subframe": { mainFrame: false }, "mainFrame missing": { mainFrame: undefined }, "POST": { method: "POST" }, "xhr": { type: "xhr" },
 "owner null": { epoch: null }, "owner empty": { epoch: "" }, "owner missing": { epoch: undefined }, "owner non-string": { epoch: 7 },
 "unparseable URL in owning epoch": { url: "http://[bad" }, "unparseable URL with unknown owner": { url: "http://[bad", epoch: null },
})) completedReadNegatives[`other query ${name}`] = withOther(change);
completedReadNegatives["one good plus one bad other query"] = e => { e.requests.push(goodOther(2), goodOther(3, { url: `${url}&date=2026-09-07`, status: 403 })); };
completedReadNegatives["good other query with a non-200 exact baseline"] = e => { e.requests[0].status = 403; e.requests.push(goodOther()); };
completedReadNegatives["good other query with two exact rows"] = e => { e.requests.push(goodOther(), { ...e.requests[0], id: 3, seq: 1.1, response: 1.2, finished: 1.3 }); };
for (const name of ["wrong engine", "generic name", "malformed native message", "HTTPS unverified", "foreign origin", "API path", "credentials", "no replacement", "same document", "failed destination", "no document request", "overlapping navigation", "new document diagnostic", "missing outgoing epoch", "postcommit error", "observer gap", "observer not ready", "subframe ownership ambiguity despite otherwise qualifying main request", "genuine native-looking throw", "unhandled rejection counterpart"]) completedReadNegatives[name] = negatives[name];
for (const [name, mutate] of Object.entries(completedReadNegatives)) test(`completed-read fails closed: ${name}`, () => {
 const raw = completedRead(); mutate(raw); const result = classifyRuntimeErrors(raw);
 assert.ok(!result.classified.some(row => row.classification === COMPLETED_READ_LABEL), name);
 assert.equal(result.classified.length + result.unexpected.length, raw.errors.length);
 assert.ok(result.unexpected.some(u => u.id === 1), name);
});
test("completed-read: a prior completed 200 plus a unique in-window cancellation stays request-proven, unchanged", () => {
 const raw = completedRead();
 raw.requests.push({ id: 2, seq: 7, epoch: "old", mainFrame: true, url, method: "GET", type: "fetch", status: null, failure: NATIVE_CANCEL_REASONS[0], failed: 8, finished: null });
 assert.deepEqual(classifyRuntimeErrors(raw).classified.map(row => [row.classification, row.requestId]), [["native_obsolete_document_rsc_cancellation", 2]]);
});
test("completed-read: prior/future epoch or other-path completed rows are not borrowed as baseline evidence", () => {
 const prior = completedRead(); prior.requests[0].epoch = "prior";
 assert.equal(classifyRuntimeErrors(prior).classified[0].classification, "native_replacement_rsc_diagnostic");
 const otherPath = completedRead(); otherPath.requests[0].url = `${origin}/guide.rsc?_rsc=KsQaSH2L7Z4e6Q5N`;
 assert.equal(classifyRuntimeErrors(otherPath).classified[0].classification, "native_replacement_rsc_diagnostic");
});

// V6: strict completed same-path other-query history before the replacement (temporal exclusion only).
const otherQueryLimit = n => `One prior successful exact-URL same-activation request and ${n} same-path different-query request${n === 1 ? "" : "s"} all completed 200 before replacement started; no same-path public Request event in the owning activation started at or after replacement start. Individual diagnostic cause, request cancellation and server ingress are not established.`;
test("completed-read: one strict prior 200 plus a strict completed same-path other query (reviewed V6 inversion) is the same label with added history", () => {
 const raw = completedRead(); raw.requests.push({ ...raw.requests[0], id: 2, url: `${url}x`, status: 200, seq: 2.1, response: 2.2, finished: 2.3, failed: null, failure: null });
 const before = JSON.stringify(raw), result = classifyRuntimeErrors(raw);
 assert.equal(JSON.stringify(raw), before);
 assert.deepEqual(result.unexpected, []);
 assert.deepEqual(result.classified, [{ errorId: 1, requestId: null, navigationId: 1, epoch: "old", url, classification: COMPLETED_READ_LABEL,
  priorCompletedRequests: [{ requestId: 1, status: 200, finished: 4 }],
  priorCompletedSamePathOtherQueryRequests: [{ requestId: 2, status: 200, seq: 2.1, response: 2.2, finished: 2.3 }],
  owningEpochSamePathRequestEvents: 2, newOwningEpochSamePathRequestEventsAfterReplacementStart: 0,
  owningEpochExactUrlRequestEvents: 1, newOwningEpochExactUrlRequestEventsAfterReplacementStart: 0,
  qualification: "requires_same_run_final_pass_darwin_arm64_webkit_completed_read_control", causalLimit: otherQueryLimit(1) }]);
 assert.equal("publicRequestEvents" in result.classified[0], false, "never a zero-ALL-public-events claim");
});
test("completed-read: every strict other query is retained (no cap); the exact baseline count stays one", () => {
 const raw = completedRead(); raw.requests.push(goodOther(2), goodOther(3, { url: `${url}&date=2026-09-07`, seq: 3.1, response: 3.2, finished: 3.3 }));
 const [row] = classifyRuntimeErrors(raw).classified;
 assert.equal(row.classification, COMPLETED_READ_LABEL);
 assert.deepEqual(row.priorCompletedRequests, [{ requestId: 1, status: 200, finished: 4 }]);
 assert.deepEqual(row.priorCompletedSamePathOtherQueryRequests.map(prior => prior.requestId), [2, 3]);
 assert.equal(row.owningEpochSamePathRequestEvents, 3); assert.equal(row.owningEpochExactUrlRequestEvents, 1);
 assert.equal(row.causalLimit, otherQueryLimit(2));
});
test("completed-read: known other-epoch and other-path rows are ignored, so the output stays exactly the no-other-query shape", () => {
 const expected = classifyRuntimeErrors(completedRead());
 for (const extra of [
  goodOther(2, { epoch: "prior", status: null, finished: null }), goodOther(2, { epoch: "new", failed: 8, failure: "cancelled", status: null }),
  goodOther(2, { epoch: "prior", url: "http://[bad" }), goodOther(2, { url: `${origin}/guide.rsc?date=2026-09-06`, status: null, finished: null }),
  goodOther(2, { epoch: null, url: `${origin}/guide.rsc?date=2026-09-06` }),
 ]) {
  const raw = completedRead(); raw.requests.push(extra);
  assert.deepEqual(classifyRuntimeErrors(raw), expected, JSON.stringify(extra));
 }
});
test("completed-read: a good other query with zero exact rows stays the unchanged zero-event query veto", () => {
 const raw = completedRead(); raw.requests = [goodOther(2)];
 assert.deepEqual(classifyRuntimeErrors(raw).unexpected.map(u => u.reason), ["same_epoch_query_conflict"]);
});
test("completed-read: exact prior 200 + good other query + unique in-window cancellation stays request-proven", () => {
 const raw = completedRead(); raw.requests.push(goodOther(2), { id: 3, seq: 7, epoch: "old", mainFrame: true, url, method: "GET", type: "fetch", status: null, failure: NATIVE_CANCEL_REASONS[0], failed: 8, finished: null });
 assert.deepEqual(classifyRuntimeErrors(raw).classified.map(row => [row.classification, row.requestId]), [["native_obsolete_document_rsc_cancellation", 3]]);
});

// Root-provided immutable wrapper (read only): FULL unmodified runtimeProvenance + the recorded FAILED
// classification from the failed 5929f171 Mac all-FBS run (date/preference case). Not live sports/provider proof.
const otherQueryFixture = () => {
 const bytes = readFileSync(new URL("./fixtures/ss181-otherquery-native-v6.json", import.meta.url));
 assert.equal(bytes.length, 12000);
 assert.equal(createHash("sha256").update(bytes).digest("hex"), "dcc439b179ba6e73a95f7dfb479a386a2b82c8c5539d40586fd2058e6c222a98");
 const wrapper = JSON.parse(bytes.toString());
 assert.deepEqual([wrapper.sourceCommit, wrapper.browserRunId, wrapper.engineVersion, wrapper.browser], ["5929f171d99a5c5bea7ce9758b9b2dd1bcaf2d68", "8807e81d-34ec-4ede-95b5-1fdfb849de24", "27.2", "webkit"]);
 return wrapper;
};
test("actual v6 other-query provenance: recorded classification FAILED; current policy gives the distinct diagnostic with exact prior 4 + other query 7; raw unchanged", () => {
 const wrapper = otherQueryFixture(), raw = wrapper.runtimeProvenance, before = JSON.stringify(wrapper);
 assert.deepEqual(wrapper.runtimeClassification.classified, []);
 assert.deepEqual(wrapper.runtimeClassification.unexpected.map(u => [u.id, u.reason]), [[1, "ambiguous_requests"]], "the recorded run FAILED and stays failed");
 const result = classifyRuntimeErrors(raw);
 assert.equal(JSON.stringify(wrapper), before, "classifier never mutates raw evidence (deep)");
 assert.deepEqual([...result.classified.map(c => c.errorId), ...result.unexpected.map(u => u.id)], [1], "each error once");
 assert.deepEqual(result.unexpected, []);
 assert.deepEqual(result.classified, [{ errorId: 1, requestId: null, navigationId: 3, epoch: "-1:0.021875240580032207", url: "http://127.0.0.1:4183/.rsc?_rsc=KsQaSH2L7Z4e6Q5N", classification: COMPLETED_READ_LABEL,
  priorCompletedRequests: [{ requestId: 4, status: 200, finished: 70 }],
  priorCompletedSamePathOtherQueryRequests: [{ requestId: 7, status: 200, seq: 78, response: 80, finished: 81 }],
  owningEpochSamePathRequestEvents: 2, newOwningEpochSamePathRequestEventsAfterReplacementStart: 0,
  owningEpochExactUrlRequestEvents: 1, newOwningEpochExactUrlRequestEventsAfterReplacementStart: 0,
  qualification: "requires_same_run_final_pass_darwin_arm64_webkit_completed_read_control", causalLimit: otherQueryLimit(1) }]);
});
test("actual v6: EXPLICITLY SYNTHETIC host or row-7 mutations keep ID1 unexpected ambiguous_requests", () => {
 const mutations = {
  "host linux": e => { e.hostPlatform = "linux"; }, "host synthetic": e => { e.hostPlatform = "synthetic"; }, "host missing": e => { delete e.hostPlatform; }, "arch x64": e => { e.hostArchitecture = "x64"; },
  "row 7 pending": e => { Object.assign(e.requests[6], { status: null, response: undefined, finished: null }); },
  "row 7 failed": e => { Object.assign(e.requests[6], { failed: 82, failure: "cancelled" }); },
  "row 7 403": e => { e.requests[6].status = 403; }, "row 7 finished at start": e => { e.requests[6].finished = 87; },
  "row 7 owner unknown": e => { e.requests[6].epoch = null; }, "row 7 POST": e => { e.requests[6].method = "POST"; },
 };
 for (const [name, mutate] of Object.entries(mutations)) {
  const raw = structuredClone(otherQueryFixture().runtimeProvenance); // a mutated copy, NOT original raw history
  assert.equal(raw.requests[6].id, 7);
  mutate(raw);
  assert.deepEqual(classifyRuntimeErrors(raw).unexpected.map(u => [u.id, u.reason]), [[1, "ambiguous_requests"]], name);
 }
});
