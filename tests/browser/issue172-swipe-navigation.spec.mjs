import { test, expect, event, standardEvents, dateInput, period, category } from "./fixtures.mjs";

// Issue 172 browser evidence. Chromium gestures are real input-pipeline touches sent with CDP
// Input.dispatchTouchEvent, so touch-action, scrolling and pointercancel apply. WebKit has no such
// channel here: its gestures are synthetic PointerEvents dispatched in the page, which exercise the
// recognizer but not native touch arbitration, scrolling or compatibility clicks. Neither is an
// iPhone; Safari, Home Screen, edge navigation and zoomed panning remain unverified natively.

async function screenshot(page, testInfo, name) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true, animations: "disabled" });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

// Spec-local copy of the #171 check: the fixture's media mute is active before any interaction.
async function assertFixtureMediaIsMuted(page) {
  const muted = await page.evaluate(() => {
    const media = document.createElement("video");
    media.muted = false;
    document.body.append(media);
    // This real event reaches the fixture's capture listener without starting playback.
    media.dispatchEvent(new Event("play", { bubbles: true }));
    const result = media.muted;
    media.remove();
    return result;
  });
  expect(muted, "the browser fixture mutes media before interaction").toBe(true);
}

// Input evidence for the Linux Chromium CI failures (taps after committed CDP swipes had no effect):
// which input events of each touch reached the page, in order. It first showed committed swipes'
// touchends never reached window (the step re-rendered inside pointerup); fixing that did not restore
// the taps. Every lost tap followed a horizontal touch the browser neither panned nor cancelled, so the
// page now consumes such a touch's touchmoves. expectSwipeTouchEnded asserts both. Recording only; passive
// listeners that never cancel, stop or change anything. Attached for every Chromium test, passing or
// failing, so a lost tap (no touch/pointer events), a browser-suppressed tap (touch/pointer events but
// no click) and an app-suppressed click (click at window capture but not at window bubble) differ.
test.beforeEach(async ({ page, browserName }) => {
  if (browserName !== "chromium") return;
  await page.addInitScript(() => {
    const log = [];
    Object.defineProperty(window, "__issue172Input", { value: log });
    const describe = target => target instanceof Element ? `${target.tagName.toLowerCase()}${target.id ? `#${target.id}` : ""}${target.getAttribute("aria-label") ? `[${target.getAttribute("aria-label")}]` : ""}${target.closest("article.game-card") ? ` in ${target.closest("article.game-card").id}` : ""}` : String(target);
    const record = (phase, event) => log.push({ phase, type: event.type, t: Math.round(performance.now()), trusted: event.isTrusted, pointer: event.pointerType ?? null, id: event.pointerId ?? null, detail: event.detail ?? null, prevented: event.defaultPrevented, target: describe(event.target) });
    for (const type of ["touchstart", "touchend", "touchcancel", "pointerdown", "pointerup", "pointercancel", "click"]) addEventListener(type, event => record("capture", event), { capture: true, passive: true });
    addEventListener("click", event => record("bubble", event), { passive: true });
    let moves = 0, touchMoves = 0, consumed = 0;
    addEventListener("pointermove", () => { moves++; }, { capture: true, passive: true });
    // Read at window bubble, after the app's region listener: how many touchmoves the app consumed.
    addEventListener("touchmove", event => { touchMoves++; if (event.defaultPrevented) consumed++; }, { passive: true });
    addEventListener("pointerup", event => { log.push({ phase: "moves-before-up", count: moves, touchMoves, consumed, id: event.pointerId }); moves = 0; touchMoves = 0; consumed = 0; }, { capture: true, passive: true });
    addEventListener("pointercancel", () => { log.push({ phase: "moves-before-cancel", count: moves, touchMoves, consumed }); moves = 0; touchMoves = 0; consumed = 0; }, { capture: true, passive: true });
  });
  // Opt-in reproduction aid for slower runners; off unless ISSUE172_CPU_THROTTLE is set (e.g. 4).
  const rate = Number(process.env.ISSUE172_CPU_THROTTLE || 0);
  if (rate > 1) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate });
    test.info().annotations.push({ type: "diagnostic", description: `CPU throttled ${rate}× (ISSUE172_CPU_THROTTLE)` });
  }
});
test.afterEach(async ({ page, browserName }, testInfo) => {
  if (browserName !== "chromium" || page.isClosed()) return;
  let log;
  try { log = await page.evaluate(() => window.__issue172Input ?? null); } catch (error) { log = { unavailable: error.message }; }
  await testInfo.attach("issue172-input-log", { contentType: "application/json", body: JSON.stringify(log, null, 1) });
});

// Regression for the Linux CI cause: a committed swipe's own touchend must still reach window, i.e.
// the step's re-render waits until the touch sequence has ended (Chromium input log only).
async function expectSwipeTouchEnded(page, browserName) {
  if (browserName !== "chromium") return;
  const log = await page.evaluate(() => window.__issue172Input);
  const up = log.findLastIndex(entry => entry.phase === "capture" && entry.type === "pointerup");
  expect(up, "the swipe's pointerup was recorded").toBeGreaterThanOrEqual(0);
  expect(log.slice(up + 1).some(entry => entry.type === "touchend"), "the committed swipe's touchend reached window").toBe(true);
  // The page owned the horizontal touch: its touchmoves were consumed, so the browser made no scroll
  // or fling gesture of it. (Ordinary taps afterwards are asserted by each test itself.)
  const moves = log.slice(up).find(entry => entry.phase === "moves-before-up");
  expect(moves?.consumed, "the committed swipe's horizontal touchmoves were consumed by the page").toBeGreaterThan(0);
}

function inputKind(browserName) {
  const description = browserName === "chromium" ? "Chromium CDP Input.dispatchTouchEvent touches (browser input pipeline)" : "WebKit synthetic PointerEvents dispatched in the page (not native touch; no browser scrolling or compatibility clicks)";
  test.info().annotations.push({ type: "gesture input", description });
}

async function cdpDrag(page, from, to, { fingers = 1, steps = 10 } = {}) {
  const cdp = await page.context().newCDPSession(page);
  const points = (x, y) => Array.from({ length: fingers }, (_, id) => ({ x: x + id * 50, y, id }));
  try {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points(from.x, from.y) });
    for (let i = 1; i <= steps; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: points(from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps) });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } finally { await cdp.detach(); }
}

async function syntheticDrag(page, from, to) {
  await page.evaluate(({ from, to }) => {
    const target = document.elementFromPoint(from.x, from.y);
    const fire = (type, x, y) => target.dispatchEvent(new PointerEvent(type, { pointerId: 41, pointerType: "touch", isPrimary: true, button: type === "pointermove" ? -1 : 0, buttons: type === "pointerup" ? 0 : 1, clientX: x, clientY: y, bubbles: true, cancelable: true, composed: true }));
    fire("pointerdown", from.x, from.y);
    for (let i = 1; i <= 10; i++) fire("pointermove", from.x + (to.x - from.x) * i / 10, from.y + (to.y - from.y) * i / 10);
    fire("pointerup", to.x, to.y);
  }, { from, to });
}

// Starts near the top of the target, on its part that is on screen and clear of the 32 px edges, as a
// finger can only touch what is shown. Since the motion refinement, a swipe made right after another
// finds its target still sliding in, so boundingBox() is the painted, translated box: in the candidate 1
// Chromium input logs (Week and year-boundary cases), the box centre was off screen, the touch landed on
// <html> outside the results and the browser cancelled it. Touching the target's visible part keeps
// the same target, distance and direction; a target with no visible part fails here instead.
async function startOf(target) {
  const box = await target.boundingBox(), width = target.page().viewportSize().width;
  const left = Math.max(box.x, 40), right = Math.min(box.x + box.width, width - 40);
  if (right - left < 20) throw new Error(`swipe target is not on screen: ${JSON.stringify(box)}`);
  return { x: (left + right) / 2, y: box.y + Math.min(box.height / 2, 40) };
}
async function swipe(page, browserName, target, dx, dy = 0) {
  const from = await startOf(target), to = { x: from.x + dx, y: from.y + dy };
  if (browserName === "chromium") await cdpDrag(page, from, to); else await syntheticDrag(page, from, to);
}
// Two animation frames: any committed step has rendered by then.
const frames = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const results = page => page.locator("section.score-content");
const weekLabel = page => page.locator(".week-label");
const emptyTitle = page => page.locator('.empty-card [data-slot="empty-title"]');
const historyLength = page => page.evaluate(() => history.length);
// ESPN's wire `dates` for an inclusive app range: a single day, or start-to-(end + 1) because ESPN's
// range end is exclusive (lib/espn-data.ts scoreboardUrl). The Thursday–Monday range itself is unchanged.
function wireDates(start, end = start) {
  const compact = date => date.replaceAll("-", "");
  if (start === end) return compact(start);
  const after = new Date(`${end}T12:00:00Z`); after.setUTCDate(after.getUTCDate() + 1);
  return `${compact(start)}-${compact(after.toISOString().slice(0, 10))}`;
}
const requested = (harness, start, end) => harness.state.scoreRequests.some(search => new URLSearchParams(search).get("dates") === wireDates(start, end));

// Every game here belongs to the watchlist (ACC or ranked), so All lists it; unranked
// non-ACC games are correctly left out of All and would prove nothing about ranges.
function weekEvents() {
  return [
    ...standardEvents(),
    event("next-week-sat", { date: "2026-09-12T19:30:00Z", acc: true, state: "upcoming" }),
    event("prev-week-sat", { date: "2026-08-29T19:30:00Z", acc: true, state: "final", scores: [31, 10] }),
    event("two-weeks-sat", { date: "2026-09-19T19:30:00Z", rank: 9, state: "upcoming" }),
  ];
}

test("Day: one swipe moves one day each way, keeping Day, categories and Hide finals; an empty day stays Day", async ({ page, harness, browserName }, testInfo) => {
  inputKind(browserName);
  harness.state.events = weekEvents();
  await harness.open();
  await assertFixtureMediaIsMuted(page);
  const length = await historyLength(page);
  await category(page, "ACC").tap();
  await page.getByLabel("Hide finals").check();
  await expect(emptyTitle(page)).toHaveText("No ACC games on this day.");
  await screenshot(page, testInfo, "day-before-swipe-phone");

  await swipe(page, browserName, results(page), -140);
  await expect(dateInput(page)).toHaveValue("2026-09-06");
  await expect(page.locator("#game-sunday-acc")).toBeVisible();
  expect(requested(harness, "2026-09-06")).toBe(true);
  await expect(period(page, "Day")).toHaveAttribute("aria-pressed", "true");
  await expect(category(page, "ACC")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Hide finals")).toBeChecked();
  await screenshot(page, testInfo, "day-after-left-swipe-phone");

  await swipe(page, browserName, page.locator("#game-sunday-acc .game-summary"), 140);
  await expect(dateInput(page)).toHaveValue("2026-09-05");
  await swipe(page, browserName, results(page), 140);
  await expect(dateInput(page)).toHaveValue("2026-09-04");
  // A deliberate move to an empty day is not an automatic Week default (#171).
  await expect(emptyTitle(page)).toHaveText("No ACC games on this day.");
  await expect(period(page, "Day")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".game-screen")).toHaveCount(0);
  expect(await historyLength(page), "date steps add no history entries").toBe(length);
});

test("Week: one swipe moves one Thursday–Monday week with its own games; arrows, This week, reload and Back agree", async ({ page, harness, browserName }, testInfo) => {
  inputKind(browserName);
  harness.state.events = weekEvents();
  await harness.open({ path: "/?period=week" });
  await assertFixtureMediaIsMuted(page);
  const length = await historyLength(page);
  await expect(weekLabel(page)).toContainText("Sep 3 – Sep 7");
  await expect(page.getByRole("button", { name: "This week", exact: true })).toHaveClass(/is-today/);
  await screenshot(page, testInfo, "week-before-swipe-phone");

  await swipe(page, browserName, page.locator("article.game-card").first(), -140);
  await expect(weekLabel(page)).toContainText("Sep 10 – Sep 14");
  await expect(page.locator("#game-next-week-sat")).toBeVisible();
  await expect(page.locator("#game-ranked-live")).toHaveCount(0);
  expect(requested(harness, "2026-09-10", "2026-09-14"), "the chosen Thursday–Monday week was requested").toBe(true);
  expect(wireDates("2026-09-10", "2026-09-14")).toBe("20260910-20260915");
  await expect(page).toHaveURL(/[?&]weekDate=2026-09-10(&|$)/);
  await expect(page).toHaveURL(/[?&]period=week(&|$)/);
  await expect(page.getByRole("heading", { name: "Your watchlist in the week of Sep 10 – Sep 14." })).toBeAttached();
  await expect(page.getByRole("button", { name: "This week", exact: true })).not.toHaveClass(/is-today/);
  await screenshot(page, testInfo, "week-after-left-swipe-phone");
  await page.setViewportSize({ width: 320, height: 640 });
  await screenshot(page, testInfo, "week-after-swipe-narrow-320");
  await page.addStyleTag({ content: "html { font-size: 150% !important; }" });
  await screenshot(page, testInfo, "week-after-swipe-enlarged-text-150");
  await page.setViewportSize({ width: 1280, height: 900 });
  await screenshot(page, testInfo, "week-after-swipe-desktop");
  await page.reload();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await historyLength(page), "swipes replace the current entry").toBe(length);

  // Reload keeps the chosen week, and so do the game screen and Back, in and across documents.
  await expect(weekLabel(page)).toContainText("Sep 10 – Sep 14");
  await expect(period(page, "Week")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#game-next-week-sat .game-summary").tap();
  await expect(page.locator(".game-screen")).toBeVisible();
  await expect(page).toHaveURL(/event=next-week-sat.*weekDate=2026-09-10/);
  await expect(page.getByLabel("Back to scores, Week of Sep 10")).toBeVisible();
  await page.goBack();
  await expect(weekLabel(page)).toContainText("Sep 10 – Sep 14");
  await expect(page.locator("#game-next-week-sat")).toBeVisible();
  await page.locator("#game-next-week-sat .game-summary").tap();
  await expect(page.locator(".game-screen")).toBeVisible();
  await page.reload();
  await expect(page.locator(".game-screen")).toBeVisible();
  await page.goBack();
  await expect(weekLabel(page)).toContainText("Sep 10 – Sep 14");

  await swipe(page, browserName, page.locator("#game-next-week-sat .game-summary"), 140);
  await expect(weekLabel(page)).toContainText("Sep 3 – Sep 7");
  await swipe(page, browserName, page.locator("article.game-card").first(), 140);
  await expect(weekLabel(page)).toContainText("Aug 27 – Aug 31");
  await expect(page.locator("#game-prev-week-sat")).toBeVisible();
  // The accessible alternatives do the same.
  await page.getByRole("button", { name: "Next week" }).tap();
  await expect(weekLabel(page)).toContainText("Sep 3 – Sep 7");
  await page.getByRole("button", { name: "Next week" }).tap();
  await expect(weekLabel(page)).toContainText("Sep 10 – Sep 14");
  await page.getByRole("button", { name: "Previous week" }).tap();
  await expect(weekLabel(page)).toContainText("Sep 3 – Sep 7");
  await expect(page).toHaveURL(/weekDate=2026-09-03/);
  await page.getByRole("button", { name: "This week", exact: true }).tap();
  await expect(weekLabel(page)).toContainText("Sep 3 – Sep 7");
  await expect(page.getByRole("button", { name: "This week", exact: true })).toHaveClass(/is-today/);
  await expect(page).not.toHaveURL(/weekDate=/);
  // Day was never moved by Week.
  await period(page, "Day").tap();
  await expect(dateInput(page)).toHaveValue("2026-09-05");
});

test("Day and Week keep independent selections", async ({ page, harness, browserName }) => {
  inputKind(browserName);
  harness.state.events = weekEvents();
  await harness.open();
  await assertFixtureMediaIsMuted(page);
  await swipe(page, browserName, page.locator("article.game-card").first(), -140);
  await expect(dateInput(page)).toHaveValue("2026-09-06");
  await expectSwipeTouchEnded(page, browserName);
  await period(page, "Week").tap();
  await expect(weekLabel(page)).toContainText("Sep 3 – Sep 7");
  await swipe(page, browserName, page.locator("article.game-card").first(), -140);
  await expect(weekLabel(page)).toContainText("Sep 10 – Sep 14");
  await period(page, "Day").tap();
  await expect(dateInput(page)).toHaveValue("2026-09-06");
  await page.getByRole("button", { name: "Today", exact: true }).tap();
  await expect(dateInput(page)).toHaveValue("2026-09-05");
  await period(page, "Week").tap();
  await expect(weekLabel(page)).toContainText("Sep 10 – Sep 14");
});

test("after a Week swipe, choosing Day and reloading keeps Day, and Week returns to the same remembered week", async ({ page, harness, browserName }) => {
  inputKind(browserName);
  harness.state.events = weekEvents();
  await harness.open();
  await assertFixtureMediaIsMuted(page);
  const length = await historyLength(page);
  await period(page, "Week").tap();
  await swipe(page, browserName, page.locator("article.game-card").first(), -140);
  await expect(weekLabel(page)).toContainText("Sep 10 – Sep 14");
  await expect(page).toHaveURL(/period=week/);
  await period(page, "Day").tap();
  await expect(period(page, "Day")).toHaveAttribute("aria-pressed", "true");
  await expect(page).not.toHaveURL(/period=/);
  await expect(page).toHaveURL(/[?&]weekDate=2026-09-10(&|$)/);
  await page.reload();
  await expect(period(page, "Day")).toHaveAttribute("aria-pressed", "true");
  await expect(dateInput(page)).toHaveValue("2026-09-05");
  await expect(page.locator("#game-ranked-live")).toBeVisible();
  // Back to a game and back again keeps Day too: the saved snapshot agrees with the URL.
  await page.locator("#game-ranked-live .game-summary").tap();
  await expect(page.locator(".game-screen")).toBeVisible();
  await page.reload();
  await page.goBack();
  await expect(period(page, "Day")).toHaveAttribute("aria-pressed", "true");
  await period(page, "Week").tap();
  await expect(weekLabel(page)).toContainText("Sep 10 – Sep 14");
  await expect(page.locator("#game-next-week-sat")).toBeVisible();
  await expect(page).toHaveURL(/period=week/);
  await page.reload();
  await expect(weekLabel(page)).toContainText("Sep 10 – Sep 14");
  expect(await historyLength(page), "only the game screen added an entry").toBe(length + 1);
});

test("month and year boundaries, including empty days and weeks, keep labels and games consistent", async ({ page, harness, browserName }) => {
  inputKind(browserName);
  harness.state.events = [
    // Watchlist games (ACC or ranked), so All lists them. Dec 31, 7:30 p.m. Eastern is Jan 1 in UTC.
    event("dec31-night", { date: "2027-01-01T00:30:00Z", acc: true, state: "upcoming" }),
    event("jan2", { date: "2027-01-02T20:00:00Z", rank: 4, state: "upcoming" }),
    event("dec26", { date: "2026-12-26T20:00:00Z", acc: true, state: "final", scores: [24, 17] }),
  ];
  // Wednesday, December 30, noon Eastern; an explicit Day link.
  await harness.open({ now: "2026-12-30T17:00:00Z", path: "/?period=day" });
  await assertFixtureMediaIsMuted(page);
  await expect(dateInput(page)).toHaveValue("2026-12-30");
  await swipe(page, browserName, results(page), -140);
  await expect(dateInput(page)).toHaveValue("2026-12-31");
  await expect(page.locator("#game-dec31-night")).toBeVisible();
  await swipe(page, browserName, results(page), -140);
  await expect(dateInput(page)).toHaveValue("2027-01-01");
  await expect(emptyTitle(page)).toHaveText("A quiet scoreboard.");
  await expect(period(page, "Day")).toHaveAttribute("aria-pressed", "true");
  await swipe(page, browserName, results(page), -140);
  await expect(dateInput(page)).toHaveValue("2027-01-02");
  await expect(page.locator("#game-jan2")).toBeVisible();

  await period(page, "Week").tap();
  await expect(weekLabel(page)).toContainText("Dec 31 – Jan 4");
  await expect(page.locator("#game-dec31-night")).toBeVisible(); await expect(page.locator("#game-jan2")).toBeVisible();
  await swipe(page, browserName, page.locator("article.game-card").first(), 140);
  await expect(weekLabel(page)).toContainText("Dec 24 – Dec 28");
  await expect(page.locator("#game-dec26")).toBeVisible(); await expect(page.locator("#game-jan2")).toHaveCount(0);
  await swipe(page, browserName, page.locator("#game-dec26 .game-summary"), -140);
  await expect(weekLabel(page)).toContainText("Dec 31 – Jan 4");
  await expect(page.locator("#game-dec31-night")).toBeVisible();
  await swipe(page, browserName, page.locator("#game-dec31-night .game-summary"), -140);
  await expect(weekLabel(page)).toContainText("Jan 7 – Jan 11");
  await expect(emptyTitle(page)).toHaveText("A quiet football week, Jan 7 – Jan 11.");
  expect(requested(harness, "2027-01-07", "2027-01-11")).toBe(true);
  await period(page, "Day").tap();
  await expect(dateInput(page)).toHaveValue("2027-01-02");
});

test("game cards: a tap opens the game, a swipe starting on a card does not, and an immediate tap and keyboard Enter do", async ({ page, harness, browserName }) => {
  inputKind(browserName);
  harness.state.events = weekEvents();
  await harness.open();
  await assertFixtureMediaIsMuted(page);
  await page.locator("#game-ranked-live .game-summary").tap();
  await expect(page.locator(".game-screen")).toBeVisible();
  await page.goBack();
  await expect(page.locator(".game-screen")).toHaveCount(0);

  await swipe(page, browserName, page.locator("#game-ranked-live .game-summary"), -140);
  await expect(dateInput(page)).toHaveValue("2026-09-06");
  await expectSwipeTouchEnded(page, browserName);
  await frames(page);
  await expect(page.locator(".game-screen")).toHaveCount(0);
  await expect(page).not.toHaveURL(/event=/);
  await page.locator("#game-sunday-acc .game-summary").tap();
  await expect(page.locator(".game-screen")).toBeVisible();
  await expect(page).toHaveURL(/event=sunday-acc/);
  await page.goBack();
  await expect(page.locator("#game-sunday-acc")).toBeVisible();

  await swipe(page, browserName, page.locator("#game-sunday-acc .game-summary"), 140);
  await expect(dateInput(page)).toHaveValue("2026-09-05");
  await page.locator("#game-ranked-live .game-summary").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".game-screen")).toBeVisible();
  await expect(page).toHaveURL(/event=ranked-live/);
});

test("Chromium touches: vertical scrolling, diagonal drags, edge starts, two fingers, controls and an open panel never change the date", async ({ page, harness, browserName }) => {
  test.skip(browserName !== "chromium", "Needs real input-pipeline touches (CDP), which only Chromium provides here.");
  inputKind(browserName);
  harness.state.events = [...weekEvents(), ...Array.from({ length: 24 }, (_, i) => event(`many-${i}`, { scores: [i, 40] }))];
  await harness.open();
  await assertFixtureMediaIsMuted(page);
  const unchanged = async label => {
    await frames(page);
    await expect(dateInput(page), label).toHaveValue("2026-09-05");
    await expect(page.locator(".game-screen"), label).toHaveCount(0);
  };
  const card = await startOf(page.locator("article.game-card").nth(2));

  await cdpDrag(page, { x: card.x, y: 600 }, { x: card.x, y: 200 });
  await expect.poll(() => page.evaluate(() => scrollY), { message: "the browser scrolled" }).toBeGreaterThan(0);
  await unchanged("vertical scroll");
  await page.evaluate(() => scrollTo(0, 0));
  await cdpDrag(page, card, { x: card.x + 90, y: card.y - 80 });
  await unchanged("diagonal");
  await cdpDrag(page, { x: card.x, y: card.y }, { x: card.x - 20, y: card.y + 120 });
  await unchanged("mostly vertical");
  await page.evaluate(() => scrollTo(0, 0));
  await cdpDrag(page, { x: 10, y: card.y }, { x: 250, y: card.y });
  await unchanged("left-edge start");
  await cdpDrag(page, { x: 384, y: card.y }, { x: 120, y: card.y });
  await unchanged("right-edge start");
  await cdpDrag(page, { x: 150, y: card.y }, { x: 30, y: card.y }, { fingers: 2 });
  await unchanged("two fingers");
  await cdpDrag(page, await startOf(page.locator(".filter-tabs")), { x: 40, y: (await startOf(page.locator(".filter-tabs"))).y });
  await unchanged("category controls");
  await cdpDrag(page, await startOf(page.locator(".date-bar")), { x: 40, y: (await startOf(page.locator(".date-bar"))).y });
  await unchanged("date controls");
  await page.getByRole("button", { name: "How this scoreboard works" }).tap();
  const panel = page.getByRole("dialog");
  await expect(panel).toBeVisible();
  const inside = await startOf(panel.locator(".app-panel-body"));
  await cdpDrag(page, inside, { x: inside.x - 150, y: inside.y });
  await cdpDrag(page, inside, { x: inside.x + 150, y: inside.y });
  await expect(panel).toBeVisible();
  await page.getByRole("button", { name: "Close" }).tap();
  await expect(panel).toHaveCount(0);
  await unchanged("open panel");
  // The recognizer was live throughout.
  await page.evaluate(() => scrollTo(0, 0));
  const again = await startOf(page.locator("article.game-card").nth(2));
  await cdpDrag(page, again, { x: again.x - 140, y: again.y });
  await expect(dateInput(page)).toHaveValue("2026-09-06");
});

test("rapid swipes supersede a held week: only the final range's games and no stale error appear", async ({ page, harness, browserName }) => {
  inputKind(browserName);
  const all = weekEvents(), gates = [];
  harness.state.events = async url => {
    if (url.searchParams.get("dates") === wireDates("2026-09-10", "2026-09-14")) await new Promise(resolve => gates.push(resolve));
    return all;
  };
  await harness.open({ path: "/?period=week" });
  await assertFixtureMediaIsMuted(page);
  await swipe(page, browserName, page.locator("article.game-card").first(), -140);
  await expect(weekLabel(page)).toContainText("Sep 10 – Sep 14");
  await expect.poll(() => gates.length).toBeGreaterThan(0);
  await expect(page.getByRole("status", { name: "Loading scores" })).toBeVisible();
  await swipe(page, browserName, results(page), -140);
  await expect(weekLabel(page)).toContainText("Sep 17 – Sep 21");
  await expect(page.locator("#game-two-weeks-sat")).toBeVisible();
  gates.splice(0).forEach(release => release());
  await frames(page);
  await expect(page.locator("#game-two-weeks-sat")).toBeVisible();
  await expect(page.locator("#game-next-week-sat")).toHaveCount(0);
  await expect(weekLabel(page)).toContainText("Sep 17 – Sep 21");
  await expect(page.locator(".feed-banner")).toHaveCount(0);
});

test("simulated zoom above 1.01 returns the results to default panning and turns swipes off until normal scale", async ({ page, harness, browserName }) => {
  inputKind(browserName);
  test.info().annotations.push({ type: "zoom", description: "visualViewport.scale is overridden in the page; no real pinch zoom occurs" });
  harness.state.events = weekEvents();
  await harness.open();
  await assertFixtureMediaIsMuted(page);
  expect(await results(page).evaluate(node => getComputedStyle(node).touchAction)).toMatch(/pan-y/);
  await page.evaluate(() => { Object.defineProperty(visualViewport, "scale", { configurable: true, get: () => 2 }); visualViewport.dispatchEvent(new Event("resize")); });
  await expect(results(page)).toHaveAttribute("data-zoomed", "");
  expect(await results(page).evaluate(node => getComputedStyle(node).touchAction)).toBe("auto");
  await swipe(page, browserName, page.locator("article.game-card").first(), -140);
  await frames(page);
  await expect(dateInput(page)).toHaveValue("2026-09-05");
  await page.evaluate(() => { delete visualViewport.scale; visualViewport.dispatchEvent(new Event("resize")); });
  await expect(results(page)).not.toHaveAttribute("data-zoomed");
  expect(await results(page).evaluate(node => getComputedStyle(node).touchAction)).toMatch(/pan-y/);
  await swipe(page, browserName, page.locator("article.game-card").first(), -140);
  await expect(dateInput(page)).toHaveValue("2026-09-06");
});

test("the Guide carries the chosen week unread and Scores returns in Day with it remembered", async ({ page, harness }) => {
  harness.state.events = weekEvents();
  await harness.open({ path: "/?period=week" });
  await assertFixtureMediaIsMuted(page);
  await page.getByRole("button", { name: "Next week" }).tap();
  await expect(weekLabel(page)).toContainText("Sep 10 – Sep 14");
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await nav.getByRole("link", { name: "Guide" }).tap();
  await expect(page).toHaveURL(/\/guide\?weekDate=2026-09-10$/);
  await expect(page.getByRole("heading", { name: "Guide", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Next day" }).tap();
  await expect(page).toHaveURL(/\/guide\?.*weekDate=2026-09-10/);
  await expect(page).toHaveURL(/date=2026-09-06/);
  await nav.getByRole("link", { name: "Scores" }).tap();
  await expect(page).toHaveURL(/\/\?date=2026-09-06&weekDate=2026-09-10$/);
  await expect(period(page, "Day")).toHaveAttribute("aria-pressed", "true");
  await expect(dateInput(page)).toHaveValue("2026-09-06");
  await period(page, "Week").tap();
  await expect(weekLabel(page)).toContainText("Sep 10 – Sep 14");
  await expect(page.locator("#game-next-week-sat")).toBeVisible();
});

test("a weekDate link on an empty Today keeps Day (no #171 default) and Week shows its week", async ({ page, harness }) => {
  harness.state.events = [];
  await harness.open({ path: "/?weekDate=2026-09-16" });
  await assertFixtureMediaIsMuted(page);
  await expect(period(page, "Day")).toHaveAttribute("aria-pressed", "true");
  await expect(emptyTitle(page)).toHaveText("A quiet scoreboard.");
  await period(page, "Week").tap();
  await expect(weekLabel(page)).toContainText("Sep 17 – Sep 21");
  await expect(emptyTitle(page)).toHaveText("A quiet football week, Sep 17 – Sep 21.");
});

test("an app-update restoration link keeps its chosen week", async ({ page, harness }) => {
  harness.state.events = weekEvents();
  await harness.open({ path: "/?period=week&weekDate=2026-09-10&_ss_update=0123456789abcdef0123456789abcdef01234567&_ss_hide_finals=0&_ss_open=0" });
  await assertFixtureMediaIsMuted(page);
  await expect(weekLabel(page)).toContainText("Sep 10 – Sep 14");
  await expect(page.locator("#game-next-week-sat")).toBeVisible();
  await expect(page).not.toHaveURL(/_ss_/);
  await expect(page).toHaveURL(/weekDate=2026-09-10/);
});
