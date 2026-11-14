import {readFileSync} from 'node:fs';
import {test,expect,NOW} from './fixtures.mjs';
import {cdnFeed} from '../helpers.mjs';
const fixture=JSON.parse(readFileSync(new URL('../fixtures/player-pages.json',import.meta.url),'utf8'));
const href=(id='4870906',year=2026,team='251')=>`/?player=${id}&playerTeam=${team}&anchorSeason=2026&season=${year}`;
function serve(harness){
 const state=harness.state;
 state.cdnFeed=cdnFeed(state.events); // Complete supported hidden-scoreboard fixture; no stopped fallback needed.
 state.player=async(url,route)=>{const key=url.searchParams.get('id')+':'+url.searchParams.get('year');const body=fixture.subjects[key];return route.fulfill({status:body?200:404,contentType:'application/json',body:JSON.stringify(body??{error:'simulated uncaptured year'})});};
 state.stats=async(url,route)=>{const body=fixture.games[url.searchParams.get('event')];return route.fulfill({status:body?200:503,contentType:'application/json',body:JSON.stringify(body??{error:'simulated missing game stats'})});};
}
async function muted(page){
 const result=await page.evaluate(()=>{
  const media=document.createElement('audio');media.muted=false;document.body.append(media);
  try {media.dispatchEvent(new Event('loadstart',{bubbles:true}));return media.muted;}
  finally {media.remove();}
 });
 expect(result,'the browser fixture mutes connected media before interaction').toBe(true);
}
async function settledFeed(page){await expect(page.locator('.feed-status')).toContainText('Updated');}
async function noOverflow(page){expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
test('real current categories/full log, explicit older/missing season, phone widths and large text',async({page,harness})=>{
 serve(harness);await harness.open({path:href(),now:NOW,clock:'date-only',waitForScores:false});await muted(page);
 await expect(page.locator('.player-title')).toHaveText('Arch Manning');await expect(page.locator('#player-season')).toHaveValue('2026');
 await expect(page.locator('.player-coverage')).toHaveText('Player statistics available for 9 of 9 completed team games.');
 await expect(page.locator('.player-log > li')).toHaveCount(12);await expect(page.locator('.player-block').first()).toContainText('2,027');await expect(page.locator('.player-block').first()).toContainText('110');
 await page.locator('#player-season').selectOption('2024');await expect(page.locator('.player-coverage')).toContainText('8 of 13');await expect(page.locator('.player-log > li')).toHaveCount(13);await expect(page.getByText('No player statistics supplied.',{exact:true})).toHaveCount(5);
 await page.locator('#player-season').selectOption('2023');await expect(page.getByText('2023 statistics couldn’t be loaded',{exact:true})).toBeVisible();await expect(page.locator('#player-season')).toHaveValue('2023');await expect(page.locator('.player-metrics')).toHaveCount(0);
 await page.locator('#player-season').selectOption('2024');await expect(page.locator('.player-title')).toHaveText('Arch Manning');
 for(const width of [320,390]){await page.setViewportSize({width,height:844});await noOverflow(page);}
 await page.evaluate(()=>{document.documentElement.style.fontSize='20px'});await noOverflow(page);
});
test('historical game outside board preserves year, section, Back row, direct link and reload',async({page,harness})=>{
 serve(harness);await harness.open({path:href('4870906',2024),now:NOW,clock:'date-only',waitForScores:false});await muted(page);await expect(page.locator('.player-title')).toHaveText('Arch Manning');
 const link=page.locator('.player-game-link[href*="event=401628331"]');await expect(link).toBeVisible();const target=await link.getAttribute('href');await link.click();
 await expect(page.locator('.game-title')).toBeVisible();await expect(page.locator('.back-text')).toContainText('2024 regular season');
 await page.getByRole('button',{name:'Player stats',exact:true}).click();await expect(page.locator('#panel-players')).toContainText('Arch Manning');
 await page.getByRole('button',{name:'Back to player, 2024 season'}).click();await expect(page.locator('#player-season')).toHaveValue('2024');await expect(page.locator('.player-game-link[href*="event=401628331"]')).toBeFocused();
 await settledFeed(page);await page.goto(target);await expect(page.locator('.game-title')).toBeVisible();
 await page.getByRole('button',{name:'Player stats',exact:true}).click();await expect(page.locator('#panel-players')).toContainText('Arch Manning');await settledFeed(page);
 await page.reload();await expect(page.locator('.back-text')).toContainText('2024 regular season');
 await page.getByRole('button',{name:'Player stats',exact:true}).click();await expect(page.locator('#panel-players')).toContainText('Arch Manning');await settledFeed(page);
 await page.getByRole('button',{name:'Back to player, 2024 season'}).click();await expect(page.locator('#player-season')).toHaveValue('2024');
});
test('transfer and FCS all categories/negative values/full lower-division game context',async({page,harness})=>{
 serve(harness);await harness.open({path:href('4592532',2025,'153'),now:NOW,clock:'date-only',waitForScores:false});await muted(page);await expect(page.locator('.player-meta')).toContainText('Wisconsin');await expect(page.locator('.player-coverage')).toContainText('2 of 12');await expect(page.locator('.player-log > li')).toHaveCount(12);
 await settledFeed(page);await page.goto(href('5164309',2026,'2193')+'&witnessTeam=153&witnessEvent=401858218');await expect(page.locator('.player-title')).toHaveText('Mason Mims');await expect(page.locator('.player-block').first()).toContainText('-87');await expect(page.locator('.player-category').filter({has:page.getByRole('heading',{name:'Receiving',exact:true})}).first()).toContainText('20');await expect(page.locator('.player-log')).toContainText('Tusculum');await expect(page.locator('.player-log > li')).toHaveCount(12);await noOverflow(page);
});
test('manual Duke hide withholds aggregates/row/link and direct game never loads stats',async({page,harness})=>{
 serve(harness);await page.addInitScript(()=>localStorage.setItem('ss:duke-visibility:v2',JSON.stringify({version:2,rules:[{from:0,mode:'away'}],manual:{'401858266':true},remembered:{},waiting:{}})));
 await harness.open({path:href('4592532',2026,'153'),now:NOW,clock:'date-only',waitForScores:false});await muted(page);await expect(page.getByText('Season statistics hidden',{exact:true})).toBeVisible();await expect(page.locator('.player-metrics')).toHaveCount(0);await expect(page.locator('.player-game-link[href*="401858266"]')).toHaveCount(0);await expect(page.locator('.player-log')).not.toContainText('Duke Blue Devils');
 await settledFeed(page);await page.goto('/?event=401858266&fromPlayer=4592532&playerTeam=153&anchorSeason=2026&playerSeason=2026');await expect(page.locator('.game-title')).toHaveText('Game unavailable');await expect(page.locator('.masthead')).toHaveCount(0);expect(harness.state.statsRequests.filter(s=>s.includes('401858266'))).toEqual([]);
});
