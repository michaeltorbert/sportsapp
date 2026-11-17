import { readFileSync } from 'node:fs';
import { test, expect } from './fixtures.mjs';
const fixture=year=>JSON.parse(readFileSync(new URL(`../fixtures/leaders-browser-${year}.json`,import.meta.url),'utf8'));
// Actual saved sports values; a coherent explicit Date-only test clock after both captures, never live proof.
const TEST_NOW='2026-11-17T02:32:00Z';
const snapshot=year=>{const f=fixture(year),s=structuredClone(f.snapshot);s.checkedAt=f.provenance.actualCaptureFinishedAt;s.privacy.checkedAt=fixture(2025).provenance.actualCaptureFinishedAt;return s;};
async function prepare(page,{prefs,unavailable=false}={}) {
  // Verify the existing test-scoped media muter on a blank document before any app navigation.
  await page.goto('about:blank');
  expect(await page.evaluate(()=>{const el=document.createElement('audio');el.dispatchEvent(new Event('loadstart',{bubbles:true}));document.body.append(el);el.dispatchEvent(new Event('loadstart',{bubbles:true}));const muted=el.muted;el.remove();return muted;})).toBe(true);
  if(prefs)await page.addInitScript(value=>localStorage.setItem('ss:duke-visibility:v2',JSON.stringify(value)),prefs);
  await page.route('**/api/leaders?**',route=>{const p=new URL(route.request().url()).searchParams;const query={year:Number(p.get('season')),category:p.get('category'),team:p.get('team'),conference:p.get('conference'),page:Number(p.get('page'))};return route.fulfill({status:unavailable?503:200,contentType:'application/json',body:JSON.stringify(unavailable?{error:'synthetic unavailable'}:{query,snapshot:snapshot(query.year)})});});
}
test('actual excerpts expose historical/conference/team filters, explicit empty intersection and refresh/back state',async({page,harness})=>{
 await prepare(page);await harness.open({path:'/leaders?season=2025&category=passing&conference=SEC&team=251&page=1',now:TEST_NOW,clock:'date-only',waitForScores:false});
 await expect(page.getByLabel('Season',{exact:true})).toHaveValue('2025');await expect(page.locator('.leaders-player').first()).toHaveText('Arch Manning');await expect(page.locator('.leaders-value').first()).toContainText('2,942');
 await page.getByLabel('Conference',{exact:true}).selectOption('ACC');await expect(page.getByRole('heading',{name:'No matching player totals'})).toBeVisible();await expect(page.getByLabel('Team',{exact:true})).toHaveValue('251');
 await page.goBack();await expect(page.getByLabel('Conference',{exact:true})).toHaveValue('SEC');await expect(page.locator('.leaders-player').first()).toHaveText('Arch Manning');
 await page.reload();await expect(page.getByLabel('Season',{exact:true})).toHaveValue('2025');await expect(page.locator('.leaders-value').first()).toContainText('2,942');
 await page.getByLabel('Team',{exact:true}).selectOption('326');await page.getByLabel('Conference',{exact:true}).selectOption('Sun Belt');await expect(page.locator('.leaders-row').first()).toBeVisible();
 await page.getByLabel('Season',{exact:true}).selectOption('2026');await expect(page.getByRole('heading',{name:'No matching player totals'})).toBeVisible();await expect(page.getByLabel('Conference',{exact:true})).toHaveValue('Sun Belt');await page.getByLabel('Conference',{exact:true}).selectOption('Pac-12');await expect(page.locator('.leaders-row').first()).toBeVisible();
 expect(harness.state.unexpectedExternal).toEqual([]);
});
test('real cross-year player team anchors and return context remain explicit; every category has rows',async({page,harness})=>{
 await prepare(page);
 // Name/selected team/season/YDS/current team come from the two actual category projections.
 // The one-game schedule below is explicitly SYNTHETIC to exercise the retained aggregate guard/UI,
 // not invented as an actual North Texas game log. Actual hosted selected-year acceptance remains separate.
 const actual=snapshot(2025),person=actual.tables.passing.find(r=>r.id==='5219834'&&r.team==='249');expect(person.name).toBe('Drew Mestemaker');expect(person.yards).toBe(4119);
 const side=(id,name)=>({id,name,abbreviation:'',logo:null,score:null,rank:null,record:'',conferenceId:null});
 const simulated={v:1,id:person.id,name:person.name,position:null,anchor:{team:'249',year:2025},year:2025,needsTeamChoice:false,team:{id:'249',name:'North Texas'},currentTeam:{id:'197',name:'Oklahoma State'},basis:'regular',checkedAt:actual.checkedAt,stale:false,choices:[{year:2026,teams:['Oklahoma State']},{year:2025,teams:['North Texas']}],totals:{passing:{YDS:person.yards}},scheduleComplete:true,totalsAvailable:true,historyAvailable:true,logs:[{game:{id:'900000001',date:'2025-09-01T16:00:00Z',timeValid:true,neutralSite:false,state:'final',status:'Synthetic completed test game',started:true,period:4,clock:0,teams:[side('99999','Synthetic test opponent'),side('249','North Texas')],broadcast:'',possession:null,downDistance:'',redZone:false,url:''},stats:{},boxSupplied:false}]};
 harness.state.player=(url,route)=>{const p=url.searchParams;expect(p.get('id')).toBe(person.id);expect(p.get('team')).toBe('249');expect(p.get('anchorYear')).toBe('2025');expect(p.get('year')).toBe('2025');return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(simulated)});};
 await harness.open({path:'/leaders?season=2025&category=passing&team=249&conference=American+Athletic&page=1',now:TEST_NOW,clock:'date-only',waitForScores:false});
 const player=page.getByRole('link',{name:'Drew Mestemaker',exact:true});await expect(player).toBeVisible();const link=new URL(await player.getAttribute('href'),page.url());expect(link.searchParams.get('playerTeam')).toBe('249');expect(link.searchParams.get('anchorSeason')).toBe('2025');expect(link.searchParams.get('season')).toBe('2025');expect(link.searchParams.get('leadersReturn')).toContain('conference=American+Athletic');
 await player.click();
 const populated=async()=>{await expect(page.locator('.player-title')).toHaveText(person.name);await expect(page.locator('.player-meta')).toContainText('North Texas');await expect(page.locator('#player-season')).toHaveValue('2025');await expect(page.getByRole('region',{name:'Passing season statistics'})).toContainText('4,119');};
 await populated();await expect.poll(()=>harness.state.playerRequests.length).toBeGreaterThan(0);await page.reload();await populated();await expect.poll(()=>harness.state.playerRequests.length).toBeGreaterThan(1);
 await expect(page.getByRole('link',{name:/Back to leaders · 2025/}).filter({visible:true}).first()).toBeVisible();await page.getByRole('link',{name:/Back to leaders · 2025/}).filter({visible:true}).first().click();await expect(page.getByLabel('Team',{exact:true})).toHaveValue('249');await expect(page.getByLabel('Season',{exact:true})).toHaveValue('2025');await expect(page.getByLabel('Conference',{exact:true})).toHaveValue('American Athletic');
 for(const name of ['Rushing','Receiving','Passing']) {await page.getByRole('button',{name,exact:true}).click();await expect(page.locator('.leaders-row').first()).toBeVisible();}
 expect(harness.state.playerRequests.every(q=>new URLSearchParams(q).get('year')==='2025')).toBe(true);
});
test('saved hidden Duke final removes both Duke and opponent before results and preserves preferences',async({page,harness})=>{
 const s=snapshot(2026), game=s.privacy.games.find(g=>g.state==='final'&&g.teams.some(t=>t.id==='153'))??s.privacy.games.find(g=>g.state==='final');
 const prefs={version:2,rules:[{from:0,mode:'away'}],manual:{[game.id]:true},remembered:{},waiting:{}};
 await prepare(page,{prefs});await harness.open({path:'/leaders?season=2026&category=rushing&team=150&conference=ACC&page=1',now:TEST_NOW,clock:'date-only',waitForScores:false});
 await expect(page.getByText('Teams affected by hidden Duke games are excluded.',{exact:false})).toBeVisible();await expect(page.locator('.leaders-row')).toHaveCount(0);await expect(page.getByText('Nate Sheppard',{exact:true})).toHaveCount(0);
 const after=await page.evaluate(()=>JSON.parse(localStorage.getItem('ss:duke-visibility:v2')));expect(after).toEqual(prefs);
});
test('unavailable/unsupported choices remain explicit and readable at phone widths',async({page,harness})=>{
 await prepare(page,{unavailable:true});await page.setViewportSize({width:320,height:844});await harness.open({path:'/leaders?season=2025&category=receiving&team=251&conference=SEC&page=1',now:TEST_NOW,clock:'date-only',waitForScores:false});
 await expect(page.getByRole('heading',{name:'Leaders are temporarily unavailable'})).toBeVisible();await expect(page.getByLabel('Season',{exact:true})).toHaveValue('2025');
 await page.goto('/leaders?season=2024&category=passing&team=251&conference=SEC&page=1');await expect(page.getByRole('heading',{name:'This selection isn’t supported'})).toBeVisible();await expect(page.getByLabel('Season',{exact:true})).toHaveValue('2024');expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(320);
});
