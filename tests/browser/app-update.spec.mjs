import { test, expect, dateInput } from "./fixtures.mjs";
const B = "b".repeat(40), C = "c".repeat(40);
async function mockHealth(page, initial = B) {
  const state = { commit: initial, count: 0, fail: false };
  await page.route("**/api/health", route => { state.count++; return route.fulfill({ status: state.fail ? 503 : 200, json: { version: "1", commit: state.commit } }); });
  return state;
}
async function detect(page, state) {
  await page.clock.fastForward(3100); await expect.poll(() => state.count).toBeGreaterThan(0);
  await page.clock.fastForward(10100); await expect(page.getByRole("button", { name: "Refresh app", exact: true })).toBeVisible();
}
test("confirms twice, dismisses per target, manual override shares Help owner and failure is truthful", async ({ page, harness }, testInfo) => {
  const state = await mockHealth(page); await harness.open();
  await page.clock.fastForward(3100); await expect.poll(() => state.count).toBe(1);
  await expect(page.getByRole("button", { name: "Refresh app", exact: true })).toHaveCount(0);
  await page.clock.fastForward(10100); await expect(page.locator(".app-update")).toContainText("An app update is available.");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `output/playwright/updater-${testInfo.project.name}.png`, fullPage: true });
  await page.getByRole("button", { name: "Later", exact: true }).click();
  await page.clock.fastForward(300_000); await expect(page.getByRole("button", { name: "Refresh app", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "How this scoreboard works" }).click();
  await page.getByRole("button", { name: "Check for app update", exact: true }).click();
  await page.clock.fastForward(2100); await expect(page.locator(".app-update")).toBeAttached();
  state.fail = true;
  await page.getByRole("button", { name: "Check for app update", exact: true }).click();
  await page.clock.fastForward(2100); await expect(page.locator(".help-body")).toContainText("Unable to check");
});
test("refresh preserves actual notification view without rescroll or alert mutation; Home clears tab and focus", async ({ page, harness }) => {
  const state = await mockHealth(page);
  await harness.open({ path: "/?date=2026-09-05&keep=yes#game-acc-final", push: { existing: true, credentials: true, permission: "granted" } });
  await page.getByLabel("Hide finals").check();
  await page.getByRole("button", { name: "Next day" }).click();
  await page.getByRole("tab", { name: /^Upsets/ }).click();
  await detect(page, state);
  await page.getByRole("button", { name: "Refresh app", exact: true }).click();
  await expect.poll(() => new URL(page.url()).hash).toBe("");
  await expect(page.getByRole("tab", { name: /^Upsets/ })).toHaveAttribute("aria-selected", "true");
  await expect(dateInput(page)).toHaveValue("2026-09-06");
  await expect(page.getByLabel("Hide finals")).toBeChecked();
  await expect.poll(() => page.url()).not.toContain("_ss_update");
  expect(new URL(page.url()).hash).toBe(""); expect(new URL(page.url()).searchParams.get("keep")).toBe("yes");
  expect(harness.state.alertRequests.filter(r => r.method !== "GET")).toEqual([]);
  expect(await page.evaluate(() => window.__pushSimulation)).toEqual({ permissionRequests: 0, subscribes: 0, unsubscribes: 0 });
  await page.getByRole("link", { name: "Saturday Signal home" }).click();
  await expect(page.getByRole("tab", { name: /^Watchlist/ })).toHaveAttribute("aria-selected", "true");
});
test("failed explicit verification stays open; returning loaded identity clears stale notice", async ({ page, harness }) => {
  const state = await mockHealth(page); await harness.open(); const loaded = await page.locator("main").getAttribute("data-app-commit");
  await detect(page, state); state.fail = true;
  await page.getByRole("button", { name: "Refresh app", exact: true }).click();
  await expect(page.locator(".app-update-status")).toContainText("Refresh could not be verified");
  await expect(page.getByRole("button", { name: "Refresh app", exact: true })).toBeEnabled();
  state.fail = false; state.commit = loaded;
  await page.clock.fastForward(300_000); await expect(page.locator(".app-update")).toHaveCount(0);
});
test("suspends while hidden and coalesces resume events; new target gets its own confirmation", async ({ page, harness }) => {
  const state = await mockHealth(page); await harness.open();
  await page.evaluate(() => Object.defineProperty(document, "hidden", { configurable: true, value: true }));
  await page.clock.fastForward(310_000); expect(state.count).toBe(0);
  await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, value: false }); window.dispatchEvent(new Event("focus")); window.dispatchEvent(new Event("online")); window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })); document.dispatchEvent(new Event("visibilitychange")); });
  await expect.poll(() => state.count).toBe(1);
  state.commit = C; await page.clock.fastForward(10100); await expect.poll(() => state.count).toBeGreaterThanOrEqual(2);
  await expect(page.locator(".app-update")).toHaveCount(0);
  await page.clock.fastForward(10100); await expect(page.locator(".app-update")).toBeVisible();
});
test("update keeps notification-only Watchlist membership, never rescrolls, and tolerates denied storage", async ({ page, harness }) => {
  const { event } = await import("./fixtures.mjs");
  harness.state.events = [event("notification-only", { scores: [0, 28] })];
  await page.addInitScript(() => {
    window.__scrolls = 0;
    Element.prototype.scrollIntoView = function () { window.__scrolls++; };
    Storage.prototype.getItem = function () { throw new Error("storage denied"); };
    Storage.prototype.setItem = function () { throw new Error("storage denied"); };
    Object.defineProperty(window, "caches", { value: { delete() { throw new Error("Updater must not delete caches"); } } });
  });
  const state = await mockHealth(page);
  await harness.open({ path: "/?date=2026-09-05#game-notification-only" });
  await expect(page.locator("#game-notification-only")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__scrolls)).toBe(1);
  await page.getByLabel("Hide finals").check();
  await detect(page, state);
  await page.getByRole("button", { name: "Later", exact: true }).click();
  await page.getByRole("button", { name: "How this scoreboard works" }).click();
  await page.getByRole("button", { name: "Check for app update", exact: true }).click();
  await page.clock.fastForward(2100);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Refresh app", exact: true }).click();
  await expect.poll(() => new URL(page.url()).hash).toBe("");
  await expect(page.locator("#game-notification-only")).toBeVisible();
  await expect(page.getByLabel("Hide finals")).toBeChecked();
  expect(await page.evaluate(() => window.__scrolls)).toBe(0);
  await page.getByRole("link", { name: "Saturday Signal home" }).click();
  await expect(page.locator("#game-notification-only")).toHaveCount(0);
});
