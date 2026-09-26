import { test, expect, event, cards } from './fixtures.mjs';

const controls = ['Alerts off', 'Refresh scores', 'How this scoreboard works', 'Settings'];
async function geometry(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const boxes = [];
  for (const name of controls) {
    const control = page.getByRole('button', { name, exact: true });
    await expect(control).toBeVisible();
    const box = await control.boundingBox();
    expect(box.width, name).toBeGreaterThanOrEqual(44);
    expect(box.height, name).toBeGreaterThanOrEqual(44);
    boxes.push(box);
  }
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true);
  }
}
for (const width of [390, 320]) test(`compact default geometry at ${width}px`, async ({ page, harness }, info) => {
  await page.setViewportSize({ width, height: 844 });
  await harness.open();
  await expect(cards(page)).toHaveCount(3);
  await geometry(page);
  const metrics = await cards(page).evaluateAll(elements => elements.map(el => ({ id: el.id, top: el.getBoundingClientRect().top, height: el.getBoundingClientRect().height })));
  expect(metrics[0].top).toBeLessThan(width === 390 ? 350 : 400);
  for (const row of metrics) expect(row.height).toBeLessThan(150);
  await expect(page.getByText('Auto-refresh on', { exact: true })).toHaveCount(0);
  await expect(page.locator('.timezone-cue')).toHaveCount(1);
  await info.attach('compact-geometry', { body: JSON.stringify({ width, metrics }), contentType: 'application/json' });
  await page.screenshot({ path: info.outputPath(`compact-${width}.png`), fullPage: true, animations: 'disabled' });
});

test('320px row keeps records, betting line, and score readable together', async ({ page, harness }, info) => {
  const matchup = event('record-line', { state: 'upcoming', rank: 5 });
  const [away, home] = matchup.competitions[0].competitors;
  away.team.shortDisplayName = 'Mississippi State';
  home.team.shortDisplayName = 'North Carolina';
  away.records = [{ type: 'total', summary: '3-1' }];
  home.records = [{ type: 'total', summary: '2-2' }];
  matchup.competitions[0].odds = [{ spread: -14.5, provider: { name: 'ESPN' },
    awayTeamOdds: { favorite: false, team: { id: away.team.id } },
    homeTeamOdds: { favorite: true, team: { id: home.team.id } } }];
  harness.state.events = [matchup];
  await page.setViewportSize({ width: 320, height: 700 });
  await harness.open({ path: '/?date=2026-09-05' });
  const row = page.locator('#game-record-line');
  await expect(row.locator('.team-record')).toHaveText(['3-1', '2-2']);
  await expect(row.locator('.team-line-visible')).toHaveText('−14.5');
  await expect(row.locator('.team-line-visible')).not.toContainText('Pregame');
  await geometry(page);
  await page.screenshot({ path: info.outputPath('records-line-320.png'), fullPage: true, animations: 'disabled' });
});

test('after kickoff the line moves below the collapsed score row', async ({ page, harness }, info) => {
  const withRecords = game => {
    const [away, home] = game.competitions[0].competitors;
    away.team.shortDisplayName = 'Mississippi State';
    home.team.shortDisplayName = 'North Carolina';
    away.records = [{ type: 'total', summary: '3-1' }];
    home.records = [{ type: 'total', summary: '2-2' }];
    return game;
  };
  const upcoming = withRecords(event('line-transition', { state: 'upcoming', rank: 5 }));
  const [away, home] = upcoming.competitions[0].competitors;
  upcoming.competitions[0].odds = [{ spread: -7.5, provider: { name: 'ESPN' },
    awayTeamOdds: { favorite: false, team: { id: away.team.id } },
    homeTeamOdds: { favorite: true, team: { id: home.team.id } } }];
  harness.state.events = [upcoming];
  await page.setViewportSize({ width: 320, height: 700 });
  await harness.open({ path: '/?date=2026-09-05' });
  const row = page.locator('#game-line-transition');
  await expect(row.locator('summary .team-line-visible')).toHaveText('−7.5');

  harness.state.events = [withRecords(event('line-transition', { state: 'live', rank: 5 }))];
  await page.getByRole('button', { name: 'Refresh scores' }).click();
  await expect(row.locator('.game-status')).toContainText('4th');
  await expect(row.locator('summary .team-line, summary .pickem-line')).toHaveCount(0);
  await expect(row.locator('summary .team-record')).toHaveText(['3-1', '2-2']);
  await expect(row.locator('.detail-line')).toBeHidden();
  await row.locator('summary').click();
  await expect(row.locator('.detail-line')).toContainText('North Carolina −7.5');
  await expect(row.locator('.detail-line')).toContainText('ESPN');
  await page.screenshot({ path: info.outputPath('live-line-in-details-320.png'), fullPage: true, animations: 'disabled' });

  harness.state.events = [withRecords(event('line-transition', { state: 'final', rank: 5 }))];
  await page.getByRole('button', { name: 'Refresh scores' }).click();
  await expect(row.locator('.game-status')).toHaveText('Final');
  await expect(row.locator('summary .team-line, summary .pickem-line')).toHaveCount(0);
  await expect(row.locator('.detail-line')).toContainText('North Carolina −7.5');
  await geometry(page);
});

test('details support keyboard and touch, preserve live-to-final context and show overall records', async ({ page, harness }, info) => {
  const game = event('context', { rank: 5 });
  game.competitions[0].situation = { possession: 'context-away', isRedZone: true, downDistanceText: '3rd & 2 at HOME 12' };
  for (const team of game.competitions[0].competitors) team.records = [{ type: 'total', summary: '3-1' }];
  harness.state.events = [game];
  await harness.open({ path: '/?date=2026-09-05' });
  const row = page.locator('#game-context'), details = row.locator('details'), summary = row.locator('summary');
  await expect(details).not.toHaveAttribute('open');
  await expect(summary).toContainText('Game details:');
  await expect(summary.locator('a,button,input')).toHaveCount(0);
  await expect(summary).toContainText('RED ZONE');
  await expect(summary.getByLabel('Possession')).toBeVisible();
  await summary.focus(); await summary.press('Enter');
  await expect(details).toHaveAttribute('open', '');
  await expect(row.getByRole('link', { name: /Open context away vs context home on ESPN/ })).toHaveAttribute('href', /espn.com/);
  await expect(row.locator('.drive')).toContainText('3rd & 2');
  await expect(row.locator('.team-record')).toHaveText(['3-1', '3-1']);
  await page.screenshot({ path: info.outputPath('compact-expanded.png'), fullPage: true, animations: 'disabled' });
  harness.state.events = [event('context', { rank: 5, state: 'final', scores: [28, 21] })];
  await page.clock.fastForward(31_000);
  await expect(row.locator('.game-status')).toHaveText('Final');
  await expect(details).toHaveAttribute('open', '');
  await expect(summary).toContainText('Earlier upset watch');
  await summary.tap(); await expect(details).not.toHaveAttribute('open');
  await summary.press('Space'); await expect(details).toHaveAttribute('open', '');
});

test('focused links disclose only visible games and opening bell does not enable notifications', async ({ page, harness }) => {
  await harness.open({ path: '/?date=2026-09-05#game-ranked-live' });
  await expect(page.locator('#game-ranked-live details')).toHaveAttribute('open', '');
  const landing = await page.locator('#game-ranked-live summary').boundingBox();
  const tabs = await page.locator('.filter-tabs').boundingBox();
  expect(landing.y).toBeGreaterThanOrEqual(tabs.y + tabs.height);
  expect(landing.y + landing.height).toBeLessThan(844);
  await page.locator('#game-ranked-live summary').tap();
  await page.clock.fastForward(31_000);
  await expect(page.locator('#game-ranked-live details')).not.toHaveAttribute('open');
  await page.getByRole('button', { name: 'Alerts off', exact: true }).tap();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await page.evaluate(() => window.__pushSimulation)).toEqual({ permissionRequests: 0, subscribes: 0, unsubscribes: 0 });
  expect(harness.state.alertRequests.filter(request => request.method !== 'GET')).toEqual([]);
  await page.getByRole('button', { name: 'Close', exact: true }).tap();
  await expect(page.getByRole('button', { name: 'Alerts off', exact: true })).toBeFocused();
});

for (const width of [320, 375, 390, 430, 700]) test(`long names and broadcasts wrap with 200 percent text at ${width}px`, async ({ page, harness }, info) => {
  const game = event('long', { rank: 12, scores: [100, 107] });
  game.competitions[0].competitors[0].team.shortDisplayName = 'Northern Appalachian State Mountaineers';
  game.competitions[0].competitors[1].team.shortDisplayName = 'Coastal Carolina Chanticleers';
  game.competitions[0].broadcasts[0].names = ['ESPN College Football Alternate Network'];
  harness.state.events = [game];
  await page.setViewportSize({ width, height: 844 });
  await harness.open();
  const initial = await page.locator('.team-name').first().evaluate(el => parseFloat(getComputedStyle(el).fontSize));
  await page.addStyleTag({ content: 'html { font-size: 200%; }' });
  expect(await page.locator('.team-name').first().evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBe(initial * 2);
  await geometry(page);
  for (const el of await page.locator('.team-name, .score, .broadcast, .game-meta').all()) expect(await el.evaluate(node => node.clientWidth > 0 && node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await expect(page.locator('.team-name').first()).toContainText('Northern Appalachian State Mountaineers');
  await page.screenshot({ path: info.outputPath(`compact-${width}-large-text.png`), fullPage: true, animations: 'disabled' });
});

test.describe('device time distinct from Eastern date', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });
  test('one honest cue in daily and weekly views', async ({ page, harness }) => {
    await harness.open();
    await expect(page.locator('.timezone-cue')).toHaveText('Dates ET · Kickoffs PDT');
    await page.getByRole('group', { name: 'Scoreboard period' }).getByRole('button', { name: 'Week', exact: true }).tap();
    await page.getByRole('button', { name: /^ACC/ }).tap();
    await expect(page.locator('.timezone-cue')).toHaveText('Dates ET · Kickoffs PDT');
    await expect(page.locator('#game-sunday-acc .game-day-label')).toHaveText('Sun, Sep 6');
    await expect(page.locator('#game-sunday-acc .game-status')).toHaveText('2:00 PM');
  });
});


test('update restoration opens details while hidden Duke focus stays protected', async ({ page, harness }) => {
  const duke = event('duke-hidden', { acc: true });
  duke.competitions[0].competitors[0].team.id = '150';
  duke.competitions[0].competitors[0].team.shortDisplayName = 'Duke';
  harness.state.events.push(duke);
  await harness.open({ path: '/?date=2026-09-05&_ss_update=' + 'a'.repeat(40) + '&_ss_hide_finals=0&_ss_focus=ranked-live' });
  await expect(page.locator('#game-ranked-live details')).toHaveAttribute('open', '');
  await page.goto('/?date=2026-09-05#game-duke-hidden');
  await expect(page.getByRole('button', { name: 'Refresh scores' })).toBeEnabled();
  await expect(page.locator('#game-duke-hidden')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Show Duke game on Sep 5', exact: true })).toBeVisible();
});

test('delayed state remains visible and full explanation is disclosed', async ({ page, harness }) => {
  const delayed = event('paused', { rank: 5 });
  delayed.status.type = { name: 'STATUS_DELAYED', state: 'in', completed: false, shortDetail: 'Delayed' };
  harness.state.events = [delayed];
  await harness.open();
  const row = page.locator('#game-paused');
  await expect(row.locator('.game-status')).toHaveText('Delayed');
  await row.locator('summary').tap();
  await expect(row.locator('.delay-note')).toHaveText('Play paused. Watching for an update.');
});


test('score change feedback remains on summary scores and honors reduced motion', async ({ page, harness }) => {
  await harness.open({ path: '/?date=2026-09-05' });
  harness.state.events[0].competitions[0].competitors[0].score = '17';
  await page.getByRole('button', { name: 'Refresh scores' }).tap();
  const changed = page.locator('#game-ranked-live summary .score-changed').first();
  await expect(changed).toHaveText('17');
  expect(await changed.evaluate(el => getComputedStyle(el).animationName)).toBe('score-flash');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await changed.evaluate(el => getComputedStyle(el).animationName)).toBe('none');
});
