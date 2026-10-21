import { test, expect, period, dateInput } from "./fixtures.mjs";

// Owner feedback on the 1.20.0 preview (#172): choosing Week moved the Day/Week switch to its own line.
// The Week date row must keep the switch beside the week navigation and This week at ordinary phone
// widths, with readable, unclipped ranges (including month and year crossings), no overlap or page
// overflow, and the existing 44 px arrows and period targets. Narrow screens, enlarged text and zoom may
// wrap whole controls gracefully. Desktop engines with mobile emulation; not an iPhone.

async function screenshot(page, testInfo, name) {
  const path = testInfo.outputPath(`${name}.png`);
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

const weekLabel = page => page.locator(".week-label");

// The date row's geometry: each control's box, the range text's line boxes, and page overflow.
const measure = page => page.evaluate(() => {
  const box = element => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
  const bar = document.querySelector(".date-bar"), nav = bar.querySelector(".date-navigation"), modes = bar.querySelector(".period-modes");
  const arrows = [...nav.querySelectorAll("button.icon-button")], glyphs = arrows.map(button => button.querySelector("svg"));
  const range = bar.querySelector(".week-label > span:not(.week-note)") ?? bar.querySelector(".date-picker > span");
  const note = bar.querySelector(".week-note");
  return {
    width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth,
    bar: box(bar), nav: box(nav), modes: box(modes), today: box(bar.querySelector(".today-button")),
    periodButtons: [...modes.querySelectorAll("button")].map(box), arrows: arrows.map(box), glyphs: glyphs.map(box),
    range: box(range), rangeText: range.textContent, rangeClipped: range.scrollWidth > range.clientWidth + 1,
    rangeLines: Math.round(range.getBoundingClientRect().height / (Number.parseFloat(getComputedStyle(range).lineHeight) || range.getBoundingClientRect().height)), note: note ? { ...box(note), text: note.textContent } : null,
  };
});
const overlaps = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
const sameRow = (a, b) => a.top < b.bottom - 1 && b.top < a.bottom - 1;

// Every layout: whole, visible, non-overlapping controls with unchanged target sizes and no page overflow.
function expectCoherent(m, label) {
  expect(m.scrollWidth, `${label}: no horizontal page overflow`).toBeLessThanOrEqual(m.width);
  for (const arrow of m.arrows) { expect(arrow.width, `${label}: arrow target width`).toBeGreaterThanOrEqual(44); expect(arrow.height, `${label}: arrow target height`).toBeGreaterThanOrEqual(44); }
  for (const button of m.periodButtons) { expect(button.width, `${label}: period width`).toBeGreaterThanOrEqual(44 - 0.5); expect(button.height, `${label}: period height`).toBeGreaterThanOrEqual(40 - 0.5); }
  const controls = [["previous", m.arrows[0]], ["next", m.arrows[1]], ["today", m.today], ["period", m.modes]];
  for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) expect(overlaps(controls[i][1], controls[j][1]), `${label}: ${controls[i][0]} and ${controls[j][0]} do not overlap`).toBe(false);
  // The range text stays clear of the arrow glyphs and the other controls, inside the screen, unclipped.
  for (const [name, other] of [["previous glyph", m.glyphs[0]], ["next glyph", m.glyphs[1]], ["today", m.today], ["period", m.modes]]) expect(overlaps(m.range, other), `${label}: range clear of ${name}`).toBe(false);
  if (m.note) for (const [name, other] of [["previous glyph", m.glyphs[0]], ["next glyph", m.glyphs[1]], ["today", m.today], ["period", m.modes]]) expect(overlaps(m.note, other), `${label}: THU–MON clear of ${name}`).toBe(false);
  expect(m.range.left, `${label}: range on screen`).toBeGreaterThanOrEqual(0);
  expect(m.range.right, `${label}: range on screen`).toBeLessThanOrEqual(m.width);
  expect(m.rangeClipped, `${label}: range text not clipped`).toBe(false);
  for (const box of [m.nav, m.today, m.modes]) { expect(box.left).toBeGreaterThanOrEqual(-0.5); expect(box.right).toBeLessThanOrEqual(m.width + 0.5); }
}

const RANGES = [
  { path: "/?period=week", text: "Sep 3 – Sep 7", name: "current" },
  { path: "/?period=week&weekDate=2026-09-10", text: "Sep 10 – Sep 14", name: "two-digit" },
  { path: "/?period=week&weekDate=2026-10-29", text: "Oct 29 – Nov 2", name: "month-crossing" },
  { path: "/?period=week&weekDate=2026-12-31", text: "Dec 31 – Jan 4", name: "year-crossing" },
];

for (const width of [390, 393, 430, 440]) {
  test(`ordinary phone ${width}px: Week keeps Day/Week on the date row for every range, and This week returns to the current week`, async ({ page, harness }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await harness.open();
    await assertFixtureMediaIsMuted(page);
    // Day's row is unchanged by this correction; recorded for comparison.
    let m = await measure(page);
    testInfo.annotations.push({ type: `day ${width}`, description: JSON.stringify({ nav: m.nav, modes: m.modes, sameRow: sameRow(m.nav, m.modes) }) });
    expectCoherent(m, `Day ${width}`);
    await screenshot(page, testInfo, `day-${width}`);
    // The ordinary Day → Week switch.
    await period(page, "Week").tap();
    await expect(weekLabel(page)).toContainText("Sep 3 – Sep 7");
    m = await measure(page);
    testInfo.annotations.push({ type: `week ${width} after switch`, description: JSON.stringify({ nav: m.nav, modes: m.modes, range: m.range, rangeLines: m.rangeLines }) });
    expect(sameRow(m.nav, m.modes), "Week after Day → Week: switch on the date row").toBe(true);
    expect(sameRow(m.today, m.modes), "Week: This week on the same row").toBe(true);
    expect(m.note?.text, "Thursday–Monday stays visible").toBe("THU–MON");
    expectCoherent(m, `Week ${width}`);
    await screenshot(page, testInfo, `week-switched-${width}`);
    // Range changes by the arrows keep the row, then This week returns to the current week.
    await page.getByRole("button", { name: "Next week" }).tap();
    await expect(weekLabel(page)).toContainText("Sep 10 – Sep 14");
    m = await measure(page);
    expect(sameRow(m.nav, m.modes), "after Next week").toBe(true);
    expectCoherent(m, `Week next ${width}`);
    await page.getByRole("button", { name: "This week", exact: true }).tap();
    await expect(weekLabel(page)).toContainText("Sep 3 – Sep 7");
    await expect(page.getByRole("button", { name: "This week", exact: true })).toHaveClass(/is-today/);
    for (const range of RANGES) {
      await page.goto(range.path);
      await expect(weekLabel(page)).toContainText(range.text);
      m = await measure(page);
      testInfo.annotations.push({ type: `week ${width} ${range.name}`, description: JSON.stringify({ rangeLines: m.rangeLines, range: m.range }) });
      expect(m.rangeText, "the existing range wording").toBe(range.text);
      expect(sameRow(m.nav, m.modes), `${range.name}: switch on the date row`).toBe(true);
      expect(sameRow(m.today, m.modes), `${range.name}: This week on the same row`).toBe(true);
      expect(m.rangeLines, `${range.name}: the range breaks at most once`).toBeLessThanOrEqual(2);
      expectCoherent(m, `Week ${range.name} ${width}`);
      await screenshot(page, testInfo, `week-${range.name}-${width}`);
    }
  });
}

for (const [name, width, style] of [
  ["narrow-320", 320, ""],
  ["desktop-1280", 1280, ""],
  ["text-200-320", 320, "html { font-size: 200% !important; }"],
  ["text-200-390", 390, "html { font-size: 200% !important; }"],
  ["zoom-2-320", 320, "html { zoom: 2; }"],
  ["zoom-2-390", 390, "html { zoom: 2; }"],
]) {
  test(`${name}: Week's date row stays whole and readable, wrapping whole controls only when they cannot fit`, async ({ page, harness }, testInfo) => {
    await page.setViewportSize({ width, height: width > 1000 ? 900 : 844 });
    await harness.open();
    await assertFixtureMediaIsMuted(page);
    if (style) await page.addStyleTag({ content: style });
    await screenshot(page, testInfo, `${name}-day`);
    await period(page, "Week").tap();
    for (const range of RANGES) {
      if (range.name !== "current") await page.goto(range.path);
      if (range.name !== "current" && style) await page.addStyleTag({ content: style });
      await expect(weekLabel(page)).toContainText(range.text);
      const m = await measure(page);
      testInfo.annotations.push({ type: `${name} ${range.name}`, description: JSON.stringify({ nav: m.nav, today: m.today, modes: m.modes, rangeLines: m.rangeLines }) });
      expect(m.rangeText).toBe(range.text);
      expect(m.note?.text).toBe("THU–MON");
      expectCoherent(m, `${name} ${range.name}`);
      // Wrapping, when needed, keeps This week with Day/Week whenever the two fit side by side.
      if (!sameRow(m.nav, m.modes) && m.today.width + 4 + m.modes.width <= m.bar.width) expect(sameRow(m.today, m.modes), `${name} ${range.name}: This week stays beside Day/Week`).toBe(true);
      if (name === "desktop-1280") expect(sameRow(m.nav, m.modes), "desktop: one row").toBe(true);
      await screenshot(page, testInfo, `${name}-week-${range.name}`);
    }
    // The controls still work after wrapping.
    await page.getByRole("button", { name: "Previous week" }).click();
    await expect(weekLabel(page)).toContainText("Dec 24 – Dec 28");
    await period(page, "Day").click();
    await expect(dateInput(page)).toHaveValue("2026-09-05");
  });
}

// Reference for review: the same page with the pre-correction Week rules restored by a test-only style
// (simulated, not the old build) shows the reported defect: Day/Week alone on the next row at 390 px.
test("reference: the pre-correction Week row puts Day/Week on its own line at 390px", async ({ page, harness }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await harness.open({ path: "/?period=week&weekDate=2026-09-10" });
  await assertFixtureMediaIsMuted(page);
  await expect(weekLabel(page)).toContainText("Sep 10 – Sep 14");
  const after = await measure(page);
  expect(sameRow(after.nav, after.modes)).toBe(true);
  await screenshot(page, testInfo, "after-390");
  await page.addStyleTag({ content: `
    .compact-scoreboard .date-bar { container: none !important; }
    .compact-scoreboard .week-navigation { flex: 0 1 auto !important; min-width: 0 !important; max-width: none !important; }
    .compact-scoreboard .week-navigation .week-label { flex: 0 1 auto !important; flex-direction: row !important; flex-wrap: wrap !important; row-gap: 3px !important; margin: 0 !important; line-height: inherit !important; text-align: start !important; pointer-events: auto !important; }
    .compact-scoreboard .week-navigation .week-label > svg { display: block !important; }
    .compact-scoreboard .week-navigation .week-note { margin-left: 4px !important; }` });
  const before = await measure(page);
  testInfo.annotations.push({ type: "simulated before", description: JSON.stringify({ nav: before.nav, modes: before.modes }) });
  expect(sameRow(before.nav, before.modes), "pre-correction rules: the switch drops to its own row").toBe(false);
  await screenshot(page, testInfo, "before-simulated-390");
});
