import { test, expect, observeRuntimeErrors } from "./fixtures.mjs";
import { NATIVE_CANCEL_REASONS, incompleteNativeControl } from "../../scripts/browser-runtime-errors.mjs";

// Deliberate-error controls use a separate disposable page and explicitly assert
// its errors remain unexpected. The ordinary harness guard is never disabled.
async function control(browser, browserName, origin) {
 const context = await browser.newContext({ baseURL: origin, serviceWorkers: "block" });
 const page = await context.newPage();
 await page.addInitScript(() => {
  for (const type of ["loadstart", "play"]) addEventListener(type, event => { if (event.target instanceof HTMLMediaElement) event.target.muted = true; }, true);
 });
 const observer = await observeRuntimeErrors(page, browserName, origin);
 await page.goto("about:blank");
 expect(await page.evaluate(() => { const audio = document.createElement("audio"); document.body.append(audio); audio.dispatchEvent(new Event("loadstart")); const muted = audio.muted; audio.remove(); return muted; })).toBe(true);
 return { context, page, observer };
}

test("passive observers retain genuine native-looking throws and unhandled rejections", async ({ browser, browserName, harness }, testInfo) => {
 const origin = testInfo.project.use.baseURL;
 const { context, page, observer } = await control(browser, browserName, origin);
 try {
  await page.route("**/*", route => {
   const url = new URL(route.request().url());
   if (url.origin !== origin) return route.abort();
   return url.pathname === "/.rsc" ? route.fulfill({ status: 403, contentType: "text/plain", body: "synthetic policy denial" }) : route.fulfill({ contentType: "text/html", body: "<h1>Isolated runtime control</h1>" });
  });
  await page.goto(`${origin}/runtime-control`);
  const thrown = page.waitForEvent("pageerror");
  await page.evaluate(origin => { setTimeout(() => { const error = new Error(`${origin.slice(6)}/.rsc?control=throw due to access control checks.`); error.name = "Fetch API cannot load http"; error.stack = `Fetch API cannot load ${origin}/.rsc?control=throw due to access control checks.`; throw error; }, 0); }, origin);
  await thrown;
  await expect.poll(() => observer.data.dom.some(row => row.kind === "error")).toBe(true);
  const rejected = page.waitForEvent("pageerror");
  await page.evaluate(() => { void Promise.reject(new Error("deliberate unhandled runtime control")); });
  await rejected;
  await expect.poll(() => observer.data.dom.some(row => row.kind === "unhandledrejection")).toBe(true);
  const policyFailure = page.waitForEvent("pageerror");
  await page.evaluate(() => { void fetch("/.rsc?control=policy").then(response => { if (!response.ok) throw new Error(`deliberate HTTP ${response.status} policy control`); }); });
  await policyFailure;
  await expect.poll(() => observer.data.dom.filter(row => row.kind === "unhandledrejection").length).toBe(2);
  expect(observer.data.requests.some(row => row.status === 403)).toBe(true);
  const before = observer.data.errors.length;
  await page.evaluate(async () => { await Promise.reject(new Error("deliberately handled control")).catch(() => {}); });
  expect(observer.data.errors.length).toBe(before);
  expect(observer.classify().classified).toEqual([]);
  expect(observer.classify().unexpected).toHaveLength(3);
  expect(observer.classify().unexpected.filter(error => !incompleteNativeControl(error, observer.data)), "The cancellation-control verdict rejects these same genuine errors").toHaveLength(3);
  await testInfo.attach("genuine-runtime-controls", { contentType: "application/json", body: JSON.stringify(observer.data) });
  expect(harness.state.errors).toEqual([]);
 } finally { await context.close(); }
});

test("synthetic navigation cancellation records its actual native reason without a blanket exemption", async ({ browser, browserName, harness }, testInfo) => {
 const origin = testInfo.project.use.baseURL;
 const { context, page, observer } = await control(browser, browserName, origin);
 let release; const gate = new Promise(resolve => { release = resolve; });
 try {
  await page.route("**/*", async route => {
   const url = new URL(route.request().url());
   if (url.origin !== origin) return route.abort();
   if (url.pathname === "/.rsc") { await gate; return route.fulfill({ contentType: "text/x-component", body: "synthetic" }).catch(() => {}); }
   return route.fulfill({ contentType: "text/html", body: url.pathname === "/runtime-old" ? '<h1>Old document</h1><script>fetch("/.rsc?runtime-control=cancel").catch(()=>{});</script>' : "<h1>Replacement document</h1>" });
  });
  const pending = page.waitForRequest(request => new URL(request.url()).pathname === "/.rsc");
  await page.goto(`${origin}/runtime-old`); await pending;
  await page.goto(`${origin}/runtime-new`); release();
  await expect(page.getByRole("heading", { name: "Replacement document" })).toBeVisible();
  const failures = observer.data.requests.filter(row => row.failed);
  if (browserName === "webkit" && failures.length) for (const row of failures) expect(NATIVE_CANCEL_REASONS).toContain(row.failure);
  const result = observer.classify();
  const incompleteNative = result.unexpected.filter(error => incompleteNativeControl(error, observer.data));
  const genuineErrors = result.unexpected.filter(error => !incompleteNativeControl(error, observer.data));
  expect(genuineErrors, "Synthetic cancellation control must fail genuine, policy, DOM and unrelated errors").toEqual([]);
  if (!result.classified.some(row => row.classification === "native_obsolete_document_rsc_cancellation") || incompleteNative.length) testInfo.annotations.push({ type: "inconclusive", description: "No fully qualified request-proven cancellation diagnostic; any zero-request diagnostic still requires the separate mandatory platform qualification." });
  expect(result.classified.length + result.unexpected.length).toBe(observer.data.errors.length);
  await testInfo.attach("synthetic-cancellation-control", { contentType: "application/json", body: JSON.stringify({ ...observer.data, result }) });
  expect(harness.state.errors).toEqual([]);
 } finally { release(); await context.close(); }
});

test("subframe presence and detached history veto ambiguous main-document error classification", async ({ browser, browserName, harness }, testInfo) => {
 const origin = testInfo.project.use.baseURL;
 const { context, page, observer } = await control(browser, browserName, origin);
 try {
  await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.fulfill({ contentType: "text/html", body: "<h1>Frame ownership control</h1>" }) : route.abort());
  await page.goto(`${origin}/runtime-frame-control`);
  const error = page.waitForEvent("pageerror");
  await page.evaluate(() => {
   const frame = document.createElement("iframe");
   frame.srcdoc = '<script>setTimeout(()=>{throw new Error("deliberate child frame error")},0)</script>';
   document.body.append(frame);
  });
  await error;
  await expect.poll(() => observer.data.dom.some(row => row.mainFrame === false)).toBe(true);
  expect(observer.data.documents.some(row => row.frameAmbiguous)).toBe(true);
  await page.locator("iframe").evaluate(frame => frame.remove());
  expect(observer.data.documents.some(row => row.frameAmbiguous)).toBe(true);
  expect(observer.classify().unexpected).toHaveLength(1);
  expect(observer.classify().classified).toEqual([]);
  await testInfo.attach("subframe-runtime-control", { contentType: "application/json", body: JSON.stringify(observer.data) });
  expect(harness.state.errors).toEqual([]);
 } finally { await context.close(); }
});

// One event-bound native Fetch attempt per activation. This captures the actual
// native function in the outgoing realm; it never replaces fetch or Promise.
const captureOutgoing = page => page.evaluateHandle(() => {
 const owner = window, document = owner.document, nativeFetch = owner.fetch;
 let policyStatus = null, child = null;
 const sameOwner = () => document === owner.document && owner.location.origin === document.location.origin;
 const nativeError = url => {
  const error = new Error(`${url.slice(6)} due to access control checks.`);
  error.name = "Fetch API cannot load http";
  error.stack = `Fetch API cannot load ${url} due to access control checks.`;
  return error;
 };
 return {
  epoch: owner.__ssRuntimeDocumentEpoch,
  native: /\[native code\]/.test(Function.prototype.toString.call(nativeFetch)),
  send(url) {
   return Reflect.apply(nativeFetch, owner, [url]).then(response => {
    policyStatus = response.status;
    return { returned: true, ok: true, status: response.status, epoch: owner.__ssRuntimeDocumentEpoch, sameOwner: sameOwner() };
   }, error => ({ returned: true, ok: false, name: error.name, message: error.message, epoch: owner.__ssRuntimeDocumentEpoch, sameOwner: sameOwner() }));
  },
  genuine(kind, url) {
   if (kind === "throw") setTimeout(() => { throw nativeError(url); }, 0);
   else if (kind === "rejection") void Promise.reject(nativeError(url));
   else if (kind === "policy") {
    if (policyStatus !== 403) throw new Error("HTTP policy control was not established");
    void Promise.reject(nativeError(url));
   } else if (kind === "frame") {
    child = document.createElement("iframe");
    child.srcdoc = '<script>setTimeout(()=>{throw new Error("held replacement child error")},0)</script>';
    document.body.append(child);
   }
   return { epoch: owner.__ssRuntimeDocumentEpoch, sameOwner: sameOwner() };
  },
  detach() { child?.remove(); },
 };
});

for (const kind of ["native", "throw", "rejection", "policy", "frame"]) test(`held replacement boundary: ${kind}`, async ({ browser, browserName, harness }, testInfo) => {
 test.skip(browserName !== "webkit", "This diagnostic policy and mandatory qualification apply only to WebKit; stable genuine-error controls still run in both engines.");
 const origin = testInfo.project.use.baseURL;
 const { context, page, observer } = await control(browser, browserName, origin);
 const probeUrl = `${origin}/.rsc?runtime-control=predispatch`;
 const policyUrl = `${origin}/.rsc?runtime-control=held-policy`;
 let hold = false, release, replacementSeen, outgoing, navigation, baseline, observation, result;
 let qualification = "incomplete";
 const gate = new Promise(resolve => { release = resolve; });
 const seen = new Promise(resolve => { replacementSeen = resolve; });
 try {
  await page.route("**/*", async route => {
   const url = new URL(route.request().url());
   if (url.origin !== origin) return route.abort();
   if (url.pathname === "/runtime-held-new" && hold) { replacementSeen(); await gate; }
   if (url.pathname === "/.rsc") return route.fulfill({ status: url.searchParams.get("runtime-control") === "held-policy" ? 403 : 200, contentType: "text/x-component", body: "synthetic native Fetch fixture" });
   return route.fulfill({ contentType: "text/html", body: url.pathname === "/runtime-held-new" ? "<h1>Held replacement destination</h1>" : "<h1>Outgoing native Fetch control</h1>" });
  });
  await page.goto(`${origin}/runtime-held-old`);
  const initial = await captureOutgoing(page);
  expect(await initial.evaluate(owner => owner.native)).toBe(true);
  baseline = await initial.evaluate((owner, url) => owner.send(url), probeUrl);
  expect(baseline.ok).toBe(true); expect(baseline.status).toBe(200); expect(baseline.sameOwner).toBe(true);
  // A distinct activation keeps that successful baseline out of the zero-ALL-
  // same-epoch predicate. The next cell performs the IDENTICAL native GET.
  await page.reload(); await initial.dispose();
  outgoing = await captureOutgoing(page);
  const oldEpoch = await outgoing.evaluate(owner => owner.epoch);
  expect(await outgoing.evaluate(owner => owner.native)).toBe(true);
  expect(observer.data.documents.some(row => row.epoch === oldEpoch && row.ready)).toBe(true);
  if (kind === "policy") {
   const policy = await outgoing.evaluate((owner, url) => owner.send(url), policyUrl);
   expect(policy.status).toBe(403); expect(policy.sameOwner).toBe(true);
  }
  hold = true; navigation = page.goto(`${origin}/runtime-held-new`); await seen;
  if (kind === "native") {
   observation = await outgoing.evaluate((owner, url) => owner.send(url), probeUrl);
  } else {
   const reported = page.waitForEvent("pageerror");
   observation = await outgoing.evaluate((owner, args) => owner.genuine(args.kind, args.url), { kind, url: kind === "policy" ? policyUrl : probeUrl });
   await reported;
   // Required positive observer evidence while the replacement is still held.
   // This is an event assertion, not a prefetch/network-idle wait in app tests.
   await expect.poll(() => observer.data.dom.some(row => row.epoch === oldEpoch || row.ownerEpoch === oldEpoch)).toBe(true);
   if (kind === "frame") {
    await outgoing.evaluate(owner => owner.detach());
    expect(observer.data.documents.find(row => row.epoch === oldEpoch).frameAmbiguous).toBe(true);
   }
  }
  expect(observation.epoch).toBe(oldEpoch); expect(observation.sameOwner).toBe(true);
  release(); const destination = await navigation;
  expect(destination.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Held replacement destination" })).toBeVisible();
  result = observer.classify();
  const replacement = observer.data.navigations.at(-1);
  expect(replacement.success).toBe(true);
  if (kind === "native") {
   expect(observer.data.dom).toEqual([]); expect(observer.data.frames).toEqual([]);
   expect(result.unexpected, "Unqualified or genuine errors stay failing; do not widen the native control").toEqual([]);
   const target = result.classified.filter(row => row.classification === "native_replacement_rsc_diagnostic" && row.url === probeUrl && row.epoch === oldEpoch);
   const noRequestEvents = observer.data.requests.filter(row => row.epoch === oldEpoch && row.url === probeUrl).length === 0;
   qualification = target.length === 1 && noRequestEvents && observation.returned && !observation.ok ? "qualified_target_observed" : "INCONCLUSIVE";
   if (qualification === "INCONCLUSIVE") testInfo.annotations.push({ type: "inconclusive", description: "The mandatory native pre-dispatch target was not demonstrated on this platform. New branch is NOT qualified for acceptance; no retry/timing search." });
  } else {
   expect(result.classified).toEqual([]);
   expect(result.unexpected.length).toBeGreaterThan(0);
   expect(observer.data.dom.some(row => (row.epoch === oldEpoch || row.ownerEpoch === oldEpoch) && replacement.documentRequest < row.seq && row.seq < replacement.commit)).toBe(true);
   qualification = "negative_control_passed";
  }
  expect(result.classified.length + result.unexpected.length).toBe(observer.data.errors.length);
  expect(harness.state.errors).toEqual([]);
 } finally {
  release(); await navigation?.catch(() => {});
  try {
   await testInfo.attach(`held-replacement-${kind}`, { contentType: "application/json", body: JSON.stringify({ ...observer.data, baseline, observation, result, finalClassification: observer.classify(), qualification, causalLimit: "Public Request events are not owned-server ingress accounting; no individual network cause is certified." }) });
  } finally { await outgoing?.dispose().catch(() => {}); await context.close(); }
 }
});
