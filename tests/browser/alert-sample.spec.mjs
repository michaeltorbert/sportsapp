import { createHash } from "node:crypto";
import { test, expect, CREDENTIALS, ALERT_ORIGIN } from "./fixtures.mjs";

// SIMULATED: fake push APIs and a mocked alert service. This checks the real
// Alerts UI only, never a push provider, a phone, a Watch or actual receipt.
const ENDPOINT = "https://push.example.test/existing";
const MATCHING = { ...CREDENTIALS, id: createHash("sha256").update(ENDPOINT).digest("base64url") };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// Answers only the sample routes. Requests are logged without their token.
async function sampleService(page, { post = { status: 202, body: { status: "scheduled" } }, get = { status: 202, body: { status: "scheduled", overdue: false } } } = {}) {
  const service = { post, get, posts: [], gets: [] };
  await page.route(`${ALERT_ORIGIN}/subscriptions/*/test**`, async route => {
    const req = route.request(), url = new URL(req.url());
    const entry = { method: req.method(), path: url.pathname, owner: req.headers().authorization === `Bearer ${MATCHING.token}` };
    if (req.method() === "POST") {
      service.posts.push({ ...entry, body: req.postDataJSON() });
      await service.beforeReply?.();
      if (service.post === "abort") return route.abort("failed");
      return route.fulfill({ status: service.post.status, contentType: "application/json", body: JSON.stringify({ testId: req.postDataJSON().testId, sample: "one-score", ...service.post.body }) });
    }
    service.gets.push(entry);
    return route.fulfill({ status: service.get.status, contentType: "application/json", body: JSON.stringify(service.get.body) });
  });
  return service;
}
async function openSheet(page, harness, push = {}) {
  const logs = [];
  page.on("console", message => logs.push(message.text()));
  await harness.open({ push: { permission: "granted", existing: true, credentials: MATCHING, ...push } });
  await page.getByRole("button", { name: "Alerts on", exact: true }).tap();
  return logs;
}
const sendButton = page => page.getByRole("button", { name: "Send sample alert", exact: true });
async function expectNoToken(page, service, logs) {
  expect(await page.content()).not.toContain(MATCHING.token);
  expect(await page.evaluate(() => localStorage.getItem("ss:sample"))).not.toContain(MATCHING.token);
  for (const request of [...service.posts, ...service.gets]) { expect(request.path).not.toContain(MATCHING.token); expect(request.owner).toBe(true); }
  for (const line of logs) expect(line).not.toContain(MATCHING.token);
}

for (const [label, push, state] of [
  ["a saved ID that does not match this endpoint", { credentials: true }, {}],
  ["notification permission not granted", { permission: "default" }, {}],
  ["no local push subscription", { existing: false }, {}],
  ["an alert service without sample support", {}, { sampleVersion: undefined }],
  ["alerts turned off", {}, { active: false }],
]) test(`SIMULATED sample: hidden with ${label}`, async ({ page, harness }) => {
  Object.assign(harness.state, state);
  const service = await sampleService(page);
  await harness.open({ push: { permission: "granted", existing: true, credentials: MATCHING, ...push } });
  await page.getByRole("button", { name: /^Alerts (on|off)$/ }).tap();
  // Enabled only after the owner readback completed, so the gate has been evaluated.
  await expect(page.getByRole("switch", { name: "Notifications", exact: true })).toBeEnabled();
  await page.clock.fastForward(1000);
  await expect(sendButton(page)).toHaveCount(0);
  expect(service.posts).toEqual([]); expect(service.gets).toEqual([]);
});

test("SIMULATED sample: one POST, GET-only readback, observed receipt and a 60-second lockout", async ({ page, harness }) => {
  const service = await sampleService(page);
  const logs = await openSheet(page, harness);
  const button = sendButton(page);
  await expect(button).toBeEnabled();
  await expect(button).toHaveAccessibleDescription("Sends a made-up game alert labeled SAMPLE to this device in about 10 seconds. To check Apple Watch, lock your iPhone and keep the Watch unlocked on your wrist.");
  await button.tap(); await button.tap({ force: true }).catch(() => {});
  await expect(page.getByRole("status").filter({ hasText: "Sample scheduled. Lock your iPhone now" })).toBeVisible();
  await expect(button).toBeDisabled();
  expect(service.posts).toHaveLength(1);
  const { testId } = service.posts[0].body;
  expect(service.posts[0].body).toEqual({ testId, sample: "one-score" }); expect(testId).toMatch(UUID);
  expect(service.posts[0].path).toBe(`/subscriptions/${MATCHING.id}/test`);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("ss:sample")));
  expect(Object.keys(saved).sort()).toEqual(["at", "subscriptionId", "testId"]);
  expect(saved).toMatchObject({ testId, subscriptionId: MATCHING.id });
  // Provider acceptance is not receipt.
  service.get = { status: 200, body: { status: "accepted" } };
  await page.clock.fastForward(5000);
  await expect(page.getByRole("status").filter({ hasText: "accepted the sample. That does not confirm it appeared" })).toBeVisible();
  expect(service.gets.at(-1).path).toBe(`/subscriptions/${MATCHING.id}/test/${testId}`);
  await expect(button).toBeDisabled();
  await page.getByRole("button", { name: "I saw it", exact: true }).tap();
  await expect(page.getByRole("status").filter({ hasText: "You saw the sample." })).toBeVisible();
  // The installed clock also runs in real time, so jump relative to the saved send time.
  const remaining = async () => saved.at + 60000 - await page.evaluate(() => Date.now());
  await page.clock.fastForward(Math.max(0, await remaining() - 10000));
  expect(await remaining()).toBeGreaterThan(0);
  await expect(button).toBeDisabled();
  await page.clock.fastForward(Math.max(0, await remaining()) + 1000);
  await expect(button).toBeEnabled();
  expect(service.posts).toHaveLength(1);
  await expectNoToken(page, service, logs);
});

test("SIMULATED sample: a reload resumes the same sample by GET and never re-POSTs", async ({ page, harness }) => {
  const service = await sampleService(page);
  const logs = await openSheet(page, harness);
  await sendButton(page).tap();
  await expect(page.getByRole("status").filter({ hasText: "Sample scheduled" })).toBeVisible();
  const { testId } = service.posts[0].body;
  service.get = { status: 200, body: { status: "late" } };
  await page.reload();
  await page.getByRole("button", { name: "Alerts on", exact: true }).tap();
  await expect(page.getByRole("status").filter({ hasText: "The sample was not sent because the service started it too late." })).toBeVisible();
  expect(service.gets.every(r => r.method === "GET" && r.path.endsWith(`/test/${testId}`))).toBe(true);
  await expect(sendButton(page)).toBeDisabled();
  await expect(page.getByRole("button", { name: "I saw it", exact: true })).toHaveCount(0);
  expect(service.posts).toHaveLength(1);
  await expectNoToken(page, service, logs);
});

test("SIMULATED sample: a failed POST reads by GET only, and not-recorded copy allows later arrival", async ({ page, harness }) => {
  const service = await sampleService(page, { post: "abort", get: { status: 404, body: { error: "No sample with this ID has been recorded yet." } } });
  const logs = await openSheet(page, harness);
  await sendButton(page).tap();
  const status = page.getByRole("status").filter({ hasText: "Could not confirm a record for this sample yet." });
  await expect(status).toBeVisible();
  await expect(status).toContainText("A delayed request could still deliver it; it will not be resent.");
  expect(service.posts).toHaveLength(1);
  expect(service.gets[0].path).toBe(`/subscriptions/${MATCHING.id}/test/${service.posts[0].body.testId}`);
  service.get = { status: 202, body: { status: "scheduled", overdue: true } };
  await page.clock.fastForward(5000);
  await expect(page.getByRole("status").filter({ hasText: "No result has been recorded yet. The sample may or may not have been sent" })).toBeVisible();
  await expect(sendButton(page)).toBeDisabled();
  await page.clock.fastForward(60000);
  await expect(sendButton(page)).toBeEnabled();
  expect(service.posts).toHaveLength(1);
  await expectNoToken(page, service, logs);
});

for (const [label, post, text] of [
  ["429 cooldown", { status: 429, body: { error: "Wait one minute before requesting another test" } }, "Wait one minute after the previous test. No sample was sent."],
  ["409 inactive", { status: 409, body: { error: "Enable alerts on this device first" } }, "Enable alerts on this device first. No sample was sent."],
]) test(`SIMULATED sample: a received ${label} forgets the refused UUID, so a reload neither re-POSTs nor reads it`, async ({ page, harness }) => {
  const service = await sampleService(page, { post, get: { status: 404, body: { error: "No sample with this ID has been recorded yet." } } });
  const logs = await openSheet(page, harness);
  await sendButton(page).tap();
  await expect(page.getByRole("status").filter({ hasText: text })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("ss:sample"))).toBeNull();
  // The local lock still runs for one minute from this attempt.
  await expect(sendButton(page)).toBeDisabled();
  await page.clock.fastForward(61000);
  await expect(sendButton(page)).toBeEnabled();
  await page.reload();
  await page.getByRole("button", { name: "Alerts on", exact: true }).tap();
  await expect(sendButton(page)).toBeEnabled();
  await page.clock.fastForward(6000);
  await expect(page.getByText("A delayed request could still deliver it")).toHaveCount(0);
  await expect(page.getByText("No sample was sent")).toHaveCount(0);
  expect(service.gets).toEqual([]);
  expect(service.posts).toHaveLength(1);
  await expectNoToken(page, service, logs);
});

test("SIMULATED sample: a refusal never forgets a newer sample saved by another tab", async ({ page, harness }) => {
  const service = await sampleService(page, { post: { status: 429, body: { error: "Wait one minute before requesting another test" } } });
  const newer = { testId: "00000000-0000-4000-8000-000000000001", subscriptionId: MATCHING.id };
  service.beforeReply = () => page.evaluate(v => localStorage.setItem("ss:sample", JSON.stringify({ ...v, at: Date.now() })), newer);
  await openSheet(page, harness);
  await sendButton(page).tap();
  await expect(page.getByRole("status").filter({ hasText: "Wait one minute after the previous test. No sample was sent." })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ss:sample")))).toMatchObject(newer);
  expect(service.posts).toHaveLength(1);
});

for (const [result, text, confirm] of [
  [{ status: "suppressed" }, "The sample was not sent because this device’s alert settings changed.", false],
  [{ status: "uncertain" }, "The sample’s result is not known. It may or may not appear", true],
  [{ status: "http-410" }, "The push service refused the sample (HTTP 410). It will not be retried.", false],
  [{ status: "sending", overdue: false }, "The sample is being sent now.", true],
]) test(`SIMULATED sample: ${result.status} is described truthfully`, async ({ page, harness }) => {
  const service = await sampleService(page);
  await openSheet(page, harness);
  await sendButton(page).tap();
  await expect(page.getByRole("status").filter({ hasText: "Sample scheduled" })).toBeVisible();
  service.get = { status: result.status === "sending" ? 202 : 200, body: result };
  await page.clock.fastForward(5000);
  await expect(page.getByRole("status").filter({ hasText: text })).toBeVisible();
  await expect(page.getByRole("button", { name: "I saw it", exact: true })).toHaveCount(confirm ? 1 : 0);
  expect(service.posts).toHaveLength(1);
});

test("SIMULATED sample: identity and permission are rechecked immediately before the POST", async ({ page, harness }) => {
  const service = await sampleService(page);
  await openSheet(page, harness);
  await expect(sendButton(page)).toBeEnabled();
  // The local subscription is replaced after the panel loaded.
  await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration("/")).pushManager.subscribe(); });
  await sendButton(page).tap();
  await expect(page.getByRole("status").filter({ hasText: "This device no longer matches its saved alert subscription. No sample was sent." })).toBeVisible();
  await expect(sendButton(page)).toHaveCount(0);
  expect(service.posts).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem("ss:sample"))).toBeNull();
});

test("SIMULATED sample: revoked permission is rechecked before the POST", async ({ page, harness }) => {
  const service = await sampleService(page);
  await openSheet(page, harness);
  await expect(sendButton(page)).toBeEnabled();
  await page.evaluate(() => { Notification.permission = "denied"; });
  await sendButton(page).tap();
  await expect(page.getByRole("status").filter({ hasText: "Notifications are not allowed on this device. No sample was sent." })).toBeVisible();
  expect(service.posts).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem("ss:sample"))).toBeNull();
});

for (const width of [320, 390]) test(`SIMULATED sample: ${width}px with 200% text keeps the control usable`, async ({ page, harness }) => {
  await page.setViewportSize({ width, height: 844 });
  await sampleService(page);
  await openSheet(page, harness);
  await page.addStyleTag({ content: ".alerts-sheet .help-body, .alerts-sheet .alert-sample, .alerts-sheet .solid-button { font-size: 32px; }" });
  const button = sendButton(page);
  await button.scrollIntoViewIfNeeded();
  const box = await button.boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
  expect(await page.getByRole("dialog").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await button.focus(); await expect(button).toBeFocused();
});
