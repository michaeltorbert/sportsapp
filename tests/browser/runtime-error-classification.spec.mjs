import { test, expect, observeRuntimeErrors } from "./fixtures.mjs";
import { NATIVE_CANCEL_REASON, incompleteNativeControl } from "../../scripts/browser-runtime-errors.mjs";

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
  if (browserName === "webkit" && failures.length) for (const row of failures) expect(row.failure).toBe(NATIVE_CANCEL_REASON);
  const result = observer.classify();
  const incompleteNative = result.unexpected.filter(error => incompleteNativeControl(error, observer.data));
  const genuineErrors = result.unexpected.filter(error => !incompleteNativeControl(error, observer.data));
  expect(genuineErrors, "Synthetic cancellation control must fail genuine, policy, DOM and unrelated errors").toEqual([]);
  if (!result.classified.length || incompleteNative.length) testInfo.annotations.push({ type: "inconclusive", description: "No fully qualified native precommit cancellation diagnostic; only exact native cancellation evidence may remain incomplete. Ordinary harness does not exempt it." });
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
