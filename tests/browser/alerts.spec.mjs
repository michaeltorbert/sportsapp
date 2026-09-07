import { test, expect, CREDENTIALS } from "./fixtures.mjs";

test("SIMULATED alerts: readiness updates automatically before enable becomes available", async ({ page, harness }) => {
  harness.state.ready = false;
  await harness.open();
  await page.getByRole("button", { name: "Alerts", exact: true }).tap();
  await expect(page.getByRole("heading", { name: "Alerts are being set up" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Enable alerts" })).toHaveCount(0);
  harness.state.ready = true;
  await page.clock.fastForward(31_000);
  await expect(page.getByRole("button", { name: "Enable alerts" })).toBeEnabled();
  expect(harness.state.alertRequests).toEqual([]);
});

test("SIMULATED alerts: unavailable config is reported and recovers on a later check", async ({ page, harness }) => {
  harness.state.failConfig = true;
  await harness.open();
  await page.getByRole("button", { name: "Alerts", exact: true }).tap();
  await expect(page.getByRole("status").filter({ hasText: "The alert service is unavailable" })).toBeVisible();
  harness.state.failConfig = false;
  await page.clock.fastForward(31_000);
  await expect(page.getByRole("button", { name: "Enable alerts" })).toBeEnabled();
  await expect(page.getByText("The alert service is unavailable. Try again later.", { exact: true })).toHaveCount(0);
});

test("SIMULATED alerts: denied permission does not register a subscription", async ({ page, harness }) => {
  await harness.open({ push: { permission: "denied", permissionResult: "denied" } });
  await page.getByRole("button", { name: "Alerts", exact: true }).tap();
  await page.getByRole("button", { name: "Enable alerts" }).tap();
  await expect(page.getByText("Alerts are blocked. You can allow them in your device’s notification settings.")).toBeVisible();
  expect(await page.evaluate(() => window.__pushSimulation)).toEqual({ permissionRequests: 1, subscribes: 0, unsubscribes: 0 });
  expect(harness.state.alertRequests).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem("ss:push"))).toBeNull();
});

test("SIMULATED alerts: an existing active subscription is recognized without re-registering", async ({ page, harness }) => {
  await harness.open({ push: { permission: "granted", existing: true, credentials: true } });
  await expect(page.getByRole("button", { name: "Alerts on", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Alerts on", exact: true }).tap();
  await expect(page.getByRole("button", { name: "Turn off alerts" })).toBeEnabled();
  await expect(page.getByLabel("Also alert me 10 minutes before ACC kickoffs")).toBeChecked();
  await page.reload();
  await expect(page.getByRole("button", { name: "Alerts on", exact: true })).toBeVisible();
  expect(harness.state.alertRequests.length).toBeGreaterThanOrEqual(2);
  expect(harness.state.alertRequests.every(r => r.method === "GET" && r.path === `/subscriptions/${CREDENTIALS.id}` && r.authorization === `Bearer ${CREDENTIALS.token}`)).toBe(true);
  expect(await page.evaluate(() => window.__pushSimulation)).toEqual({ permissionRequests: 0, subscribes: 0, unsubscribes: 0 });
});

test("SIMULATED alerts: lost credentials require reset before a new subscription is saved", async ({ page, harness }) => {
  harness.state.conflict = true;
  await harness.open({ push: { permission: "granted", existing: true } });
  await page.getByRole("button", { name: "Alerts", exact: true }).tap();
  await page.getByRole("button", { name: "Enable alerts" }).tap();
  await expect(page.getByText("This device’s saved alert access is missing. Reset alerts below, then enable again.")).toBeVisible();
  expect(harness.state.alertRequests).toHaveLength(1);
  expect(harness.state.alertRequests[0].authorization).toBeNull();
  expect(harness.state.alertRequests[0].body.subscription.endpoint).toBe("https://push.example.test/existing");
  await page.getByRole("button", { name: "Reset alerts", exact: true }).tap();
  await expect(page.getByText("Alerts are off for this device.")).toBeVisible();
  expect(await page.evaluate(() => window.__pushSimulation.unsubscribes)).toBe(1);
  expect(harness.state.alertRequests.some(r => r.method === "DELETE")).toBe(false);
  harness.state.conflict = false;
  await page.getByRole("button", { name: "Enable alerts" }).tap();
  await expect(page.getByRole("button", { name: "Turn off alerts" })).toBeEnabled();
  expect(harness.state.alertRequests).toHaveLength(2);
  expect(harness.state.alertRequests[1].body.subscription.endpoint).toBe("https://push.example.test/new-1");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ss:push")))).toEqual(CREDENTIALS);
  expect(await page.evaluate(() => window.__pushSimulation)).toEqual({ permissionRequests: 2, subscribes: 1, unsubscribes: 1 });
});

test("SIMULATED iPhone browser mode explains installation before allowing alerts", async ({ page, harness }) => {
  await harness.open({ push: { standalone: false } });
  await page.getByRole("button", { name: "Alerts", exact: true }).tap();
  await expect(page.getByRole("heading", { name: "Add to Home Screen for alerts" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Enable alerts" })).toHaveCount(0);
  expect(harness.state.alertRequests).toEqual([]);
});
