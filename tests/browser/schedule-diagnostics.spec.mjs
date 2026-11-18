import { test, expect } from "./fixtures.mjs";

// Controlled acquisition fixtures only: no real provider request or production fault switch.
async function verifyMuteBeforeApp(page) {
  await page.goto("about:blank");
  expect(await page.evaluate(() => { const audio = document.createElement("audio"); document.body.append(audio); audio.dispatchEvent(new Event("loadstart", { bubbles: true })); const muted = audio.muted; audio.remove(); return muted; })).toBe(true);
}
async function openDiagnostics(page) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByText("Schedule diagnostics", { exact: true }).click();
  return page.getByRole("textbox", { name: "Diagnostic report" });
}
test("controlled schedule failure survives recovery and reload; Copy/select/Clear export actual sanitized local evidence", async ({ page, harness }, testInfo) => {
  await verifyMuteBeforeApp(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async value => { if (window.__clipboardDenied) throw Error("denied"); window.__diagnosticCopy = value; } } });
  });
  harness.state.failScores = true;
  await harness.open({ waitForScores: true });
  let report = await openDiagnostics(page);
  await expect.poll(async () => JSON.parse(await report.inputValue()).incidents.some(x => x.outcome === "failed")).toBe(true);
  const initial = JSON.parse(await report.inputValue()).incidents, failure = initial.find(x => x.scope === "week" && x.outcome === "failed");
  expect(failure).toBeTruthy(); expect(failure.observations.some(o => o.stage === "hosted" && o.status === 503)).toBe(true);
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.getByText("Schedule diagnostics", { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`schedule-support-${width}-context.png`) });
    await page.locator(".schedule-diagnostics").screenshot({ path: testInfo.outputPath(`schedule-support-${width}-report.png`) });
    expect(await page.locator(".schedule-diagnostics").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  }
  await page.getByRole("button", { name: "Copy diagnostics", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Diagnostics copied" })).toBeVisible();
  expect(await page.evaluate(() => window.__diagnosticCopy)).toBe(await report.inputValue());
  await page.evaluate(() => { window.__clipboardDenied = true; });
  await page.getByRole("button", { name: "Copy diagnostics", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Copy was unavailable" })).toBeVisible();
  await page.getByRole("button", { name: "Select diagnostics", exact: true }).click();
  expect(await report.evaluate(element => element.selectionEnd - element.selectionStart)).toBe((await report.inputValue()).length);
  await page.keyboard.press("Escape"); harness.state.failScores = false;
  await page.getByRole("button", { name: "Refresh scores", exact: true }).click();
  await expect(page.getByRole("button", { name: "Refresh scores", exact: true })).toBeEnabled();
  report = await openDiagnostics(page);
  await expect.poll(async () => JSON.parse(await report.inputValue()).incidents.find(x => x.id === failure.id)?.recoveredAt).toBeTruthy();
  await page.reload(); await expect(page.getByRole("button", { name: "Refresh scores", exact: true })).toBeEnabled();
  report = await openDiagnostics(page);
  expect(JSON.parse(await report.inputValue()).incidents.find(x => x.id === failure.id)?.recoveredAt).toBeTruthy();
  expect(await report.inputValue()).not.toMatch(/simulated feed|authorization|subscription|ownerToken|Team [ab]/);
  await page.evaluate(() => localStorage.setItem("diagnostic-unrelated-test", "keep"));
  await page.getByRole("button", { name: "Clear diagnostics", exact: true }).click();
  await expect(page.getByText("No saved reports.", { exact: false })).toBeVisible();
  expect(JSON.parse(await report.inputValue()).incidents).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem("diagnostic-unrelated-test"))).toBe("keep");
});
