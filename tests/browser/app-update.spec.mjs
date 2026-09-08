import { test, expect, dateInput } from "./fixtures.mjs";
const B = "b".repeat(40), C = "c".repeat(40);
async function mockHealth(page, initial = B) {
  const state = { commit: initial, count: 0, fail: false };
  await page.route("**/api/health", route => { state.count++; return route.fulfill({ status: state.fail ? 503 : 200, json: { version: "1", commit: state.commit } }); });
  return state;
}
async function detect(page, state) {
  const received = page.waitForResponse(response => new URL(response.url()).pathname === "/api/health");
  await page.clock.fastForward(3100); await (await received).finished(); await expect.poll(() => state.count).toBeGreaterThan(0);
  await page.waitForTimeout(50);
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
  const savedPush = await page.evaluate(() => localStorage.getItem("ss:push"));
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
  expect(await page.evaluate(() => localStorage.getItem("ss:push"))).toBe(savedPush);
  expect(await page.evaluate(() => Object.keys(localStorage).some(key => key.startsWith("ss:board:")))).toBe(true);
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
test("updater preserves initial manual date before slow scores finish", async ({ page, harness }) => {
  const state = await mockHealth(page);
  // Hold score fetches before the network layer, including the fallback. This
  // avoids WebKit reporting CORS errors for fulfilled requests from a departed
  // document, and still exercises the real score client's timeout/fallback.
  await page.addInitScript(() => {
    const fetchOriginal = window.fetch.bind(window), pending = []; let allowed = false;
    window.__releaseScores = () => { allowed = true; for (const resume of pending) resume(); };
    window.fetch = (input, options) => {
      if (allowed || !/scoreboard|\/api\/scores/.test(String(input))) return fetchOriginal(input, options);
      return new Promise((resolve, reject) => {
        const abort = () => reject(new DOMException("Simulated slow scores aborted", "AbortError"));
        if (options?.signal?.aborted) { abort(); return; }
        options?.signal?.addEventListener("abort", abort, { once: true });
        pending.push(() => { if (!options?.signal?.aborted) resolve(fetchOriginal(input, options)); });
      });
    };
  });
  await harness.open({ path: "/?date=2026-09-04&keep=slow", waitForScores: false });
  await expect(page.getByRole("button", { name: "Refresh scores" })).toBeDisabled();
  await detect(page, state); await expect(dateInput(page)).toHaveValue("");
  const navigation = page.waitForEvent("load");
  await page.getByRole("button", { name: "Refresh app", exact: true }).click(); await navigation;
  expect(new URL(page.url()).searchParams.get("date")).toBe("2026-09-04");
  await page.evaluate(() => window.__releaseScores()); await expect(dateInput(page)).toHaveValue("2026-09-04");
});
test("keyboard verification keeps focus, ignores repeated activation and recovers after failure", async ({ page, harness }) => {
  const state = await mockHealth(page); await harness.open(); await detect(page, state);
  let release;
  await page.route("**/api/health", async route => { state.count++; await new Promise(resolve => { release = resolve; }); await route.fulfill({ status: 503, json: {} }); });
  const button = page.getByRole("button", { name: "Refresh app", exact: true });
  await button.focus(); const before = state.count;
  await page.keyboard.press("Enter"); await expect(button).toHaveAttribute("aria-disabled", "true");
  await expect(button).toBeFocused(); await page.keyboard.press("Enter"); expect(state.count).toBe(before + 1);
  release(); await expect(button).toHaveAttribute("aria-disabled", "false"); await expect(button).toBeFocused();
  await expect(page.locator(".app-update-status")).toContainText("Refresh could not be verified");
  // WebKit follows the platform preference for tabbing to buttons. Exercise
  // keyboard activation and focus retention independently of that preference.
  await page.getByRole("button", { name: "Later", exact: true }).focus();
  await page.keyboard.press("Enter"); await expect(page.locator(".app-update")).toHaveCount(0);
  await expect(page.getByText("An app update is available.", { exact: true })).toHaveCount(0);
});

// These transitions simulate lifecycle signals, not OS suspension or a lost
// connection. Keeping the network mocked lets an in-flight response settle
// deterministically while the real browser renders the Help status.
async function suspendUpdater(page, mode, suspended) {
  await page.evaluate(({ mode, suspended }) => {
    if (mode === "hidden") {
      Object.defineProperty(document, "hidden", { configurable: true, value: suspended });
      document.dispatchEvent(new Event("visibilitychange"));
    } else {
      Object.defineProperty(navigator, "onLine", { configurable: true, value: !suspended });
      window.dispatchEvent(new Event(suspended ? "offline" : "online"));
    }
  }, { mode, suspended });
}
for (const mode of ["hidden", "offline"]) {
  for (const timing of ["queued", "in-flight"]) {
    for (const outcome of ["loaded", "failure", "dismissed target"]) {
      test(`Help ${timing} ${outcome} response expires across ${mode} suspension`, async ({ page, harness }) => {
        const state = await mockHealth(page);
        await harness.open();
        const loaded = await page.locator("main").getAttribute("data-app-commit");
        await detect(page, state);
        await page.getByRole("button", { name: "Later", exact: true }).click();
        expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("ss:app-update-dismissed")))).toContain(B);
        // Clear the confirmed candidate with an ordinary background observation.
        state.commit = loaded;
        await page.clock.fastForward(2100);
        const baseline = state.count;
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        await expect.poll(() => state.count).toBe(baseline + 1);
        await expect(page.locator(".app-update")).toHaveCount(0);
        if (timing === "in-flight") await page.clock.fastForward(2100);
        let release;
        const settled = page.waitForResponse(response => new URL(response.url()).pathname === "/api/health");
        await page.route("**/api/health", async route => {
          state.count++;
          await new Promise(resolve => { release = resolve; });
          await route.fulfill({ status: outcome === "failure" ? 503 : 200, json: { version: "1", commit: outcome === "dismissed target" ? B : loaded } });
        });
        await page.getByRole("button", { name: "How this scoreboard works" }).click();
        const help = page.locator(".help-body"), check = page.getByRole("button", { name: "Check for app update", exact: true });
        await check.click();
        await expect(help).toContainText("Checking for an app update…");
        if (timing === "in-flight") await expect.poll(() => typeof release).toBe("function");
        else expect(release).toBeUndefined();
        await suspendUpdater(page, mode, true);
        await expect(help).not.toContainText("Checking for an app update…");
        if (timing === "queued") {
          await page.clock.fastForward(2100);
          expect(release).toBeUndefined();
          await suspendUpdater(page, mode, false);
          await expect.poll(() => typeof release).toBe("function");
        }
        release(); await (await settled).finished();
        // A new request is no longer held after this controlled response.
        await page.unroute("**/api/health");
        state.commit = outcome === "dismissed target" ? B : loaded;
        await page.route("**/api/health", route => { state.count++; return route.fulfill({ status: outcome === "failure" ? 503 : 200, json: { version: "1", commit: state.commit } }); });
        await page.waitForTimeout(50);
        await expect(help).not.toContainText("The app is up to date.");
        await expect(help).not.toContainText("Unable to check");
        await expect(help).not.toContainText("being verified");
        await expect(page.locator(".app-update")).toHaveCount(0);
        if (timing === "in-flight") await suspendUpdater(page, mode, false);
        if (outcome === "dismissed target") {
          await page.clock.fastForward(10100);
          await expect(help).toContainText("An app update is available.");
          expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("ss:app-update-dismissed")))).not.toContain(B);
        } else {
          await check.click(); await page.clock.fastForward(2100);
          await expect(help).toContainText(outcome === "failure" ? "Unable to check for an app update. Please try again." : "The app is up to date.");
        }
        expect(harness.state.alertRequests.filter(request => request.method !== "GET")).toEqual([]);
      });
    }
  }
  for (const outcome of ["loaded", "dismissed target"]) {
    test(`Help confirmation wait expires across ${mode}; ${outcome} resumes correctly`, async ({ page, harness }) => {
      const state = await mockHealth(page); await harness.open();
      const loaded = await page.locator("main").getAttribute("data-app-commit");
      await detect(page, state); await page.getByRole("button", { name: "Later", exact: true }).click();
      state.commit = C; await page.clock.fastForward(2100);
      const before = state.count;
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect.poll(() => state.count).toBe(before + 1);
      await page.clock.fastForward(2100); state.commit = B;
      await page.getByRole("button", { name: "How this scoreboard works" }).click();
      await page.getByRole("button", { name: "Check for app update", exact: true }).click();
      const help = page.locator(".help-body");
      await expect(help).toContainText("An app update is being verified.");
      await suspendUpdater(page, mode, true);
      await expect(help).not.toContainText("being verified");
      const suspendedCount = state.count;
      await page.clock.fastForward(10100);
      expect(state.count).toBe(suspendedCount);
      await expect(page.locator(".app-update")).toHaveCount(0);
      state.commit = outcome === "loaded" ? loaded : B;
      await suspendUpdater(page, mode, false);
      await expect.poll(() => state.count).toBe(suspendedCount + 1);
      if (outcome === "loaded") {
        await expect(help).not.toContainText("The app is up to date.");
        await expect(page.locator(".app-update")).toHaveCount(0);
      } else {
        // Immediate availability proves the ten-second candidate survived;
        // removing B from dismissal storage proves the explicit Later override.
        await expect(help).toContainText("An app update is available.");
        expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("ss:app-update-dismissed")))).not.toContain(B);
      }
    });
  }
}
