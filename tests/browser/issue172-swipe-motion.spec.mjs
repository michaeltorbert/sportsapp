import { test, expect, event, standardEvents, dateInput, category } from "./fixtures.mjs";

// Issue 172 held-drag motion evidence: the results follow a finger that is still down, the neighboring
// range is visible beside them with its own date and games, and a release commits once (settling in) or
// slides back. Chromium gestures are real input-pipeline touches (CDP Input.dispatchTouchEvent) held
// between commands, so screenshots and geometry are taken before release. WebKit gestures are synthetic
// PointerEvents dispatched in the page: they exercise the app's tracking logic, not native touch,
// scrolling or compatibility clicks. Neither is an iPhone; native smoothness, Safari edge navigation
// and Home Screen behavior remain unverified.

test.use({ video: "on" });

async function screenshot(page, testInfo, name) {
  const path = testInfo.outputPath(`${name}.png`);
  // Viewport only, with animations as they are: these are the pixels on screen at that moment.
  await page.screenshot({ path });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

// Spec-local copy of the #171 check: the fixture's media mute is active before any interaction.
async function assertFixtureMediaIsMuted(page) {
  const muted = await page.evaluate(() => {
    const media = document.createElement("video");
    media.muted = false;
    document.body.append(media);
    media.dispatchEvent(new Event("play", { bubbles: true }));
    const result = media.muted;
    media.remove();
    return result;
  });
  expect(muted, "the browser fixture mutes media before interaction").toBe(true);
}

function inputKind(browserName) {
  const description = browserName === "chromium" ? "Chromium CDP Input.dispatchTouchEvent touches held between commands (browser input pipeline)" : "WebKit synthetic PointerEvents dispatched in the page (logic only: not native touch; no browser scrolling or compatibility clicks)";
  test.info().annotations.push({ type: "gesture input", description });
}

// Chromium only: which pointer and click events reached the page, and where the results were painted at
// each pointerdown. Passive recording that never changes an event.
test.beforeEach(async ({ page, browserName }) => {
  if (browserName !== "chromium") return;
  await page.addInitScript(() => {
    const log = [];
    Object.defineProperty(window, "__issue172Motion", { value: log });
    const offset = () => { const track = document.querySelector("section.score-content > .pager-track"); return track ? new DOMMatrixReadOnly(getComputedStyle(track).transform).m41 : null; };
    const describe = target => target instanceof Element ? `${target.tagName.toLowerCase()}${target.closest("article.game-card") ? ` in ${target.closest("article.game-card").id}` : ""}` : String(target);
    for (const type of ["pointerdown", "pointerup", "pointercancel", "touchend", "click"]) addEventListener(type, event => log.push({ phase: "capture", type, t: Math.round(performance.now()), offset: offset(), target: describe(event.target), prevented: event.defaultPrevented }), { capture: true, passive: true });
    addEventListener("click", event => log.push({ phase: "bubble", type: "click", target: describe(event.target), prevented: event.defaultPrevented }), { passive: true });
  });
});
test.afterEach(async ({ page, browserName }, testInfo) => {
  if (browserName !== "chromium" || page.isClosed()) return;
  let log;
  try { log = await page.evaluate(() => window.__issue172Motion ?? null); } catch (error) { log = { unavailable: error.message }; }
  await testInfo.attach("issue172-motion-input-log", { contentType: "application/json", body: JSON.stringify(log, null, 1) });
});

const frames = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const region = page => page.locator("section.score-content");
const live = page => page.locator("section.score-content > .pager-track > .pager-pane:not([data-side])");
const pane = (page, side) => page.locator(`section.score-content .pager-pane[data-side="${side}"]`);
const caption = (page, side) => pane(page, side).locator(".pager-caption");
const weekLabel = page => page.locator(".week-label");
const historyLength = page => page.evaluate(() => history.length);
// The results track's painted horizontal translation.
const offset = page => page.evaluate(() => new DOMMatrixReadOnly(getComputedStyle(document.querySelector("section.score-content > .pager-track")).transform).m41);
const requests = (harness, dates) => harness.state.scoreRequests.filter(search => new URLSearchParams(search).get("dates") === dates).length;

async function startOf(target) {
  const box = await target.boundingBox();
  return { x: box.x + box.width / 2, y: box.y + Math.min(box.height / 2, 40) };
}

// A touch that stays down between commands: `to(dx)` moves it (8 px per move) to dx from its start and
// waits for paint; `end()` releases it.
async function holdTouch(page, browserName, from) {
  let x = from.x;
  if (browserName === "chromium") {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from.x, y: from.y, id: 0 }] });
    return {
      async to(dx) {
        const target = from.x + dx, steps = Math.max(1, Math.ceil(Math.abs(target - x) / 8));
        for (let i = 1; i <= steps; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + (target - x) * i / steps, y: from.y, id: 0 }] });
        x = target; await frames(page);
      },
      async end() { try { await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); } finally { await cdp.detach(); } },
    };
  }
  await page.evaluate(from => {
    const target = document.elementFromPoint(from.x, from.y);
    window.__held = { target, y: from.y };
    target.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 43, pointerType: "touch", isPrimary: true, button: 0, buttons: 1, clientX: from.x, clientY: from.y, bubbles: true, cancelable: true, composed: true }));
  }, from);
  const fire = (type, points) => page.evaluate(({ type, points }) => {
    for (const clientX of points) window.__held.target.dispatchEvent(new PointerEvent(type, { pointerId: 43, pointerType: "touch", isPrimary: true, button: type === "pointermove" ? -1 : 0, buttons: type === "pointerup" ? 0 : 1, clientX, clientY: window.__held.y, bubbles: true, cancelable: true, composed: true }));
  }, { type, points });
  return {
    async to(dx) {
      const target = from.x + dx, steps = Math.max(1, Math.ceil(Math.abs(target - x) / 8));
      await fire("pointermove", Array.from({ length: steps }, (_, i) => x + (target - x) * (i + 1) / steps));
      x = target; await frames(page);
    },
    async end() { await fire("pointerup", [x]); },
  };
}

// Records the painted offset on every frame from now until `count` frames have passed.
const sampleFrames = (page, count) => page.evaluate(count => {
  const track = document.querySelector("section.score-content > .pager-track"), samples = [];
  window.__samples = samples;
  const loop = () => { samples.push(new DOMMatrixReadOnly(getComputedStyle(track).transform).m41); if (samples.length < count) requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
}, count);
const samples = async (page, count) => { await expect.poll(() => page.evaluate(() => window.__samples.length)).toBeGreaterThanOrEqual(count); return page.evaluate(() => window.__samples); };

// Holds a drag through `offsets` (each checked against the painted results and screenshotted) and checks
// the neighbor on `side` is labeled `label` with its own `games` text.
async function holdThrough(page, testInfo, held, offsets, { side, label, has, hasNot = [], name }) {
  const base = await live(page).boundingBox(), seen = [];
  for (const dx of offsets) {
    await held.to(dx);
    const painted = await offset(page); seen.push(painted);
    expect(Math.abs(painted - dx), `the results are painted ${dx}px from rest while held`).toBeLessThanOrEqual(1);
    expect(Math.abs((await live(page).boundingBox()).x - (base.x + dx))).toBeLessThanOrEqual(1);
    await expect(caption(page, side)).toContainText(label);
    for (const text of has) await expect(pane(page, side)).toContainText(text);
    for (const text of hasNot) await expect(pane(page, side)).not.toContainText(text);
    // The neighbor sits one results width plus the 40 px gap beside the results.
    const beside = await pane(page, side).boundingBox(), now = await live(page).boundingBox();
    expect(Math.abs(beside.x - (now.x + side * (now.width + 40)))).toBeLessThanOrEqual(1);
    expect(Math.abs(beside.y - now.y), "the neighbor shares the results' natural top").toBeLessThanOrEqual(1);
    await screenshot(page, testInfo, `${name}-held-${dx}`);
  }
  return seen;
}

function events() {
  return [
    ...standardEvents(),
    event("next-week-sat", { date: "2026-09-12T19:30:00Z", acc: true, state: "upcoming" }),
    event("prev-week-sat", { date: "2026-08-29T19:30:00Z", acc: true, state: "final", scores: [31, 10] }),
  ];
}

test("Day: held results follow the finger with the next day's own games beside them; release commits once and settles in", async ({ page, harness, browserName }, testInfo) => {
  inputKind(browserName);
  harness.state.events = events();
  await harness.open();
  await assertFixtureMediaIsMuted(page);
  const length = await historyLength(page), url = page.url();
  const held = await holdTouch(page, browserName, await startOf(page.locator("#game-ranked-live .game-summary")));
  const seen = await holdThrough(page, testInfo, held, [-30, -90, -160], { side: 1, label: "Sun, Sep 6", has: ["1 game", "sunday-acc away"], hasNot: ["ranked-live"], name: "day-forward" });
  expect(seen[0] > seen[1] && seen[1] > seen[2], `monotonic tracking ${seen}`).toBe(true);
  // Nothing has changed yet: date, address, history; the neighbor repeats no live ID.
  await expect(dateInput(page)).toHaveValue("2026-09-05");
  expect(page.url()).toBe(url);
  await expect(page.locator("#game-sunday-acc")).toHaveCount(0);
  expect(requests(harness, "20260906"), "one request for the revealed day").toBe(1);
  await sampleFrames(page, 45);
  await held.end();
  await expect(dateInput(page)).toHaveValue("2026-09-06");
  await expect(page.locator("#game-sunday-acc")).toBeVisible();
  const settle = await samples(page, 45), peak = settle.indexOf(Math.max(...settle));
  test.info().annotations.push({ type: "settle offsets", description: settle.map(Math.round).join(" ") });
  expect(settle[peak], "the new day's results start on the right, where the neighbor was").toBeGreaterThan(100);
  for (let i = peak + 1; i < settle.length; i++) expect(settle[i], `settling never reverses (frame ${i})`).toBeLessThanOrEqual(settle[i - 1] + 0.5);
  expect(Math.abs(settle.at(-1))).toBe(0);
  await expect(region(page)).not.toHaveAttribute("data-pager");
  await expect(page.locator(".pager-pane[data-side]")).toHaveCount(0);
  await screenshot(page, testInfo, "day-forward-settled");
  expect(await historyLength(page)).toBe(length);
  expect(requests(harness, "20260906"), "the commit reused the drag's request").toBe(1);
  await expect(page.locator(".game-screen")).toHaveCount(0);
});

// Visual matrix for independent pixel review: held offsets, a slide back and a settled commit at each size.
for (const view of [
  { name: "narrow-320", width: 320, height: 640 },
  { name: "phone-390", width: 390, height: 844 },
  { name: "desktop-1280", width: 1280, height: 900 },
  { name: "enlarged-text-320", width: 320, height: 640, css: "html { font-size: 150% !important; }" },
]) {
  test(`visual matrix ${view.name}: held offsets, slide back and settled commit`, async ({ page, harness, browserName }, testInfo) => {
    inputKind(browserName);
    harness.state.events = events();
    await page.setViewportSize({ width: view.width, height: view.height });
    await harness.open();
    if (view.css) await page.addStyleTag({ content: view.css });
    await assertFixtureMediaIsMuted(page);
    const width = (await live(page).boundingBox()).width;
    const card = () => page.locator("#game-ranked-live .game-summary");
    let held = await holdTouch(page, browserName, await startOf(card()));
    await holdThrough(page, testInfo, held, [-40, -Math.round(width * 0.45)], { side: 1, label: "Sun, Sep 6", has: ["1 game", "sunday-acc away"], name: `${view.name}-forward` });
    await held.to(-30);
    await held.end();
    await expect(region(page)).not.toHaveAttribute("data-pager");
    await expect(dateInput(page)).toHaveValue("2026-09-05");
    await screenshot(page, testInfo, `${view.name}-slid-back`);
    held = await holdTouch(page, browserName, await startOf(card()));
    await holdThrough(page, testInfo, held, [Math.round(width * 0.3)], { side: -1, label: "Fri, Sep 4", has: ["friday-ranked away"], name: `${view.name}-back` });
    await held.to(-Math.round(width * 0.35));
    await held.end();
    await expect(dateInput(page)).toHaveValue("2026-09-06");
    await expect(region(page)).not.toHaveAttribute("data-pager");
    await expect(page.locator("#game-sunday-acc")).toBeVisible();
    await screenshot(page, testInfo, `${view.name}-settled-next-day`);
  });
}

test("Week: a reversed drag shows each side's own week, and a short release slides back with no change", async ({ page, harness, browserName }, testInfo) => {
  inputKind(browserName);
  harness.state.events = events();
  await harness.open({ path: "/?period=week" });
  await assertFixtureMediaIsMuted(page);
  const length = await historyLength(page), url = page.url();
  await expect(weekLabel(page)).toContainText("Sep 3 – Sep 7");
  const held = await holdTouch(page, browserName, await startOf(page.locator("article.game-card").first()));
  await holdThrough(page, testInfo, held, [-80], { side: 1, label: "Sep 10 – Sep 14", has: ["next-week-sat away"], hasNot: ["ranked-live"], name: "week-forward" });
  await holdThrough(page, testInfo, held, [40, 25], { side: -1, label: "Aug 27 – Aug 31", has: ["prev-week-sat away"], hasNot: ["ranked-live", "next-week-sat"], name: "week-reversed" });
  await expect(pane(page, 1)).toHaveCount(0);
  await sampleFrames(page, 30);
  await held.end();
  const back = await samples(page, 30);
  test.info().annotations.push({ type: "slide-back offsets", description: back.map(Math.round).join(" ") });
  for (let i = 1; i < back.length; i++) expect(back[i], `sliding back never overshoots (frame ${i})`).toBeLessThanOrEqual(back[i - 1] + 0.5);
  expect(Math.abs(back.at(-1))).toBe(0);
  await expect(region(page)).not.toHaveAttribute("data-pager");
  await expect(weekLabel(page)).toContainText("Sep 3 – Sep 7");
  expect(page.url(), "no address change").toBe(url);
  expect(await historyLength(page)).toBe(length);
  for (const dates of ["20260910-20260915", "20260827-20260901"]) expect(requests(harness, dates), dates).toBeLessThanOrEqual(1);
  await screenshot(page, testInfo, "week-slid-back");
});

test("both periods commit in both directions from held drags, each to its exact next or previous range", async ({ page, harness, browserName }, testInfo) => {
  inputKind(browserName);
  harness.state.events = events();
  await harness.open();
  await assertFixtureMediaIsMuted(page);
  const commit = async (dx, side, label, has, name) => {
    const held = await holdTouch(page, browserName, await startOf(page.locator("article.game-card").first()));
    await holdThrough(page, testInfo, held, [dx / 2, dx], { side, label, has, name });
    await held.end();
    await expect(region(page)).not.toHaveAttribute("data-pager");
  };
  await commit(-120, 1, "Sun, Sep 6", ["sunday-acc away"], "day-next");
  await expect(dateInput(page)).toHaveValue("2026-09-06");
  await commit(120, -1, "Sat, Sep 5", ["ranked-live away"], "day-back");
  await expect(dateInput(page)).toHaveValue("2026-09-05");
  await commit(120, -1, "Fri, Sep 4", ["friday-ranked away"], "day-back-again");
  await expect(dateInput(page)).toHaveValue("2026-09-04");
  await expect(page.locator("#game-friday-ranked")).toBeVisible();
  await page.getByRole("group", { name: "Scoreboard period" }).getByRole("button", { name: "Week", exact: true }).tap();
  await expect(weekLabel(page)).toContainText("Sep 3 – Sep 7");
  await commit(-120, 1, "Sep 10 – Sep 14", ["next-week-sat away"], "week-next");
  await expect(weekLabel(page)).toContainText("Sep 10 – Sep 14");
  await expect(page).toHaveURL(/weekDate=2026-09-10/);
  await commit(120, -1, "Sep 3 – Sep 7", ["ranked-live away"], "week-back");
  await commit(120, -1, "Aug 27 – Aug 31", ["prev-week-sat away"], "week-back-again");
  await expect(weekLabel(page)).toContainText("Aug 27 – Aug 31");
  await expect(page.locator("#game-prev-week-sat")).toBeVisible();
});

for (const throttle of [1, 4]) {
  test(`Chromium touches${throttle > 1 ? `, CPU ${throttle}× slower` : ""}: a tap while the new day settles opens the game painted under it`, async ({ page, harness, browserName }, testInfo) => {
    test.skip(browserName !== "chromium", "Needs real input-pipeline touches (CDP), which only Chromium provides here.");
    inputKind(browserName);
    harness.state.events = events();
    await harness.open();
    await assertFixtureMediaIsMuted(page);
    if (throttle > 1) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
      test.info().annotations.push({ type: "diagnostic", description: `CPU throttled ${throttle}×` });
    }
    const held = await holdTouch(page, browserName, await startOf(page.locator("#game-ranked-live .game-summary")));
    await held.to(-140);
    await expect(caption(page, 1)).toContainText("1 game");
    await held.end();
    // Find the incoming card while it is still moving, and touch it where it is painted.
    const point = await page.evaluate(() => new Promise(resolve => {
      const track = document.querySelector("section.score-content > .pager-track");
      const check = () => {
        const x = new DOMMatrixReadOnly(getComputedStyle(track).transform).m41, card = document.querySelector("#game-sunday-acc .game-summary");
        if (card && x > 30 && x < 220) { const box = card.getBoundingClientRect(); resolve({ x: box.left + 40, y: box.top + box.height / 2, offset: x }); }
        else requestAnimationFrame(check);
      };
      check();
    }));
    test.info().annotations.push({ type: "tap point", description: JSON.stringify(point) });
    // An ordinary tap: no wait between its touchStart and touchEnd.
    const cdp = await page.context().newCDPSession(page);
    try {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: point.x, y: point.y, id: 1 }] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    } finally { await cdp.detach(); }
    await expect(page.locator(".game-screen")).toBeVisible();
    await screenshot(page, testInfo, `tap-during-settle-opened-x${throttle}`);
    await expect(page).toHaveURL(/event=sunday-acc/);
    const log = await page.evaluate(() => window.__issue172Motion);
    const down = log.findLast(entry => entry.type === "pointerdown");
    expect(down.offset, "the tap's pointerdown came while the results were still moving").toBeGreaterThan(0);
    expect(down.target).toContain("game-sunday-acc");
    expect(log.some(entry => entry.phase === "bubble" && entry.type === "click" && entry.target.includes("game-sunday-acc")), "its click reached the game").toBe(true);
    await page.goBack();
    await expect(dateInput(page)).toHaveValue("2026-09-06");
    await expect(page.locator("#game-sunday-acc")).toBeVisible();
  });
}

test("Chromium touches: a contact stops the settle where it is painted; scrolling instead resumes it without opening anything", async ({ page, harness, browserName }, testInfo) => {
  test.skip(browserName !== "chromium", "Needs real input-pipeline touches (CDP), which only Chromium provides here.");
  inputKind(browserName);
  harness.state.events = [...events(), ...Array.from({ length: 12 }, (_, i) => event(`many-${i}`, { scores: [i, 40], rank: 1 + i }))];
  await harness.open();
  await assertFixtureMediaIsMuted(page);
  const held = await holdTouch(page, browserName, await startOf(page.locator("#game-ranked-live .game-summary")));
  await held.to(-140);
  await expect(caption(page, 1)).toContainText("1 game");
  await held.end();
  const point = await page.evaluate(() => new Promise(resolve => {
    const track = document.querySelector("section.score-content > .pager-track");
    const check = () => {
      const x = new DOMMatrixReadOnly(getComputedStyle(track).transform).m41, card = document.querySelector("#game-sunday-acc .game-summary");
      if (card && x > 60 && x < 200) { const box = card.getBoundingClientRect(); resolve({ x: box.left + 40, y: box.top + box.height / 2 }); } else requestAnimationFrame(check);
    };
    check();
  }));
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: point.x, y: point.y, id: 2 }] });
    const stopped = await offset(page);
    await frames(page);
    expect(await offset(page), "stopped where it was painted").toBe(stopped);
    expect(stopped).toBeGreaterThan(0);
    await expect(pane(page, -1), "the day being left is still beside it").toHaveCount(1);
    await screenshot(page, testInfo, "settle-stopped-by-contact");
    for (let i = 1; i <= 8; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: point.x, y: point.y - 8 * i, id: 2 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } finally { await cdp.detach(); }
  await expect(region(page)).not.toHaveAttribute("data-pager");
  expect(Math.abs(await offset(page))).toBe(0);
  await expect(page.locator(".game-screen")).toHaveCount(0);
  await expect(dateInput(page)).toHaveValue("2026-09-06");
  await screenshot(page, testInfo, "settle-resumed-after-scroll");
});

test("Chromium touches: a tap while a short drag slides back opens that game, and the date stays", async ({ page, harness, browserName }, testInfo) => {
  test.skip(browserName !== "chromium", "Needs real input-pipeline touches (CDP), which only Chromium provides here.");
  inputKind(browserName);
  harness.state.events = events();
  await harness.open();
  await assertFixtureMediaIsMuted(page);
  const held = await holdTouch(page, browserName, await startOf(page.locator("#game-ranked-live .game-summary")));
  await held.to(-50);
  await held.end();
  const point = await page.evaluate(() => new Promise(resolve => {
    const track = document.querySelector("section.score-content > .pager-track");
    const check = () => {
      const x = new DOMMatrixReadOnly(getComputedStyle(track).transform).m41, box = document.querySelector("#game-ranked-live .game-summary").getBoundingClientRect();
      if (x < -5) resolve({ x: box.left + 60, y: box.top + box.height / 2, offset: x }); else requestAnimationFrame(check);
    };
    check();
  }));
  test.info().annotations.push({ type: "tap point", description: JSON.stringify(point) });
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: point.x, y: point.y, id: 1 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } finally { await cdp.detach(); }
  await expect(page.locator(".game-screen")).toBeVisible();
  await expect(page).toHaveURL(/event=ranked-live/);
  await screenshot(page, testInfo, "tap-during-slide-back-opened");
  const down = (await page.evaluate(() => window.__issue172Motion)).findLast(entry => entry.type === "pointerdown");
  expect(down.offset, "the tap came while the results were sliding back").toBeLessThan(0);
  await page.goBack();
  await expect(dateInput(page)).toHaveValue("2026-09-05");
});

test("Chromium touches: scrolled deep in a long day, the neighbor keeps the natural top and its date cue stays on screen", async ({ page, harness, browserName }, testInfo) => {
  test.skip(browserName !== "chromium", "Needs real input-pipeline touches (CDP), which only Chromium provides here.");
  inputKind(browserName);
  harness.state.events = [...events(), ...Array.from({ length: 24 }, (_, i) => event(`many-${i}`, { scores: [i, 40], rank: 1 + (i % 25) }))];
  await harness.open();
  await assertFixtureMediaIsMuted(page);
  await page.evaluate(() => scrollTo(0, 1200));
  await frames(page);
  const scrolled = await page.evaluate(() => scrollY);
  expect(scrolled).toBeGreaterThan(600);
  const from = { x: 195, y: 420 };
  expect(await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest("section.score-content"), from)).toBe(true);
  const held = await holdTouch(page, browserName, from);
  await holdThrough(page, testInfo, held, [-60, -140], { side: 1, label: "Sun, Sep 6", has: ["1 game"], name: "deep-forward" });
  const cue = await caption(page, 1).boundingBox();
  expect(cue.y, "the date cue is below the top of the screen").toBeGreaterThanOrEqual(0);
  expect(cue.y + cue.height, "and above its bottom").toBeLessThanOrEqual(page.viewportSize().height);
  expect(await page.evaluate(() => scrollY), "holding never scrolls the page").toBe(scrolled);
  await held.end();
  await expect(dateInput(page)).toHaveValue("2026-09-06");
  await expect(region(page)).not.toHaveAttribute("data-pager");
  // The short day clamps the document normally; part of its results is on screen, never a blank page.
  const box = await region(page).boundingBox();
  expect(box.y + box.height, "the results region reaches into the viewport").toBeGreaterThan(0);
  await expect(page.locator("#game-sunday-acc")).toBeAttached();
  await screenshot(page, testInfo, "deep-forward-settled");
});

test("reduced motion: the held results still follow the finger, and release moves or returns at once", async ({ page, harness, browserName }, testInfo) => {
  inputKind(browserName);
  await page.emulateMedia({ reducedMotion: "reduce" });
  harness.state.events = events();
  await harness.open();
  await assertFixtureMediaIsMuted(page);
  let held = await holdTouch(page, browserName, await startOf(page.locator("#game-ranked-live .game-summary")));
  await holdThrough(page, testInfo, held, [-40], { side: 1, label: "Sun, Sep 6", has: [], name: "reduced-short" });
  await held.end();
  await frames(page);
  expect(Math.abs(await offset(page)), "a short release returns at once").toBe(0);
  await expect(page.locator(".pager-pane[data-side]")).toHaveCount(0);
  held = await holdTouch(page, browserName, await startOf(page.locator("#game-ranked-live .game-summary")));
  await holdThrough(page, testInfo, held, [-120], { side: 1, label: "Sun, Sep 6", has: ["1 game"], name: "reduced-commit" });
  await held.end();
  await expect(dateInput(page)).toHaveValue("2026-09-06");
  await sampleFrames(page, 5);
  expect((await samples(page, 5)).map(Math.abs), "no autonomous settling frames").toEqual([0, 0, 0, 0, 0]);
  await expect(page.locator(".pager-pane[data-side]")).toHaveCount(0);
  await screenshot(page, testInfo, "reduced-committed");
});

test("ORD-021 with #172: the neighbor lists exactly what the same filters would; All FBS, Hide finals and categories apply before and after a commit", async ({ page, harness, browserName }, testInfo) => {
  inputKind(browserName);
  harness.state.events = [
    ...events(),
    // Unranked, non-ACC, not One-score and no upset: listed only by All FBS.
    event("sunday-fbs", { date: "2026-09-06T17:00:00Z", state: "upcoming" }),
    event("sunday-fbs-final", { date: "2026-09-06T16:00:00Z", state: "final", scores: [0, 31] }),
  ];
  await harness.open();
  await assertFixtureMediaIsMuted(page);
  const look = async (count, has, hasNot, name) => {
    const held = await holdTouch(page, browserName, await startOf(page.locator("article.game-card").first()));
    await holdThrough(page, testInfo, held, [-100], { side: 1, label: "Sun, Sep 6", has: [count, ...has], hasNot, name });
    await held.to(-20); await held.end();
    await expect(region(page)).not.toHaveAttribute("data-pager");
    await expect(dateInput(page)).toHaveValue("2026-09-05");
  };
  await look("1 game", ["sunday-acc away"], ["sunday-fbs"], "curated");
  await page.getByLabel("All FBS games").check();
  await look("3 games", ["sunday-acc away", "sunday-fbs away", "sunday-fbs-final away"], [], "all-fbs");
  await page.getByLabel("Hide finals").check();
  await look("2 games", ["sunday-fbs away"], ["sunday-fbs-final"], "all-fbs-hide-finals");
  await category(page, "ACC").tap();
  await look("1 game", ["sunday-acc away"], ["sunday-fbs"], "all-fbs-acc");
  await category(page, "All FBS").tap();
  const held = await holdTouch(page, browserName, await startOf(page.locator("article.game-card").first()));
  await held.to(-120); await held.end();
  await expect(dateInput(page)).toHaveValue("2026-09-06");
  await expect(page.locator("#game-sunday-fbs")).toBeVisible();
  await expect(page.locator("#game-sunday-fbs-final")).toHaveCount(0);
  await expect(category(page, "All FBS")).toHaveAttribute("aria-label", "All FBS, 0 in progress, 2 total");
  await page.getByLabel("All FBS games").uncheck();
  await expect(page.locator("#game-sunday-fbs")).toHaveCount(0);
  await expect(page.locator("#game-sunday-acc")).toBeVisible();
});
