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

test('approved bare spread stays with Georgia through live and final', async ({ page, harness }, info) => {
  const matchup = event('approved-bare-spread', { state: 'upcoming', rank: null, scores: [17, 21] });
  const [georgia, texas] = matchup.competitions[0].competitors;
  georgia.team.shortDisplayName = 'Georgia'; georgia.team.displayName = 'Georgia'; georgia.team.name = 'Georgia';
  texas.team.shortDisplayName = 'Texas'; texas.team.displayName = 'Texas'; texas.team.name = 'Texas';
  georgia.team.abbreviation = 'UGA'; texas.team.abbreviation = 'TEX';
  georgia.curatedRank = { current: 4 }; texas.curatedRank = { current: 7 };
  georgia.records = [{ type: 'total', summary: '6-1' }];
  texas.records = [{ type: 'total', summary: '6-1' }];
  matchup.competitions[0].broadcasts = [{ names: ['ABC'] }];
  matchup.competitions[0].odds = [{ spread: 6.5, provider: { name: 'ESPN' },
    awayTeamOdds: { favorite: true, team: { id: georgia.team.id } },
    homeTeamOdds: { favorite: false, team: { id: texas.team.id } } }];
  harness.state.events = [matchup];
  await page.setViewportSize({ width: 390, height: 844 });
  await harness.open({ path: '/?date=2026-09-05' });
  const row = page.locator('#game-approved-bare-spread');
  await expect(row.locator('.team-line-visible')).toHaveText('−6.5');

  harness.state.events = [event('approved-bare-spread', { state: 'live', scores: [17, 21] })];
  const live = harness.state.events[0], [liveGeorgia, liveTexas] = live.competitions[0].competitors;
  liveGeorgia.team.shortDisplayName = 'Georgia'; liveGeorgia.team.displayName = 'Georgia'; liveGeorgia.team.name = 'Georgia';
  liveTexas.team.shortDisplayName = 'Texas'; liveTexas.team.displayName = 'Texas'; liveTexas.team.name = 'Texas';
  liveGeorgia.team.abbreviation = 'UGA'; liveTexas.team.abbreviation = 'TEX';
  liveGeorgia.curatedRank = { current: 4 }; liveTexas.curatedRank = { current: 7 };
  liveGeorgia.records = [{ type: 'total', summary: '6-1' }]; liveTexas.records = [{ type: 'total', summary: '6-1' }];
  live.competitions[0].broadcasts = [{ names: ['ABC'] }];
  live.status.period = 2; live.status.clock = 138; live.status.type.shortDetail = '2nd - 2:18';
  await page.getByRole('button', { name: 'Refresh scores' }).click();
  await expect(row.locator('.game-status')).toContainText('2nd');
  await page.screenshot({ path: info.outputPath('approved-bare-spread-live.png'), fullPage: true, animations: 'disabled' });
  await expect(row.locator('.team-line-visible')).toHaveText('−6.5');
  await expect(row.locator('.team-label').first()).toContainText('Georgia');
  await expect(row.locator('.team-label').last()).toContainText('Texas');
  await expect(row.locator('.compact-upset')).toHaveText('Upset watch');
  await expect(row).toContainText('ABC');
  await expect(row.locator('.team-line-visible')).not.toContainText(/Pregame|ESPN/);
  await rowFits(page, row);

  harness.state.events = [event('approved-bare-spread', { state: 'final', scores: [17, 21] })];
  const final = harness.state.events[0], [finalGeorgia, finalTexas] = final.competitions[0].competitors;
  finalGeorgia.team.shortDisplayName = 'Georgia'; finalGeorgia.team.displayName = 'Georgia'; finalGeorgia.team.name = 'Georgia';
  finalTexas.team.shortDisplayName = 'Texas'; finalTexas.team.displayName = 'Texas'; finalTexas.team.name = 'Texas';
  finalGeorgia.team.abbreviation = 'UGA'; finalTexas.team.abbreviation = 'TEX';
  finalGeorgia.curatedRank = { current: 4 }; finalTexas.curatedRank = { current: 7 };
  finalGeorgia.records = [{ type: 'total', summary: '6-1' }]; finalTexas.records = [{ type: 'total', summary: '6-1' }];
  final.competitions[0].broadcasts = [{ names: ['ABC'] }];
  await page.clock.fastForward(31_000);
  await expect(row.locator('.game-status')).toHaveText('Final');
  await expect(row.locator('.team-line-visible')).toHaveText('−6.5');
  await expect(row.locator('.compact-upset')).toHaveText('Upset final');
  await rowFits(page, row);
  await page.screenshot({ path: info.outputPath('approved-bare-spread-final.png'), fullPage: true, animations: 'disabled' });
});

test('text logo fallbacks stay inside their boxes at 200 percent text', async ({ page, harness }, info) => {
  const live = event('fallback-live', { state: 'live', rank: 5 });
  const upcoming = event('fallback-upcoming', { state: 'upcoming', rank: 12 });
  live.competitions[0].competitors[0].team.abbreviation = 'WMW';
  upcoming.competitions[0].competitors[0].team.abbreviation = 'MSU';
  live.competitions[0].competitors[1].team.logo = 'https://a.espncdn.com/test-logo.png';
  await page.route('https://a.espncdn.com/**', route => route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64') }));
  harness.state.events = [live, upcoming];
  await harness.open({ path: '/?date=2026-09-05' });

  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    for (const scale of [100, 200]) {
      await page.addStyleTag({ content: `html { font-size: ${scale}%; }` });
      await expect(page.locator('.team-logo-fallback')).toHaveCount(3);
      const sizes = await page.locator('.team-logo').evaluateAll(logos => logos.map(logo => {
        const box = logo.getBoundingClientRect();
        const text = logo.querySelector('span');
        let glyph = null;
        if (text) { const range = document.createRange(); range.selectNodeContents(text); glyph = range.getBoundingClientRect(); }
        return { fallback: !!text, width: box.width, height: box.height, scrollWidth: logo.scrollWidth, clientWidth: logo.clientWidth,
          scrollHeight: logo.scrollHeight, clientHeight: logo.clientHeight, fontSize: text && parseFloat(getComputedStyle(text).fontSize),
          contained: !glyph || (glyph.left >= box.left - .5 && glyph.right <= box.right + .5 && glyph.top >= box.top - .5 && glyph.bottom <= box.bottom + .5) };
      }));
      for (const logo of sizes) {
        expect(logo.contained, `fallback glyph at ${width}px/${scale}%`).toBe(true);
        expect(logo.scrollWidth).toBeLessThanOrEqual(logo.clientWidth);
        expect(logo.scrollHeight).toBeLessThanOrEqual(logo.clientHeight);
        if (logo.fallback) { expect(logo.width).toBeGreaterThanOrEqual(22); expect(logo.height).toBeGreaterThanOrEqual(24); expect(logo.fontSize).toBe(scale === 200 ? 16 : 8); }
        else { expect(logo.width).toBe(22); expect(logo.height).toBe(24); }
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await rowFits(page, page.locator('#game-fallback-live'));
      await rowFits(page, page.locator('#game-fallback-upcoming'));
      if (width === 320) await page.screenshot({ path: info.outputPath(`fallback-${width}-${scale}.png`), fullPage: true, animations: 'disabled' });
    }
  }
});

// The game screen's score area and line row stay inside the page at every width. The score header
// refits itself after a text-size or zoom change on the next frame, so the same bounds are polled.
async function screenFits(page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect.poll(() => page.locator('.game-screen').evaluate(screen => {
    const problems = [], edge = screen.getBoundingClientRect();
    for (const el of screen.querySelectorAll('.mh-name, .mh-meta, .mh-score, .mh-status, .detail-line, .detail-line > [aria-hidden], .drive, .game-context')) {
      const box = el.getBoundingClientRect();
      if (el.scrollWidth > el.clientWidth + 1) problems.push(`${el.className || el.tagName} overflows`);
      if (box.left < edge.left - 1 || box.right > edge.right + 1) problems.push(`${el.className || el.tagName} leaves the screen`);
    }
    // A name or record never runs under a score or the other team.
    for (const el of screen.querySelectorAll('.mh-name, .mh-meta')) {
      const box = el.getBoundingClientRect(), column = el.closest('.mh-team').getBoundingClientRect();
      if (box.left < column.left - 1 || box.right > column.right + 1) problems.push(`${el.className} leaves its team column`);
    }
    return problems;
  })).toEqual([]);
  // Full names stay whole text, never truncated.
  for (const el of await page.locator('.game-screen .mh-name').all()) expect(await el.evaluate(node => getComputedStyle(node).textOverflow)).not.toBe('ellipsis');
}
const openScreen = async (page, id) => { await page.locator(`#game-${id} a.game-summary`).tap(); await expect(page.locator('.game-screen')).toBeVisible(); };
const closeScreen = async page => { await page.locator('.game-screen').getByRole('button', { name: /^Back to scores/ }).tap(); await expect(page.locator('.game-screen')).toHaveCount(0); };

test('touch users can open upcoming games to read favorite and pickem sources', async ({ page, harness }, info) => {
  const favorite = event('touch-favorite', { state: 'upcoming', rank: 5 });
  const pickem = event('touch-pickem', { state: 'upcoming', rank: 12 });
  for (const [matchup, spread] of [[favorite, -7.5], [pickem, 0]]) {
    const [away, home] = matchup.competitions[0].competitors;
    matchup.competitions[0].odds = [{ spread, provider: { name: 'ESPN BET Sportsbook' },
      awayTeamOdds: { favorite: false, team: { id: away.team.id } },
      homeTeamOdds: { favorite: spread !== 0, team: { id: home.team.id } } }];
  }
  harness.state.events = [favorite, pickem];
  await page.setViewportSize({ width: 320, height: 844 });
  await harness.open({ path: '/?date=2026-09-05' });
  // The game screen's line row names no bookmaker, visibly or to screen readers (user request).
  for (const [id, inline, spoken, visible] of [['touch-favorite', '−7.5', 'Pregame betting line: touch-favorite home favored by 7.5 points', 'touch-favorite home −7.5'], ['touch-pickem', 'PK', 'Pregame pick’em line', 'PK']]) {
    const row = page.locator(`#game-${id}`), summary = row.locator('a.game-summary');
    await expect(summary.locator(id === 'touch-favorite' ? '.team-line-visible' : '.pickem-line [aria-hidden]')).toHaveText(inline);
    await expect(row.locator('.detail-line')).toHaveCount(0);
    await rowFits(page, row);
    await openScreen(page, id);
    const line = page.locator('.game-screen .detail-line');
    await expect(line).toBeVisible();
    await expect(line.locator('[aria-hidden="true"]')).toHaveText(['Line', visible]);
    await expect(line).not.toContainText('ESPN');
    expect((await line.ariaSnapshot())).toContain(spoken);
    expect((await line.ariaSnapshot())).not.toContain('ESPN');
    expect((await line.locator('[aria-hidden="true"]').allInnerTexts()).join(' ')).not.toMatch(/Pregame/i);
    await screenFits(page);
    await page.screenshot({ path: info.outputPath(`${id}-screen-320.png`), animations: 'disabled' });
    await page.addStyleTag({ content: 'html { font-size: 200%; }' });
    await screenFits(page);
    await page.addStyleTag({ content: 'html { font-size: 100%; }' });
    await closeScreen(page);
  }
  await page.addStyleTag({ content: 'html { font-size: 200%; }' });
  for (const row of await page.locator('#game-touch-favorite, #game-touch-pickem').all()) await rowFits(page, row);
  await page.screenshot({ path: info.outputPath('touch-sources-320-large-text.png'), fullPage: true, animations: 'disabled' });
});

test('after kickoff the original line stays beside the favorite and on the game screen', async ({ page, harness }, info) => {
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
  const row = page.locator('#game-line-transition'), screenLine = page.locator('.game-screen .detail-line');
  await expect(row.locator('a.game-summary .team-line-visible')).toHaveText('−7.5');

  harness.state.events = [withRecords(event('line-transition', { state: 'live', rank: 5 }))];
  await page.getByRole('button', { name: 'Refresh scores' }).click();
  await expect(row.locator('.game-status')).toContainText('4th');
  await expect(row.locator('a.game-summary .team-line-visible')).toHaveText('−7.5');
  await expect(row.locator('a.game-summary .team-record')).toHaveText(['3-1', '2-2']);
  await expect(row.locator('.detail-line')).toHaveCount(0);
  await row.locator('a.game-summary').click();
  await expect(screenLine).toContainText('North Carolina −7.5');
  await expect(screenLine).not.toContainText('ESPN');
  await expect(page.locator('.game-screen .mh-meta')).toHaveText(['3-1 · Away', '2-2 · Home']);
  await page.screenshot({ path: info.outputPath('live-line-on-screen-320.png'), fullPage: true, animations: 'disabled' });

  // The line stays with the open game as it finishes.
  harness.state.events = [withRecords(event('line-transition', { state: 'final', rank: 5 }))];
  await page.clock.fastForward(31_000);
  await expect(page.locator('.game-screen .mh-state')).toHaveText('Final');
  await expect(screenLine).toContainText('North Carolina −7.5');
  await expect(screenLine).not.toContainText('ESPN');
  await screenFits(page);
  await closeScreen(page);
  await expect(row.locator('.game-status')).toHaveText('Final');
  await expect(row.locator('a.game-summary .team-line-visible')).toHaveText('−7.5');
  await geometry(page);
});

// Card contents stay inside the card, and names or records never run under the score.
async function rowFits(page, row) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await row.evaluate(card => {
    const problems = [], edge = card.getBoundingClientRect();
    for (const el of card.querySelectorAll('.team-name, .team-record, .score, .game-meta, .detail-line, .detail-line > [aria-hidden]')) {
      const box = el.getBoundingClientRect();
      if (el.scrollWidth > el.clientWidth + 1) problems.push(`${el.className || el.tagName} overflows`);
      if (box.left < edge.left - 1 || box.right > edge.right + 1) problems.push(`${el.className || el.tagName} leaves the card`);
    }
    for (const team of card.querySelectorAll('a.game-summary .team-row')) {
      if (team.querySelector('.team-identity').getBoundingClientRect().right > team.querySelector('.score').getBoundingClientRect().left + 1) problems.push('team identity overlaps score');
    }
    return problems;
  })).toEqual([]);
}

for (const state of ['live', 'delayed', 'final']) test(`${state} game screen line, records and scores fit phone and desktop widths`, async ({ page, harness }, info) => {
  const id = `fit-${state}`;
  const matchup = started => {
    const game = event(id, { state: !started ? 'upcoming' : state === 'final' ? 'final' : 'live', rank: 12, scores: [100, 107] });
    const competition = game.competitions[0], [away, home] = competition.competitors;
    away.team.shortDisplayName = 'Northern Appalachian State Mountaineers';
    home.team.shortDisplayName = 'Coastal Carolina Chanticleers';
    away.records = [{ type: 'total', summary: '10-2' }];
    home.records = [{ type: 'total', summary: '12-12-1' }];
    competition.broadcasts[0].names = ['ESPN College Football Alternate Network'];
    if (!started) competition.odds = [{ spread: 14.5, provider: { name: 'ESPN BET Sportsbook' },
      awayTeamOdds: { favorite: true, team: { id: away.team.id } },
      homeTeamOdds: { favorite: false, team: { id: home.team.id } } }];
    if (started && state === 'live') competition.situation = { possession: away.team.id, isRedZone: true, downDistanceText: '3rd & Goal at CCU 4' };
    if (started && state === 'delayed') game.status.type = { name: 'STATUS_DELAYED', state: 'in', completed: false, shortDetail: 'Delayed' };
    return game;
  };
  harness.state.events = [matchup(false)];
  await page.setViewportSize({ width: 320, height: 844 });
  await harness.open({ path: '/?date=2026-09-05' });
  const row = page.locator(`#game-${id}`), summary = row.locator('a.game-summary'), line = page.locator('.game-screen .detail-line');
  await expect(summary.locator('.team-line-visible')).toHaveText('−14.5');

  harness.state.events = [matchup(true)];
  await page.getByRole('button', { name: 'Refresh scores' }).click();
  await expect(row.locator('.game-status')).toHaveText(state === 'final' ? 'Final' : state === 'delayed' ? 'Delayed' : /4th/);
  await expect(summary.locator('.team-line-visible')).toHaveText('−14.5');
  await expect(summary.locator('.team-record')).toHaveText(['10-2', '12-12-1']);
  await expect(summary.getByLabel('Possession')).toHaveCount(state === 'live' ? 1 : 0);
  await rowFits(page, row);
  await summary.focus(); await summary.press('Enter');
  await expect(line).toBeVisible();
  await expect(line).toContainText('Northern Appalachian State Mountaineers −14.5');
  // The bookmaker is not shown on the game screen's line row (user request); the broadcast elsewhere is unaffected.
  await expect(line).not.toContainText('ESPN');
  // Screen readers get the context instead of the visible label and minus sign.
  const spoken = await line.ariaSnapshot();
  expect(spoken).toContain('Pregame betting line: Northern Appalachian State Mountaineers favored by 14.5 points');
  expect(spoken).not.toContain('ESPN');
  expect(spoken).not.toContain('−');
  await expect(page.locator('.game-screen .mh-meta')).toHaveText(['10-2 · Away', '12-12-1 · Home']);
  await expect(page.locator('.game-screen .mh-name').first()).toContainText('Northern Appalachian State Mountaineers');
  if (state === 'live') await expect(page.locator('.game-screen .drive')).toContainText('3rd & Goal at CCU 4');
  if (state === 'delayed') await expect(page.locator('.game-screen .delay-note')).toBeVisible();

  const widths = [];
  for (const width of [320, 375, 390, 430, 768, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await screenFits(page);
    const box = await page.locator('.game-screen .masthead').boundingBox();
    widths.push({ width, masthead: Math.round(box.width), height: Math.round(box.height) });
    await page.locator('.game-screen .masthead').screenshot({ path: info.outputPath(`${state}-screen-${width}.png`), animations: 'disabled' });
  }
  await page.setViewportSize({ width: 320, height: 844 });
  const scaled = page.locator(state === 'live' ? '.game-screen .detail-line, .game-screen .drive > span' : '.game-screen .detail-line');
  const sizes = () => scaled.evaluateAll(els => els.map(el => parseFloat(getComputedStyle(el).fontSize)));
  const baseSizes = await sizes();
  await page.addStyleTag({ content: 'html { font-size: 200%; }' });
  expect(await sizes()).toEqual(baseSizes.map(size => size * 2));
  await screenFits(page);
  await page.screenshot({ path: info.outputPath(`${state}-screen-320-large-text.png`), animations: 'disabled' });
  await info.attach('screen-geometry', { body: JSON.stringify({ state, widths }), contentType: 'application/json' });

  await closeScreen(page); await expect(line).toHaveCount(0);
  await rowFits(page, row);
  await openScreen(page, id); await expect(line).toBeVisible();
});

test('malformed ESPN records are omitted without dropping the game at 320px', async ({ page, harness }) => {
  const game = event('odd-records', { rank: 5 });
  const [away, home] = game.competitions[0].competitors;
  away.records = [{ type: 'total', summary: 'Overall record pending conference review 2026' }];
  home.records = [{ type: 'total', summary: null }];
  harness.state.events = [game];
  await page.setViewportSize({ width: 320, height: 844 });
  await harness.open({ path: '/?date=2026-09-05' });
  const row = page.locator('#game-odd-records');
  await expect(row.locator('.score')).toHaveText(['14', '21']);
  await expect(row.locator('.team-record')).toHaveCount(0);
  await expect(page.locator('.feed-banner')).toHaveCount(0);
  await rowFits(page, row);
});

test('game links support keyboard and touch, preserve live-to-final context and show overall records', async ({ page, harness }, info) => {
  const game = event('context', { rank: 5 });
  game.competitions[0].situation = { possession: 'context-away', isRedZone: true, downDistanceText: '3rd & 2 at HOME 12' };
  for (const team of game.competitions[0].competitors) team.records = [{ type: 'total', summary: '3-1' }];
  harness.state.events = [game];
  await harness.open({ path: '/?date=2026-09-05' });
  const row = page.locator('#game-context'), summary = row.locator('a.game-summary'), screen = page.locator('.game-screen');
  await expect(row.locator('details, .game-details')).toHaveCount(0);
  await expect(summary).toContainText('Game details:');
  await expect(summary.locator('a,button,input')).toHaveCount(0);
  await expect(summary).toContainText('RED ZONE');
  await expect(summary.getByLabel('Possession')).toBeVisible();
  await summary.focus(); await summary.press('Enter');
  await expect(screen).toBeVisible();
  // The game stays in the app: no external ESPN/Gamecast link on the screen (user request).
  await expect(screen.getByRole('link')).toHaveCount(0);
  await expect(screen.locator('a[href*="espn.com"]')).toHaveCount(0);
  await expect(screen.locator('.drive')).toContainText('3rd & 2');
  await expect(screen.locator('.drive')).toContainText('RED ZONE');
  await expect(screen.locator('.possession')).toHaveCount(1);
  await expect(screen.locator('.mh-meta')).toHaveText(['3-1 · Away', '3-1 · Home']);
  await page.screenshot({ path: info.outputPath('compact-screen.png'), fullPage: true, animations: 'disabled' });
  harness.state.events = [event('context', { rank: 5, state: 'final', scores: [28, 21] })];
  await page.clock.fastForward(31_000);
  await expect(screen.locator('.mh-state')).toHaveText('Final');
  await expect(screen.locator('.drive, .possession')).toHaveCount(0);
  await expect(screen).not.toContainText('Earlier upset watch');
  await expect(screen.locator('.upset-badge, .upset-reason')).toHaveCount(0);
  // Keyboard Back, then touch reopens it.
  await screen.getByRole('button', { name: /^Back to scores/ }).focus(); await page.keyboard.press('Enter');
  await expect(screen).toHaveCount(0);
  await expect(row.locator('.game-status')).toHaveText('Final');
  await expect(summary).toBeFocused();
  await expect(summary).not.toContainText('Earlier upset watch');
  await expect(summary.locator('.compact-upset')).toHaveCount(0);
  await summary.tap(); await expect(screen).toBeVisible();
});

test('focused links open only visible games, once, and opening bell does not enable notifications', async ({ page, harness }) => {
  await harness.open({ path: '/?date=2026-09-05#game-ranked-live', waitForScores: false });
  await expect(page.locator('.game-screen h1.game-title')).toContainText('ranked-live away');
  await page.goBack();
  await expect(page.locator('.game-screen')).toHaveCount(0);
  // Back lands on the notification card as it was scrolled into view.
  const landing = await page.locator('#game-ranked-live a.game-summary').boundingBox();
  const tabs = await page.locator('.filter-tabs').boundingBox();
  expect(landing.y).toBeGreaterThanOrEqual(tabs.y + tabs.height);
  expect(landing.y + landing.height).toBeLessThan(844);
  await page.clock.fastForward(31_000);
  await expect(page.locator('.game-screen')).toHaveCount(0);
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


test('a legacy update link opens its game once while hidden Duke focus stays protected', async ({ page, harness }) => {
  // ORD-019 hides only a started game with Duke as the confirmed away team. event() is live and
  // started but omits neutralSite (unknown venue, which stays visible), so confirm the venue here.
  const duke = event('duke-hidden', { acc: true });
  duke.competitions[0].neutralSite = false;
  duke.competitions[0].competitors[0].team.id = '150';
  duke.competitions[0].competitors[0].team.shortDisplayName = 'Duke';
  harness.state.events.push(duke);
  // A 1.14.0 update URL (no _ss_open) opens its focused game once, as it used to expand.
  await harness.open({ path: '/?date=2026-09-05&_ss_update=' + 'a'.repeat(40) + '&_ss_hide_finals=0&_ss_focus=ranked-live', waitForScores: false });
  await expect(page.locator('.game-screen h1.game-title')).toContainText('ranked-live away');
  expect(page.url()).not.toContain('_ss_');
  await page.goto('/?date=2026-09-05#game-duke-hidden');
  await expect(page.getByRole('button', { name: 'Refresh scores' })).toBeEnabled();
  await expect(page.locator('#game-duke-hidden')).toHaveCount(0);
  await page.clock.fastForward(1_000);
  await expect(page.locator('.game-screen')).toHaveCount(0);
  // The same protected game by direct link is the generic screen.
  await page.goto('/?date=2026-09-05&event=duke-hidden');
  await expect(page.locator('.game-screen').getByRole('heading', { name: 'This game isn’t available' })).toBeVisible();
  await expect(page.locator('.game-screen')).not.toContainText('Duke');
  await page.goto('/?date=2026-09-05');
  await expect(page.getByRole('button', { name: 'Refresh scores' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Show Duke game on Sep 5', exact: true })).toBeVisible();
  // The hash focus never opened it: protection comes from the automatic started-away decision.
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('ss:duke-visibility:v2'))?.remembered)).toEqual({ 'duke-hidden': true });
});

test('delayed state remains visible and full explanation is disclosed', async ({ page, harness }) => {
  const delayed = event('paused', { rank: 5 });
  delayed.status.type = { name: 'STATUS_DELAYED', state: 'in', completed: false, shortDetail: 'Delayed' };
  harness.state.events = [delayed];
  await harness.open();
  const row = page.locator('#game-paused');
  await expect(row.locator('.game-status')).toHaveText('Delayed');
  await row.locator('a.game-summary').tap();
  await expect(page.locator('.game-screen .delay-note')).toHaveText('Play paused. Watching for an update.');
  await expect(page.locator('.game-screen .mh-state')).toContainText('Delayed');
});


test('score change feedback remains on summary scores and honors reduced motion', async ({ page, harness }) => {
  await harness.open({ path: '/?date=2026-09-05' });
  harness.state.events[0].competitions[0].competitors[0].score = '17';
  await page.getByRole('button', { name: 'Refresh scores' }).tap();
  const changed = page.locator('#game-ranked-live a.game-summary .score-changed').first();
  await expect(changed).toHaveText('17');
  expect(await changed.evaluate(el => getComputedStyle(el).animationName)).toBe('score-flash');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await changed.evaluate(el => getComputedStyle(el).animationName)).toBe('none');
});
