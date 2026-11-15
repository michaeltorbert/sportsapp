import { readFileSync } from 'node:fs';
import { test, expect, event } from './fixtures.mjs';
import { bundle } from '../helpers.mjs';
const { normalizeGameStats } = await bundle('lib/game-stats.ts');
const raw = JSON.parse(readFileSync(new URL('../fixtures/espn-summary-full-final.json',import.meta.url),'utf8'));
const captured = '2026-11-15T22:41:48.637Z';
// Captured real final statistics in a deterministic intercepted app scene, not a live/hosted witness.
async function openFull(page,harness) {
 const game=event('401856887',{state:'final',scores:[17,24],date:'2026-11-15T18:00:00Z'});
 game.competitions[0].competitors.forEach((c,i)=>{c.id=['145','201'][i];c.team.id=c.id;c.team.displayName=['Ole Miss','Oklahoma'][i];c.team.shortDisplayName=c.team.displayName;c.team.abbreviation=['MISS','OU'][i];});
 harness.state.events=[game];
 harness.state.stats=async(url,route)=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(normalizeGameStats(raw,raw.header.id,captured))});
 await harness.open({now:'2026-11-15T22:42:00Z'});
 await page.locator('#game-401856887 a.game-summary').click();
 await page.locator('.game-screen').getByRole('button',{name:'Player stats',exact:true}).click();
 await expect(page.locator('.game-screen #cat-passing')).toBeVisible();
}
const settled = page => page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
for(const [width,zoom] of [[320,false],[390,false],[390,true]]) {
 test(`actual-source full box score retains row identity and numbers at ${width}px${zoom?' CSSzoom200%':''}`,async({page,harness},info)=>{
  await page.setViewportSize({width,height:844});
  await page.emulateMedia({reducedMotion:'reduce'});
  await openFull(page,harness);
  if(zoom)await page.addStyleTag({content:'html { zoom: 2; }'});
  const select=page.getByRole('combobox',{name:'Category',exact:true});
  await expect(select.locator('option')).toHaveCount(10);
  expect((await select.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await expect(page.locator('.box-table tbody tr')).toHaveCount(74);
  await select.selectOption('defensive');await settled(page);
  await expect(page.locator('#cat-defensive-h')).toBeFocused();
  await expect(select).toHaveValue('defensive');
  const region=page.locator('#cat-defensive .box-table-wrap').first();
  await expect(region.locator('tbody tr')).toHaveCount(20);
  await expect(region.locator('tbody th').first()).toHaveText("Tah'j Butler");
  await expect(region.locator('tbody td').nth(2)).toHaveText('1.5');
  await expect(region.locator('thead')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath(`defense-${width}${zoom?'-zoom200':''}-start.png`),animations:'disabled'});
  await region.evaluate(el=>{el.scrollLeft=el.scrollWidth;});await settled(page);
  const geometry=await region.evaluate(el=>{
   const bounds=el.getBoundingClientRect(),name=el.querySelector('tbody th').getBoundingClientRect(),last=el.querySelector('tbody tr td:last-child').getBoundingClientRect();
   return{region:bounds.width,name:name.width,nameLeft:name.left,left:bounds.left,lastLeft:last.left,lastRight:last.right,right:bounds.right,scroll:el.scrollLeft};
  });
  expect(geometry.scroll).toBeGreaterThan(0);
  expect(geometry.name).toBeLessThanOrEqual(geometry.region*.46+1);
  expect(geometry.nameLeft).toBeGreaterThanOrEqual(geometry.left-1);
  expect(geometry.lastRight).toBeLessThanOrEqual(geometry.right+1);
  expect(geometry.lastLeft).toBeGreaterThan(geometry.nameLeft+geometry.name-1);
  await page.screenshot({path:info.outputPath(`defense-${width}${zoom?'-zoom200':''}-right.png`),animations:'disabled'});
  await select.selectOption('kicking');await settled(page);
  const oklahoma=page.locator('#cat-kicking .category-team').nth(1);
  await expect(oklahoma.locator('tbody td').nth(1)).toHaveText('33.0');
  await expect(oklahoma.locator('tfoot td').nth(1)).toHaveText('33.3');
  await page.screenshot({path:info.outputPath(`kicking-${width}${zoom?'-zoom200':''}.png`),animations:'disabled'});
  await select.selectOption('interceptions');await settled(page);
  await expect(page.locator('#cat-interceptions').getByText('No entries supplied.',{exact:true})).toHaveCount(2);
  await expect(page.locator('#cat-interceptions .player-table')).toHaveCount(0);
  await select.selectOption('punting');await settled(page);
  await expect(select).toHaveValue('punting');await expect(page.locator('#cat-punting-h')).toBeFocused();
  // Resize and a scoreboard poll preserve the selected section/category and source row document.
  await page.setViewportSize({width:width===320?390:320,height:844});await settled(page);
  await page.clock.fastForward(30_000);await settled(page);
  await expect(select).toHaveValue('punting');
  await expect(page.locator('#cat-punting-h')).toBeFocused();
  await expect(page.locator('.box-table tbody tr')).toHaveCount(74);
  await select.selectOption('defensive');await settled(page);
  await expect(page.locator('#cat-defensive-h')).toBeFocused();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  if(zoom)await expect.poll(()=>page.locator('.game-bar').evaluate(el=>getComputedStyle(el).position)).toBe('static');
 });
}

// Real wheel input in supported desktop contexts releases the menu jump intent.
// This is separate from mobile touch emulation, whose wheel behavior is not its input contract.
test.describe('category reading with a desktop pointer',()=>{
 test.use({isMobile:false,hasTouch:false,deviceScaleFactor:1});
 test('vertical reading resumes scroll-spy after a menu jump; passive resize preserves focus',async({page,harness})=>{
  await page.setViewportSize({width:390,height:844});
  await page.emulateMedia({reducedMotion:'reduce'});
  await openFull(page,harness);
  const select=page.getByRole('combobox',{name:'Category',exact:true});
  await select.selectOption('kicking');await settled(page);
  await expect(select).toHaveValue('kicking');
  await expect(page.locator('#cat-kicking-h')).toBeFocused();
  await page.mouse.move(200,600);
  await page.mouse.wheel(0,20000);
  await expect.poll(()=>page.evaluate(()=>innerHeight+scrollY>=document.documentElement.scrollHeight-3)).toBe(true);
  await expect(select).toHaveValue('punting');
  await page.mouse.wheel(0,-20000);
  await expect.poll(()=>page.evaluate(()=>scrollY)).toBe(0);
  await expect(select).toHaveValue('passing');
 });
});
