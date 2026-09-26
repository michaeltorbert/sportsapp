import { test, expect, CREDENTIALS, ALERT_ORIGIN } from "./fixtures.mjs";

const enlargedAlertText = '.alerts-sheet [data-slot="sheet-title"] { font-size: 34.5px; } .alerts-sheet [data-slot="sheet-description"] { font-size: 21px; } .alerts-sheet .help-body { font-size: 24px; } .alerts-sheet .alert-setting strong { font-size: 24px; } .alerts-sheet .alert-setting small, .alerts-sheet .alert-footnote { font-size: 19.5px; } .alerts-sheet .alert-setting > .alert-switch { font-size: 24px; } .alerts-sheet .alert-details { font-size: 21px; }';
const capture = async (page, info, name) => page.screenshot({ path: process.env.ALERT_SCREENSHOT_DIR ? `${process.env.ALERT_SCREENSHOT_DIR}/after-${info.project.name}-${name}.png` : info.outputPath(`${name}.png`) });

for (const width of [320, 390]) for (const scale of [100, 150]) test(`SIMULATED alert switch: ${width}px ${scale}% text, readable states and disclosure`, async ({ page, harness }, info) => {
  await page.setViewportSize({ width, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  harness.state.upsetFinal = false;
  await harness.open({ push: { permission: "granted", existing: true, credentials: true } });
  await page.getByRole("button", { name: "Alerts on", exact: true }).tap();
  if (scale === 150) await page.addStyleTag({ content: enlargedAlertText });
  const sheet = page.getByRole("dialog");
  const prefix = `${width}-${scale}`;
  await capture(page, info, `${prefix}-on-off`);
  const descriptions = [
    ["Notifications", "Turning off stops future alerts; your choices stay saved."],
    ["Upset watch", "A ranked favorite under threat in Q4 or overtime."],
    ["Any close game", "Games tied or within 8 points in Q4 or overtime. Stronger games take priority."],
    ["Upset final results", "A ranked team loses to an unranked or lower-ranked opponent."],
    ["ACC kickoff reminders", "10 minutes before a game involving an ACC team."],
  ];
  for (const [name, description] of descriptions) {
    const control = sheet.getByRole("switch", { name, exact: true });
    await expect(control).toHaveAccessibleDescription(description);
    const box = await control.boundingBox();
    expect(Math.round(box.width)).toBe(56); expect(Math.round(box.height)).toBe(44);
    const geometry = await control.evaluate(input => {
      const face = input.nextElementSibling, track = face.getBoundingClientRect();
      const thumb = face.querySelector('.alert-switch-thumb').getBoundingClientRect();
      const check = face.querySelector('.alert-switch-check');
      return { contained: thumb.left >= track.left && thumb.right <= track.right && thumb.top >= track.top && thumb.bottom <= track.bottom, checkedCue: getComputedStyle(check).display !== 'none', checked: input.checked, width: input.getBoundingClientRect().width, height: input.getBoundingClientRect().height, pointerEvents: getComputedStyle(face).pointerEvents };
    });
    expect(geometry.checkedCue).toBe(geometry.checked);
    expect(geometry.contained).toBe(true); expect(geometry.pointerEvents).toBe("none");
  }
  expect(await sheet.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const finals = sheet.getByRole("switch", { name: "Upset final results", exact: true });
  await sheet.getByText("Upset final results", { exact: true }).tap();
  await expect(finals).toBeChecked();
  await finals.focus(); await finals.press("Space"); await expect(finals).not.toBeChecked();
  const summary = sheet.locator("summary");
  expect((await summary.boundingBox()).height).toBeGreaterThanOrEqual(44);
  const writes = harness.state.alertRequests.filter(r => r.method !== "GET").length;
  await summary.focus(); await summary.press("Enter");
  await expect(sheet.locator("details")).toHaveAttribute("open", "");
  await sheet.getByText("Scoreboard categories do not filter notifications.", { exact: false }).scrollIntoViewIfNeeded();
  await capture(page, info, `${prefix}-expanded`);
  expect(harness.state.alertRequests.filter(r => r.method !== "GET")).toHaveLength(writes);
  const master = sheet.getByRole("switch", { name: "Notifications", exact: true });
  await master.focus(); await master.press("Space"); await expect(master).not.toBeChecked();
  const upset = sheet.getByRole("switch", { name: "Upset watch", exact: true });
  await expect(upset).toBeChecked(); await expect(upset).toBeDisabled();
  expect(await upset.evaluate(input => getComputedStyle(input.nextElementSibling).opacity)).toBe("1");
  await upset.scrollIntoViewIfNeeded(); await capture(page, info, `${prefix}-disabled-on`);
  await sheet.getByRole("button", { name: "Close", exact: true }).scrollIntoViewIfNeeded();
  await sheet.getByRole("button", { name: "Close", exact: true }).tap();
  await expect(sheet).not.toBeVisible();
});

test("SIMULATED alert switch: 320px 200% text preserves check marks and disabled cues", async ({ page, harness }, info) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  harness.state.upsetFinal = false;
  await harness.open({ push: { permission: "granted", existing: true, credentials: true } });
  await page.getByRole("button", { name: "Alerts on", exact: true }).tap();
  await page.addStyleTag({ content: '.alerts-sheet [data-slot="sheet-title"] { font-size: 46px; } .alerts-sheet [data-slot="sheet-description"] { font-size: 28px; } .alerts-sheet .help-body, .alerts-sheet .alert-setting strong, .alerts-sheet .alert-setting > .alert-switch { font-size: 32px; } .alerts-sheet .alert-setting small, .alerts-sheet .alert-footnote { font-size: 26px; } .alerts-sheet .alert-details { font-size: 28px; }' });
  const master = page.getByRole("switch", { name: "Notifications", exact: true });
  const on = page.getByRole("switch", { name: "Upset watch", exact: true });
  const off = page.getByRole("switch", { name: "Upset final results", exact: true });
  const checkGeometry = async control => {
    const geometry = await control.evaluate(input => {
      const face = input.nextElementSibling, track = face.getBoundingClientRect();
      const thumb = face.querySelector('.alert-switch-thumb').getBoundingClientRect();
      const check = face.querySelector('.alert-switch-check');
      return { contained: thumb.left >= track.left && thumb.right <= track.right && thumb.top >= track.top && thumb.bottom <= track.bottom, checkedCue: getComputedStyle(check).display !== 'none', checked: input.checked, width: input.getBoundingClientRect().width, height: input.getBoundingClientRect().height, pointerEvents: getComputedStyle(face).pointerEvents };
    });
    expect(geometry.checkedCue).toBe(geometry.checked); expect(geometry.contained).toBe(true);
    expect(Math.round(geometry.width)).toBe(56); expect(Math.round(geometry.height)).toBe(44);
  };
  expect(await on.locator("..").evaluate(el => getComputedStyle(el).fontSize)).toBe("32px");
  expect(await page.locator('.alert-setting small').first().evaluate(el => getComputedStyle(el).fontSize)).toBe("26px");
  await expect(on).toBeChecked(); await expect(off).not.toBeChecked();
  for (const control of [on, off]) await checkGeometry(control);
  await on.scrollIntoViewIfNeeded(); await capture(page, info, "320-200-on");
  await off.scrollIntoViewIfNeeded(); await capture(page, info, "320-200-off");
  await master.focus(); await master.press("Space"); await expect(master).not.toBeChecked();
  for (const forcedColors of ["none", "active"]) {
    await page.emulateMedia({ forcedColors });
    if (forcedColors === "active" && !await page.evaluate(() => matchMedia('(forced-colors: active)').matches)) {
      info.annotations.push({ type: "limitation", description: "Forced-colors emulation is unavailable." });
      continue;
    }
    for (const [state, control] of [["on", on], ["off", off]]) {
      await expect(control).toBeDisabled(); await checkGeometry(control);
      expect(await control.evaluate(input => getComputedStyle(input.nextElementSibling).borderTopStyle)).toBe("dashed");
      await control.scrollIntoViewIfNeeded(); await capture(page, info, `320-200-disabled-${state}-${forcedColors}`);
    }
  }
  await expect(on).toBeChecked(); await expect(off).not.toBeChecked();
  expect(await page.getByRole("dialog").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
});

test("SIMULATED alert switch: focus, busy, reduced motion and monochrome", async ({ page, harness, browserName }, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await harness.open({ push: { permission: "granted", existing: true, credentials: true } });
  await page.getByRole("button", { name: "Alerts on", exact: true }).tap();
  const control = page.getByRole("switch", { name: "Any close game", exact: true });
  await page.keyboard.press("Tab"); await control.focus(); await control.press("ArrowRight");
  await expect(control).toBeFocused();
  expect(await control.evaluate(el => getComputedStyle(el).outlineWidth)).toBe("2px");
  await capture(page, info, "focus");
  let release; const held = new Promise(resolve => { release = resolve; });
  const handler = async route => { if (route.request().method() === "PATCH") await held; await route.fallback(); };
  await page.route(`${ALERT_ORIGIN}/subscriptions/*`, handler);
  try {
    await control.press("Space"); await expect(control).toHaveAttribute("aria-busy", "true");
    expect(await control.locator("..").evaluate(el => getComputedStyle(el, "::after").animationName)).toBe("none");
    await capture(page, info, "busy-reduced-motion");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    expect(await control.locator("..").evaluate(el => getComputedStyle(el, "::after").animationName)).toBe("alert-save-pulse");
    await page.emulateMedia({ reducedMotion: "reduce" });
  } finally { release(); await expect(control).toHaveAttribute("aria-busy", "false"); await page.unroute(`${ALERT_ORIGIN}/subscriptions/*`, handler); }
  const grayscale = await page.addStyleTag({ content: '.alerts-sheet { filter: grayscale(1); }' });
  await capture(page, info, "grayscale"); await grayscale.evaluate(el => el.remove());
  await page.emulateMedia({ forcedColors: "active" });
  if (await page.evaluate(() => matchMedia('(forced-colors: active)').matches)) {
    expect(await control.evaluate(el => getComputedStyle(el.nextElementSibling).borderTopStyle)).toBe("solid");
    await capture(page, info, "forced-colors");
  } else info.annotations.push({ type: "limitation", description: `${browserName} does not expose forced-colors emulation.` });
});

test("SIMULATED close-game alerts disclose global slate prioritization", async ({ page, harness }) => {
  await harness.open({ push: { permission: "granted", existing: true, credentials: true } });
  await page.getByRole("button", { name: "Alerts on", exact: true }).tap();
  await expect(page.getByText("Close-game alerts prioritize stronger live games", { exact: false })).not.toBeVisible();
  const writes = harness.state.alertRequests.filter(r => r.method !== "GET").length;
  const summary = page.locator(".alert-details summary");
  await summary.focus(); await summary.press("Enter");
  await expect(page.getByText("Close-game alerts prioritize stronger live games", { exact: false })).toBeVisible();
  await expect(page.getByText("even if you disabled or already received the stronger alert", { exact: false })).toBeVisible();
  await expect(page.getByText("may skip two-unranked Group-of-Six matchups", { exact: false })).toBeVisible();
  expect(harness.state.alertRequests.filter(r => r.method !== "GET")).toHaveLength(writes);
  await summary.press("Space");
  await expect(page.locator(".alert-details")).not.toHaveAttribute("open", "");
});

for (const code of [404, 503]) test(`SIMULATED preferences: settings GET ${code} preserves config and blocks unconfirmed writes`, async ({ page, harness }) => {
  harness.state.getStatus = code;
  await harness.open({ push: { permission: "granted", existing: true, credentials: true } });
  await page.getByRole("button", { name: "Alerts off", exact: true }).tap();
  await expect(page.getByRole("status").filter({ hasText: code === 404 ? "Reset alerts" : "next check will retry" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Alerts are being set up" })).toHaveCount(0);
  await expect(page.getByRole("switch", { name: "Notifications", exact: true })).toBeDisabled();
  if (code === 404) await expect(page.getByRole("button", { name: "Reset alerts", exact: true })).toBeVisible();
  else await expect(page.getByRole("button", { name: "Reset alerts", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Enable alerts", exact: true })).toHaveCount(0);
  expect(harness.state.alertRequests.every(r => r.method === "GET")).toBe(true);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ss:push")))).toEqual(CREDENTIALS);
  harness.state.getStatus = 0; await page.clock.fastForward(31000);
  await expect(page.getByRole("switch", { name: "Notifications", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Reset alerts", exact: true })).toHaveCount(0);
});

test("SIMULATED preferences: stale re-enable reloads choices without reset or unsubscribe", async ({ page, harness }) => {
  harness.state.active = false;
  await harness.open({ push: { permission: "granted", existing: true, credentials: true } });
  await page.getByRole("button", { name: "Alerts off", exact: true }).tap();
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
    const thumb = control.locator("..").locator(".alert-switch-thumb");
    const confirmedPosition = await thumb.evaluate(el => getComputedStyle(el).transform);
    await control.focus(); await control.press("Space");
    await expect(control).toHaveAttribute("aria-busy", "true"); await expect(control).toBeFocused();
    await expect(control).toBeChecked();
    expect(await thumb.evaluate(el => getComputedStyle(el).transform)).toBe(confirmedPosition);
    await expect(page.locator('.alert-switch[data-pending="true"]')).toHaveCount(1);
    await expect(control.locator("..")).toHaveAttribute("data-pending", "true");
    expect(await control.evaluate(el => el.disabled)).toBe(false);
    await expect.poll(() => writes).toBe(1); await page.keyboard.press("Space"); expect(writes).toBe(1);
    release(); await expect(control).toHaveAttribute("aria-busy", "false"); await expect(control).toBeFocused();
    await expect(control).not.toBeChecked();
    await expect(page.locator('.alert-switch[data-pending="true"]')).toHaveCount(0);
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
    const box = await control.boundingBox(); expect(Math.round(box.width * 100) / 100).toBe(56); expect(Math.round(box.height * 100) / 100).toBe(44);
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
  await page.getByRole("button", { name: "Alerts off", exact: true }).tap();
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
  await page.getByRole("button", { name: "Alerts off", exact: true }).tap();
  await expect(page.getByRole("switch", { name: "Notifications", exact: true })).not.toBeChecked();
  await expect(page.getByRole("button", { name: "Enable alerts" })).toBeEnabled();
});

test("SIMULATED alerts: readiness updates automatically before enable becomes available", async ({ page, harness }, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  harness.state.ready = false;
  await harness.open();
  await page.getByRole("button", { name: "Alerts off", exact: true }).tap();
  await expect(page.getByRole("heading", { name: "Alerts are being set up" })).toBeVisible();
  await page.getByRole("heading", { name: "Alerts are being set up" }).scrollIntoViewIfNeeded();
  await capture(page, info, "setup");
  await expect(page.getByRole("button", { name: "Enable alerts" })).toHaveCount(0);
  harness.state.ready = true;
  await page.clock.fastForward(31_000);
  await expect(page.getByRole("button", { name: "Enable alerts" })).toBeEnabled();
  expect(harness.state.alertRequests).toEqual([]);
});

test("SIMULATED alerts: unavailable config is reported and recovers on a later check", async ({ page, harness }) => {
  harness.state.failConfig = true;
  await harness.open();
  await page.getByRole("button", { name: "Alerts off", exact: true }).tap();
  await expect(page.getByRole("status").filter({ hasText: "The alert service is unavailable" })).toBeVisible();
  harness.state.failConfig = false;
  await page.clock.fastForward(31_000);
  await expect(page.getByRole("button", { name: "Enable alerts" })).toBeEnabled();
  await expect(page.getByText("The alert service is unavailable. Try again later.", { exact: true })).toHaveCount(0);
});

test("SIMULATED alerts: denied permission does not register a subscription", async ({ page, harness }) => {
  await harness.open({ push: { permission: "denied", permissionResult: "denied" } });
  await page.getByRole("button", { name: "Alerts off", exact: true }).tap();
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
  await page.getByRole("button", { name: "Alerts off", exact: true }).tap();
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
  await page.getByRole("button", { name: "Alerts off", exact: true }).tap();
  await expect(page.getByRole("heading", { name: "Add to Home Screen for alerts" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Enable alerts" })).toHaveCount(0);
  expect(harness.state.alertRequests).toEqual([]);
});
