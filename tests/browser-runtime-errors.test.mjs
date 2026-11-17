import test from "node:test";
import assert from "node:assert/strict";
import { classifyRuntimeErrors, nativeRscUrl, NATIVE_CANCEL_REASON, incompleteNativeControl } from "../scripts/browser-runtime-errors.mjs";

const origin = "http://127.0.0.1:4837", url = `${origin}/.rsc?_rsc=KsQaSH2L7Z4e6Q5N`;
function evidence() {
 return {
  browserName: "webkit", origin,
  errors: [{ id: 1, seq: 9, epoch: "old", navigation: 1, name: "Fetch API cannot load http", message: `${url.slice(6)} due to access control checks.`, stack: `Fetch API cannot load ${url} due to access control checks.\n    at unknown (http://127.0.0.1:4837/assets/types.js:2:1)` }],
  documents: [{ epoch: "old", ready: true, seq: 1, gap: false }], dom: [],
  requests: [{ id: 1, seq: 7, epoch: "old", mainFrame: true, url, method: "GET", type: "fetch", status: null, failure: NATIVE_CANCEL_REASON, failed: 8, finished: null }],
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
 "no request": e => { e.requests = []; },
 "unknown runtime reason": e => { e.requests[0].failure = "Load request cancelled"; },
 "no failure": e => { e.requests[0].failed = null; },
 "HTTP policy denial": e => { e.requests[0].status = 403; },
 "successful response conflict": e => { e.requests[0].status = 200; },
 "no replacement": e => { e.navigations = []; },
 "same document": e => { e.navigations[0].toEpoch = "old"; },
 "failed destination": e => { e.navigations[0].success = false; },
 "no document request": e => { e.navigations[0].documentRequest = null; },
 "overlapping navigation": e => { e.navigations[0].ambiguous = true; },
 "new document diagnostic": e => { e.errors[0].epoch = "new"; },
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
