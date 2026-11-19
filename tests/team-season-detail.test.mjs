import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bundle } from './helpers.mjs';

const { seasonDetails } = await bundle('lib/team-season-server.ts');
const { parseTeamSeason, parseSeasonDetails } = await bundle('lib/team-season.ts');
const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/espn-team-season-detail-${name}-2026.json`, import.meta.url), 'utf8'));
const TEXAS = fixture('texas'), UNC = fixture('unc');
const CHECKED = '2026-11-19T20:22:17.000Z';
const expected = (year, made, thrown, sacksMade, sacksAllowed, offense, allowed) => ({ year, seasonType: 2, checkedAt: CHECKED, interceptionsMade: made, interceptionsThrown: thrown, sacksMade, sacksAllowed, thirdDown: { offense: { converted: offense[0], attempted: offense[1] }, allowed: { converted: allowed[0], attempted: allowed[1] } } });
const categories = (raw, opponent = false) => opponent ? raw.results.opponent : raw.results.stats.categories;
const category = (raw, name, opponent = false) => categories(raw, opponent).find(c => c.name === name);
const stat = (raw, cat, name, opponent = false) => category(raw, cat, opponent).stats.find(s => s.name === name);

test('genuine November19 regular-season detail has verified direction and count/rate bases for both teams', () => {
  assert.deepEqual(seasonDetails(TEXAS, '251', 2026, CHECKED), expected(2026, 9, 10, 30, 30, [57, 141], [51, 154]));
  assert.deepEqual(seasonDetails(UNC, '153', 2026, CHECKED), expected(2026, 7, 7, 19, 26, [58, 125], [65, 149]));
  // UNC's unequal sacks, and Texas's unequal interceptions, distinguish made from suffered.
  const d = seasonDetails(UNC, '153', 2026, CHECKED);
  assert.equal((d.thirdDown.offense.converted / d.thirdDown.offense.attempted * 100).toFixed(1), '46.4');
  assert.equal((d.thirdDown.allowed.converted / d.thirdDown.allowed.attempted * 100).toFixed(1), '43.6');
  assert.ok(!JSON.stringify(d).match(/fumble|takeaway|giveaway|turnover/i));
});
test('SYNTHETIC wrong status/team/source year/requested year/type rejects only optional detail', () => {
  for (const change of [r => r.status = 'error', r => r.team.id = '251', r => r.season.year = 2025, r => r.requestedSeason.year = 2025, r => r.season.type = 3, r => r.requestedSeason.type = 3]) {
    const raw = structuredClone(UNC); change(raw); assert.equal(seasonDetails(raw, '153', 2026, CHECKED), null);
  }
});
test('SYNTHETIC missing counterpart preserves scoped own count; conflicting or malformed supplied reciprocal withholds only affected field', () => {
  const missing = structuredClone(UNC);
  category(missing, 'passing', true).stats = category(missing, 'passing', true).stats.filter(s => s.name !== 'sacks');
  assert.equal(seasonDetails(missing, '153', 2026, CHECKED).sacksMade, 19);
  const conflict = structuredClone(UNC); Object.assign(stat(conflict, 'passing', 'sacks', true), { value: 20, displayValue: '20' });
  const d = seasonDetails(conflict, '153', 2026, CHECKED);
  assert.equal(d.sacksMade, null); assert.equal(d.sacksAllowed, 26); assert.deepEqual(d.thirdDown.offense, { converted: 58, attempted: 125 });
  stat(conflict, 'passing', 'sacks', true).value = null;
  assert.equal(seasonDetails(conflict, '153', 2026, CHECKED).sacksMade, null);
});
test('SYNTHETIC malformed count/display/category/stat duplicates fail independently and legitimate zero survives', () => {
  for (const bad of [-1, .5, NaN, Infinity, '7', 10_001]) {
    const raw = structuredClone(UNC); stat(raw, 'passing', 'interceptions').value = bad;
    const d = seasonDetails(raw, '153', 2026, CHECKED); assert.equal(d.interceptionsThrown, null); assert.equal(d.sacksMade, 19);
  }
  const raw = structuredClone(UNC); stat(raw, 'passing', 'interceptions').displayValue = '8';
  assert.equal(seasonDetails(raw, '153', 2026, CHECKED).interceptionsThrown, null);
  const duplicate = structuredClone(UNC); category(duplicate, 'passing').stats.push({ ...stat(duplicate, 'passing', 'interceptions') });
  assert.equal(seasonDetails(duplicate, '153', 2026, CHECKED).interceptionsThrown, 7);
  category(duplicate, 'passing').stats.at(-1).value = 8;
  assert.equal(seasonDetails(duplicate, '153', 2026, CHECKED).interceptionsThrown, null);
  const duplicateCategory = structuredClone(UNC); categories(duplicateCategory).push(structuredClone(category(duplicateCategory, 'defensive')));
  assert.equal(seasonDetails(duplicateCategory, '153', 2026, CHECKED).sacksMade, null);
  const zero = structuredClone(UNC);
  for (const [cat, opponent] of [['defensiveInterceptions', false], ['passing', true]]) Object.assign(stat(zero, cat, 'interceptions', opponent), { value: 0, displayValue: '0' });
  assert.equal(seasonDetails(zero, '153', 2026, CHECKED).interceptionsMade, 0);
});
test('SYNTHETIC conversion arithmetic and supplied percent disagreement fail by side; zero attempts retain counts, not a rate', () => {
  const invalid = structuredClone(UNC); Object.assign(stat(invalid, 'miscellaneous', 'thirdDownConvs'), { value: 126, displayValue: '126' });
  const a = seasonDetails(invalid, '153', 2026, CHECKED); assert.equal(a.thirdDown.offense, null); assert.deepEqual(a.thirdDown.allowed, { converted: 65, attempted: 149 });
  for (const n of [60, -1, 101, NaN]) {
    const raw = structuredClone(UNC); Object.assign(stat(raw, 'miscellaneous', 'thirdDownConvPct'), { value: n, displayValue: String(n) });
    assert.equal(seasonDetails(raw, '153', 2026, CHECKED).thirdDown.offense, null);
  }
  const missingPercent = structuredClone(UNC); category(missingPercent, 'miscellaneous').stats = category(missingPercent, 'miscellaneous').stats.filter(s => s.name !== 'thirdDownConvPct');
  assert.deepEqual(seasonDetails(missingPercent, '153', 2026, CHECKED).thirdDown.offense, { converted: 58, attempted: 125 });
  const zero = structuredClone(UNC);
  for (const name of ['thirdDownConvs', 'thirdDownAttempts', 'thirdDownConvPct']) Object.assign(stat(zero, 'miscellaneous', name), { value: 0, displayValue: '0' });
  assert.deepEqual(seasonDetails(zero, '153', 2026, CHECKED).thirdDown.offense, { converted: 0, attempted: 0 });
});
test('client validates optional detail independently by identity and field without discarding original v1 season', () => {
  // SYNTHETIC transport envelope: genuine new detail with a deliberately empty complete schedule.
  const details = seasonDetails(UNC, '153', 2026, CHECKED);
  const base = { v: 1, team: { id: '153', name: 'North Carolina Tar Heels', shortName: 'North Carolina', abbreviation: 'UNC', logo: null }, season: { year: 2026 }, record: '5-5', stats: null, regular: { status: 'complete', entries: [] }, postseason: { status: 'complete', entries: [] }, checkedAt: CHECKED };
  assert.equal(parseTeamSeason(base, '153').details, null, 'old v1 response remains usable');
  for (const invalid of [null, [], 'wrong', { ...details, year: 2025 }, { ...details, seasonType: 3 }, { ...details, checkedAt: 'unknown' }]) {
    const parsed = parseTeamSeason({ ...base, details: invalid }, '153'); assert.equal(parsed.record, '5-5'); assert.equal(parsed.details, null);
  }
  assert.deepEqual(parseTeamSeason({ ...base, details }, '153').details, details);
  const invalid = structuredClone(details); invalid.sacksMade = -1; invalid.interceptionsMade = '7'; invalid.thirdDown.offense.converted = 126;
  const d = parseTeamSeason({ ...base, details: invalid }, '153').details;
  assert.equal(d.sacksMade, null); assert.equal(d.interceptionsMade, null); assert.equal(d.thirdDown.offense, null); assert.equal(d.sacksAllowed, 26); assert.deepEqual(d.thirdDown.allowed, { converted: 65, attempted: 149 });
  assert.equal(parseSeasonDetails({}, 2026), null);
});
