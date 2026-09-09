import { test, expect, CREDENTIALS, ALERT_ORIGIN } from "./fixtures.mjs";

test("SIMULATED preferences: stale re-enable reloads choices without reset or unsubscribe", async ({ page, harness }) => {
  harness.state.active = false;
  await harness.open({ push: { permission: "granted", existing: true, credentials: true } });
  await page.getByRole("button", { name: "Alerts", exact: true }).tap();
  await expect(page.getByRole("switch", { name: "Any close game", exact: true })).toBeChecked();
  harness.state.revision++; harness.state.closeGame = false;
  await page.getByRole("button", { name: "Enable alerts", exact: true }).tap();
  await expect(page.getByRole("status").filter({ hasText: "Review the reloaded choices" })).toBeVisible();
  await expect(page.getByRole("switch", { name: "Any close game", exact: true })).not.toBeChecked();
  await expect(page.getByRole("button", { name: "Reset alerts", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ss:push")))).toEqual(CREDENTIALS);
  expect(await page.evaluate(() => window.__pushSimulation.unsubscribes)).toBe(0);
  expect(harness.state.alertRequests.some(r => r.method === "DELETE")).toBe(false);
});

test("SIMULATED preferences: focused switch remains focused while a save is pending", async ({ page, harness }) => {
  await harness.open({ push: { permission: "granted", existing: true, credentials: true } });
  await page.getByRole("button", { name: "Alerts on", exact: true }).tap();
  let release; const held = new Promise(resolve => { release = resolve; }); let writes = 0;
  const handler = async route => { if (route.request().method() === "PATCH") { writes++; await held; } await route.fallback(); };
  await page.route(`${ALERT_ORIGIN}/subscriptions/*`, handler);
  try {
    const control = page.getByRole("switch", { name: "Any close game", exact: true });
    await control.focus(); await control.press("Space");
    await expect(control).toHaveAttribute("aria-busy", "true"); await expect(control).toBeFocused();
    expect(await control.evaluate(el => el.disabled)).toBe(false);
    await expect.poll(() => writes).toBe(1); await page.keyboard.press("Space"); expect(writes).toBe(1);
    release(); await expect(control).toHaveAttribute("aria-busy", "false"); await expect(control).toBeFocused();
  } finally { release(); await page.unroute(`${ALERT_ORIGIN}/subscriptions/*`, handler); }
});

for (const width of [320, 390]) test(`SIMULATED preferences: ${width}px large-text layout and keyboard switches`, async ({ page, harness }, testInfo) => {
  await page.setViewportSize({ width, height: 844 });
  await harness.open({ push: { permission: "granted", existing: true, credentials: true } });
  await page.getByRole("button", { name: "Alerts on", exact: true }).tap();
  await page.addStyleTag({ content: ".help-sheet { font-size: 150%; } .alert-setting small { font-size: 1em; }" });
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  for (const control of await dialog.getByRole("switch").all()) {
    // WebKit's transformed sheet can report 43.99994 for a 44 CSS-pixel target.
    const box = await control.boundingBox(); expect(Math.round(box.width * 100) / 100).toBeGreaterThanOrEqual(44); expect(Math.round(box.height * 100) / 100).toBeGreaterThanOrEqual(44);
    await control.focus(); await expect(control).toBeFocused();
  }
  const master = page.getByRole("switch", { name: "Notifications", exact: true });
  await master.focus(); await page.keyboard.press("Space"); await expect(master).not.toBeChecked();
  await master.press("Space"); await expect(master).toBeChecked();
  await page.screenshot({ path: testInfo.outputPath(`preferences-${width}.png`) });
  await page.keyboard.press("Escape"); await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Alerts on", exact: true })).toBeFocused();
});

test("SIMULATED preferences: selective defaults, saved switches, master retention and failed save", async ({ page, harness }) => {
  await harness.open();
  await page.getByRole("button", { name: "Alerts", exact: true }).tap();
  const upset = page.getByRole("switch", { name: "Upset watch", exact: true });
  const close = page.getByRole("switch", { name: "Any close game", exact: true });
  const master = page.getByRole("switch", { name: "Notifications", exact: true });
  await expect(upset).toBeChecked(); await expect(close).not.toBeChecked(); await expect(close).toBeDisabled();
  await page.getByRole("button", { name: "Enable alerts" }).tap();
  await expect(master).toBeChecked();
  expect(harness.state.alertRequests.find(r => r.method === "POST").body).toMatchObject({ upsetWatch: true, closeGame: false, upsetFinal: false, kickoff: false });
  await close.tap(); await expect(close).toBeChecked();
  harness.state.failSave = true;
  await upset.tap(); await expect(page.getByRole("status").filter({ hasText: "Settings checked" })).toBeVisible();
  await expect(upset).toBeChecked();
  harness.state.failSave = false;
  await master.tap(); await expect(master).not.toBeChecked(); await expect(close).toBeChecked(); await expect(close).toBeDisabled();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ss:push")))).toEqual(CREDENTIALS);
  expect(await page.evaluate(() => window.__pushSimulation.unsubscribes)).toBe(0);
  await master.tap(); await expect(master).toBeChecked(); await expect(close).toBeChecked();
  for (const name of ["Upset watch", "Any close game"]) { await page.getByRole("switch", { name, exact: true }).tap(); await expect(page.getByRole("switch", { name, exact: true })).not.toBeChecked(); }
  await expect(page.getByText("No alert types are selected. You will not receive game alerts.")).toBeVisible();
  await page.reload(); await page.getByRole("button", { name: "Alerts on", exact: true }).tap();
  await expect(close).not.toBeChecked(); await expect(master).toBeChecked();
});

test("SIMULATED preferences: server activity alone cannot claim this browser is subscribed", async ({ page, harness }) => {
  await harness.open({ push: { permission: "granted", existing: false, credentials: true } });
  await page.getByRole("button", { name: "Alerts", exact: true }).tap();
  await expect(page.getByRole("switch", { name: "Notifications", exact: true })).not.toBeChecked();
  await expect(page.getByRole("button", { name: "Enable alerts" })).toBeEnabled();
});

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
  await expect(page.getByRole("switch", { name: "Notifications", exact: true })).toBeChecked();
  await expect(page.getByRole("switch", { name: "ACC kickoff reminders" })).toBeChecked();
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
  await expect(page.getByRole("switch", { name: "Notifications", exact: true })).toBeChecked();
  expect(harness.state.alertRequests).toHaveLength(3);
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
