import { test, expect, event, expectCount } from './fixtures.mjs';
const KEY='ss:duke-visibility:v2', LEGACY='ss:duke-visibility:v1';
function duke(id, home=false, neutral=false, date='2026-09-05T23:30:00Z'){
 const g=event(id,{acc:true,date});g.competitions[0].neutralSite=neutral;
 const t=g.competitions[0].competitors[home?1:0].team;t.id='150';t.shortDisplayName='Duke';t.abbreviation='DUKE';return g;
}
// event() has no delayed option. These synthetic ESPN statuses cover a delay before play and a 0-0
// in-progress game at period 0, which the parser does not count as started.
const statuses={
 scheduled:['STATUS_SCHEDULED','pre',0,[0,0],'Scheduled'],
 delayed:['STATUS_DELAYED','pre',0,[0,0],'Delayed'],
 kickoff:['STATUS_IN_PROGRESS','in',0,[0,0],'15:00 - 1st'],
 final:['STATUS_FINAL','post',4,[24,17],'Final'],
};
function play(g,kind){
 const [name,state,period,scores,shortDetail]=statuses[kind];
 g.status={period,clock:0,type:{name,state,completed:state==='post',shortDetail}};
 g.competitions[0].competitors.forEach((c,i)=>{c.score=String(scores[i]);});
 return g;
}
const stored=async(page,key=KEY)=>JSON.parse(await page.evaluate(k=>localStorage.getItem(k),key));
const NOTICE='Your earlier hide and show choices for individual Duke games were cleared';
const REPAIR='An earlier storage fallback was set to Always hide. It has been corrected to Hide away games during play.';
test('Duke reveal is per-game, persisted, shared with Guide and never bypassed by focus',async({page,harness})=>{
 const hidden=duke('duke-away'),ordinary=event('ordinary',{acc:true});
 for(const team of hidden.competitions[0].competitors)team.records=[{type:'total',summary:'2-1'}];
 for(const team of ordinary.competitions[0].competitors)team.records=[{type:'total',summary:'3-1'}];
 harness.state.events=[hidden,ordinary];
 await harness.open({path:'/?date=2026-09-05#game-duke-away'});
 await expect(page.locator('#game-duke-away')).toHaveCount(0);
 await expect(page.locator('#game-ordinary .team-record')).toHaveText(['3-1','3-1']);
 await page.getByRole('button',{name:'Show Duke game on Sep 5',exact:true}).click();
 await expect(page.getByRole('alertdialog')).toContainText('Show this game only?');
 await page.getByRole('button',{name:'Keep hidden',exact:true}).click();
 await expect(page.locator('#game-duke-away')).toHaveCount(0);
 await page.getByRole('button',{name:'Show Duke game on Sep 5',exact:true}).click();
 await page.getByRole('button',{name:'Show this game only',exact:true}).click();
 await expect(page.locator('#game-duke-away')).toBeVisible();
 await expect(page.locator('#game-duke-away .team-record')).toHaveText(['2-1','2-1']);
 // Revealing never opened it: the hidden game's link was not consumed by the reveal.
 await expect(page.locator('.game-screen')).toHaveCount(0);
 // Reloading the still-unconsumed notification link now opens the revealed game once.
 await page.reload();await expect(page.locator('.game-screen h1.game-title')).toContainText('Duke');
 await page.goBack();await expect(page.locator('#game-duke-away')).toBeVisible();
 await page.getByRole('link',{name:'Guide',exact:true}).click();
 await expect(page.locator('.guide-game[data-game="duke-away"]')).toBeVisible();
 await page.getByRole('button',{name:'Hide Duke game on Sep 5',exact:true}).click();
 await expect(page.locator('.guide-game[data-game="duke-away"]')).toHaveCount(0);
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await page.getByRole('radio',{name:'Always show',exact:true}).check();
 await expect(page.getByRole('dialog',{name:'Settings',exact:true})).toContainText('Always off, even when you show a game.');
 await page.getByRole('button',{name:'Close',exact:true}).click();
 await expect(page.locator('.guide-game[data-game="duke-away"]')).toHaveCount(0);
 await page.reload();await expect(page.getByRole('button',{name:'Show Duke game on Sep 5',exact:true})).toBeVisible();
});
test('ORD-020 an away game stays listed past a delayed kickoff, hides everywhere while in progress and returns at the final',async({page,harness})=>{
 // The scheduled kickoff (4 p.m. Eastern) passed hours before the harness clock.
 const away=play(duke('duke-away',false,false,'2026-09-05T20:00:00Z'),'scheduled'),ordinary=event('ordinary',{acc:true});
 harness.state.events=[away,ordinary];
 await harness.open({path:'/?date=2026-09-05#game-duke-away',waitForScores:false});
 const refresh=page.getByRole('button',{name:'Refresh scores',exact:true});
 // A visible game's notification link opens its screen once; Back returns to the scoreboard.
 await expect(page.locator('.game-screen h1.game-title')).toContainText('Duke');
 await page.goBack();
 await expect(page.locator('.game-screen')).toHaveCount(0);
 await expect(page.locator('#game-duke-away')).toBeVisible();
 // The ordinary game is live; the scheduled, then pregame-delayed, Duke game counts only in the total.
 await expectCount(page,'All',1,2);await expectCount(page,'ACC',1,2);
 play(away,'delayed');await refresh.click();
 await expect(page.locator('#game-duke-away .game-status')).toHaveText('Delayed');
 await expectCount(page,'All',1,2);await expectCount(page,'ACC',1,2);
 await page.getByRole('link',{name:'Guide',exact:true}).click();
 await expect(page.locator('.guide-game[data-game="duke-away"]')).toBeVisible();
 // Before play only the waiting observation is saved; no decision is frozen.
 await expect.poll(()=>stored(page)).toEqual({version:2,rules:[{from:0,mode:'away'}],manual:{},remembered:{},waiting:{'duke-away':1}});
 play(away,'kickoff');await page.getByRole('button',{name:'Refresh guide',exact:true}).click();
 await expect(page.locator('.guide-game[data-game="duke-away"]')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Show Duke game on Sep 5',exact:true})).toBeVisible();
 await expect.poll(async()=>(await stored(page))?.remembered).toEqual({'duke-away':true});
 await page.goto('/?date=2026-09-05#game-duke-away');await expect(refresh).toBeEnabled();
 await expect(page.locator('#game-duke-away')).toHaveCount(0);
 // Hidden at kickoff: neither number includes the started Duke game.
 await expectCount(page,'All',1,1);await expectCount(page,'ACC',1,1);
 // At the final the automatic setting lists and counts it again, through reload and in Guide.
 play(away,'final');play(ordinary,'final');await refresh.click();
 await expect(page.locator('#game-ordinary .game-status')).toHaveText('Final');
 await expect(page.locator('#game-duke-away .game-status')).toHaveText('Final');
 await expectCount(page,'All',0,2);await expectCount(page,'ACC',0,2);
 // The notification link loaded while the game was hidden was never consumed. Now that the final is
 // visible, reloading it opens the game once, as for a per-game reveal; Back returns to the board.
 await page.reload();
 await expect(page.locator('.game-screen h1.game-title')).toContainText('Duke');
 await expect(page.locator('.game-screen')).toContainText('Final');
 await page.goBack();await expect(refresh).toBeEnabled();
 await expect(page.locator('.game-screen')).toHaveCount(0);
 await expect(page.locator('#game-duke-away')).toBeVisible();
 await expect(page.getByRole('button',{name:'Hide Duke game on Sep 5',exact:true})).toBeVisible();
 await page.getByRole('link',{name:'Guide',exact:true}).click();
 await expect(page.locator('.guide-game[data-game="duke-away"]')).toBeVisible();
 // The saved entry only records that play was seen to start; its value is no longer read.
 expect(await stored(page)).toEqual({version:2,rules:[{from:0,mode:'away'}],manual:{},remembered:{'duke-away':true},waiting:{'duke-away':1}});
});

// Review R1: a default chosen while a listed game waits past its scheduled kickoff must survive the start.
for (const c of [{mode:'Always hide',id:'duke-home',home:true,hidden:true},{mode:'Always show',id:'duke-away',home:false,hidden:false}]) test(`ORD-019 ${c.mode} chosen during a delay before play holds through live, final and reload`,async({page,harness})=>{
 const g=play(duke(c.id,c.home,false,'2026-09-05T20:00:00Z'),'delayed'),ordinary=event('ordinary',{acc:true});
 harness.state.events=[g,ordinary];
 await harness.open({path:'/?date=2026-09-05'});
 const card=page.locator(`#game-${c.id}`),refresh=page.getByRole('button',{name:'Refresh scores',exact:true});
 const expectShown=async()=>{ if(c.hidden) await expect(card).toHaveCount(0); else await expect(card).toBeVisible(); };
 await expect(card).toBeVisible();
 await expect.poll(async()=>(await stored(page))?.waiting).toEqual({[c.id]:1});
 // The harness clock is hours past the scheduled kickoff, so kickoff-time history alone would ignore this choice.
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 const settings=page.getByRole('dialog',{name:'Settings',exact:true});
 await settings.getByRole('radio',{name:c.mode,exact:true}).check();
 await settings.getByRole('button',{name:'Close',exact:true}).click();
 await expectShown();
 await expect.poll(async()=>{const s=await stored(page);return [s.rules.length,s.waiting,s.remembered];}).toEqual([2,{[c.id]:2},{}]);
 play(g,'kickoff');await refresh.click();
 await expect.poll(async()=>(await stored(page)).remembered).toEqual({[c.id]:c.hidden});
 await expectShown();
 if(!c.hidden) await expect(card.locator('.game-status')).toHaveText('15:00 - 1st');
 play(g,'final');play(ordinary,'final');await refresh.click();
 await expect(page.locator('#game-ordinary .game-status')).toHaveText('Final');
 await expectShown();
 await page.reload();await expect(refresh).toBeEnabled();
 await expectShown();
 await page.getByRole('link',{name:'Guide',exact:true}).click();
 await expect(page.locator('.guide-game[data-game="ordinary"]')).toBeVisible();
 await expect(page.locator(`.guide-game[data-game="${c.id}"]`)).toHaveCount(c.hidden?0:1);
 expect((await stored(page)).manual).toEqual({});
});

test('home and neutral games stay visible once started, weekly controls identify separate events and phone header fits',async({page,harness})=>{
 // The neutral-site game lists Duke as the away team; only a confirmed away game is hidden.
 harness.state.events=[duke('duke-home',true),duke('duke-neutral',false,true,'2026-09-06T20:00:00Z')];
 await harness.open({path:'/?date=2026-09-05'});
 await expect(page.locator('#game-duke-home')).toBeVisible();
 await page.getByRole('button',{name:'Hide Duke game on Sep 5',exact:true}).click();
 await expect(page.locator('#game-duke-home')).toHaveCount(0);
 await page.getByRole('group',{name:'Scoreboard period'}).getByRole('button',{name:'Week',exact:true}).click();
 await page.getByRole('button',{name:/^ACC/}).click();
 await expect(page.getByRole('button',{name:'Hide Duke game on Sep 6',exact:true})).toBeVisible();
 await expect(page.locator('#game-duke-neutral')).toBeVisible();
 await expect.poll(async()=>(await stored(page))?.remembered).toEqual({'duke-home':false,'duke-neutral':false});
 expect((await stored(page)).manual).toEqual({'duke-home':true});
 await page.setViewportSize({width:320,height:740});
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Settings',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('saved v2 changes from another tab apply; v1 writes from an older tab are ignored',async({page,harness})=>{
 harness.state.events=[duke('duke-away'),duke('duke-home',true)];
 await harness.open({path:'/?date=2026-09-05'});
 const away=page.locator('#game-duke-away'),home=page.locator('#game-duke-home');
 await expect(away).toHaveCount(0);await expect(home).toBeVisible();
 await expect.poll(async()=>(await stored(page))?.remembered).toEqual({'duke-away':true,'duke-home':false});
 const before=await stored(page);
 // Synthetic storage events: the browser delivers these only to other tabs.
 const write=(key,value)=>page.evaluate(([key,value])=>{localStorage.setItem(key,value);dispatchEvent(new StorageEvent('storage',{key,newValue:value}));},[key,JSON.stringify(value)]);
 // An older tab's v1 write, with a reveal and Always show, then a whole-storage notification.
 await write(LEGACY,{version:1,rules:[{from:0,mode:'show'}],overrides:{'duke-away':false}});
 await page.evaluate(()=>dispatchEvent(new StorageEvent('storage',{key:null})));
 // Barrier: a later v2 write that hides the home game. Once it shows, every earlier event was handled.
 await write(KEY,{...before,manual:{'duke-home':true}});
 await expect(home).toHaveCount(0);
 await expect(away).toHaveCount(0);
 expect(await stored(page)).toEqual({...before,manual:{'duke-home':true}});
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 const settings=page.getByRole('dialog',{name:'Settings',exact:true});
 await expect(settings.getByRole('radio',{name:'Hide away games during play',exact:true})).toBeChecked();
 await expect(settings.getByText(NOTICE)).toHaveCount(0);
 await settings.getByRole('button',{name:'Close',exact:true}).click();
 // A v2 reveal from another tab applies.
 await write(KEY,{...before,manual:{'duke-home':true,'duke-away':false}});
 await expect(away).toBeVisible();await expect(home).toHaveCount(0);
});

test('v1 preferences migrate once with a Settings-only notice: synthetic baseline repaired, later default kept, per-game values cleared',async({page,harness})=>{
 // ORD-020: the v1 damaged-data fallback saved a first rule of Always hide; a later default is a deliberate choice.
 const rules=[{from:0,mode:'hide'},{from:Date.parse('2026-09-01T00:00:00Z'),mode:'away'}];
 harness.state.events=[duke('duke-away')];
 await page.addInitScript(([key,value])=>localStorage.setItem(key,value),[LEGACY,JSON.stringify({version:1,rules,overrides:{'duke-away':false,'older-game':true}})]);
 await page.setViewportSize({width:320,height:740});
 await harness.open({path:'/?date=2026-09-05'});
 // The earlier reveal was ambiguous in v1, so the away game in progress is protected again.
 await expect(page.locator('#game-duke-away')).toHaveCount(0);
 await expect(page.getByText(NOTICE)).toHaveCount(0);
 await expect(page.getByText(REPAIR)).toHaveCount(0);
 await expect.poll(()=>stored(page)).toEqual({version:2,rules:[{from:0,mode:'away'},rules[1]],manual:{},remembered:{'duke-away':true},waiting:{}});
 expect((await stored(page,LEGACY)).overrides).toEqual({'duke-away':false,'older-game':true});
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 const settings=page.getByRole('dialog',{name:'Settings',exact:true});
 await expect(settings.getByRole('status').filter({hasText:NOTICE})).toBeVisible();
 await expect(settings.getByRole('status').filter({hasText:REPAIR})).toContainText('Any later default you chose was kept.');
 await expect(settings.getByRole('radio',{name:'Hide away games during play',exact:true})).toBeChecked();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await settings.getByRole('button',{name:'Show Duke game on Sep 5',exact:true}).click();
 await expect(page.getByRole('alertdialog')).toContainText('Your default stays “Hide away games during play.”');
 await page.getByRole('button',{name:'Show this game only',exact:true}).click();
 await expect(settings.getByText(NOTICE)).toHaveCount(0);
 expect((await stored(page)).manual).toEqual({'duke-away':false});
 await page.getByRole('button',{name:'Close',exact:true}).click();
 await page.reload();await expect(page.locator('#game-duke-away')).toBeVisible();
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await expect(page.getByText(NOTICE)).toHaveCount(0);
});

// ORD-020: damaged data uses the automatic setting with a warning instead of hiding every Duke game. It
// stays as saved until the user chooses something; a per-game choice never saves a global hide.
const DAMAGED='Saved Duke preferences were damaged. Until you choose a setting, away Duke games are hidden during play and other Duke games are shown.';
test('damaged saved preferences explain the automatic fallback and stay unsaved until a choice',async({page,harness})=>{
 harness.state.events=[duke('duke-home',true),duke('duke-away')];
 await page.addInitScript(key=>localStorage.setItem(key,'broken'),LEGACY);
 await harness.open({path:'/?date=2026-09-05'});
 await expect(page.locator('#game-duke-home')).toBeVisible();
 await expect(page.locator('#game-duke-away')).toHaveCount(0);
 await expect(page.getByRole('alert')).toContainText(DAMAGED);
 // Startup observations do not overwrite the damaged data, including after a reload.
 await expect(page.getByRole('button',{name:'Show Duke game on Sep 5',exact:true})).toBeVisible();
 expect(await page.evaluate(([key,legacy])=>[localStorage.getItem(key),localStorage.getItem(legacy)],[KEY,LEGACY])).toEqual([null,'broken']);
 await page.reload();await expect(page.getByRole('button',{name:'Refresh scores',exact:true})).toBeEnabled();
 await expect(page.locator('#game-duke-home')).toBeVisible();
 await expect(page.getByRole('alert')).toContainText(DAMAGED);
 expect(await page.evaluate(key=>localStorage.getItem(key),KEY)).toBeNull();
 // A per-game hide saves only that choice over the automatic setting and clears the warning.
 await page.getByRole('button',{name:'Hide Duke game on Sep 5',exact:true}).click();
 await expect(page.locator('#game-duke-home')).toHaveCount(0);
 await expect(page.getByRole('alert')).toHaveCount(0);
 expect(await stored(page)).toEqual({version:2,rules:[{from:0,mode:'away'}],manual:{'duke-home':true},remembered:{'duke-home':false,'duke-away':true},waiting:{}});
});

test('damaged v2 preferences take precedence over a readable v1 and use the automatic setting',async({page,harness})=>{
 harness.state.events=[duke('duke-home',true),duke('duke-away')];
 await page.addInitScript(([key,legacy])=>{localStorage.setItem(key,'{"version":2}');localStorage.setItem(legacy,JSON.stringify({version:1,rules:[{from:0,mode:'show'}],overrides:{}}));},[KEY,LEGACY]);
 await harness.open({path:'/?date=2026-09-05'});
 await expect(page.locator('#game-duke-home')).toBeVisible();
 await expect(page.locator('#game-duke-away')).toHaveCount(0);
 await expect(page.getByRole('alert')).toContainText(DAMAGED);
 expect(await page.evaluate(key=>localStorage.getItem(key),KEY)).toBe('{"version":2}');
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 const settings=page.getByRole('dialog',{name:'Settings',exact:true});
 await expect(page.getByText(NOTICE)).toHaveCount(0);
 await expect(settings.getByRole('radio',{name:'Hide away games during play',exact:true})).toBeChecked();
 // An explicit default saves exactly that choice and clears the warning.
 await settings.getByRole('radio',{name:'Always hide',exact:true}).check();
 await expect.poll(async()=>(await stored(page))?.rules?.map(rule=>rule.mode)).toEqual(['away','hide']);
 await expect(page.getByRole('alert')).toHaveCount(0);
 expect((await stored(page)).manual).toEqual({});
});

test('unreadable storage uses the automatic setting for the visit without background saves',async({page,harness})=>{
 harness.state.events=[duke('duke-home',true),duke('duke-away')];
 // Simulated blocked storage for Duke preferences only; every save attempt is counted.
 await page.addInitScript(()=>{
  const get=Storage.prototype.getItem,set=Storage.prototype.setItem,duke=key=>String(key).startsWith('ss:duke-visibility');
  Storage.prototype.getItem=function(key){ if(duke(key)) throw new DOMException('blocked','SecurityError'); return get.call(this,key); };
  Storage.prototype.setItem=function(key,value){ if(duke(key)){ window.dukeWrites=(window.dukeWrites||0)+1; throw new DOMException('blocked','SecurityError'); } return set.call(this,key,value); };
 });
 await harness.open({path:'/?date=2026-09-05'});
 await expect(page.locator('#game-duke-home')).toBeVisible();
 await expect(page.locator('#game-duke-away')).toHaveCount(0);
 await expect(page.getByRole('alert')).toHaveText('Saved preferences are unavailable. Away Duke games are hidden during play, and choices apply for this visit only.');
 await expect(page.getByRole('button',{name:'Show Duke game on Sep 5',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>window.dukeWrites??0)).toBe(0);
 // An explicit choice still applies, and the warning says it could not be saved.
 await page.getByRole('button',{name:'Hide Duke game on Sep 5',exact:true}).click();
 await expect(page.locator('#game-duke-home')).toHaveCount(0);
 await expect(page.getByRole('alert')).toHaveText('Your choice applies for this visit only. This browser could not save it.');
 expect(await page.evaluate(()=>window.dukeWrites)).toBe(1);
});

// ORD-020: a 1.15.1 save whose first rule is the damaged-data fallback is repaired once. Every later rule,
// per-game choice, saved entry and waiting count stays; saved entries no longer decide visibility.
test('a saved synthetic Always hide baseline is repaired with a Settings-only notice, keeping every choice',async({page,harness})=>{
 // A later default chosen after every kickoff, so the synthetic first rule governs all three games before repair.
 const later=Date.parse('2026-09-06T03:00:00Z');
 const home=play(duke('duke-home',true),'final'),away=play(duke('duke-away',false,false,'2026-09-05T20:00:00Z'),'final'),manual=duke('duke-manual',true,false,'2026-09-05T22:00:00Z');
 harness.state.events=[home,away,manual];
 const seed={version:2,rules:[{from:0,mode:'hide'},{from:later,mode:'away'}],manual:{'duke-manual':true},remembered:{'duke-home':true,'duke-away':true,'duke-manual':true},waiting:{'duke-away':1}};
 // Seed only an empty store, so the reload below reads what the app saved.
 await page.addInitScript(([key,value])=>{ if(!localStorage.getItem(key)) localStorage.setItem(key,value); },[KEY,JSON.stringify(seed)]);
 await harness.open({path:'/?date=2026-09-05'});
 await expect(page.locator('#game-duke-home')).toBeVisible();
 await expect(page.locator('#game-duke-away')).toBeVisible();
 await expect(page.locator('#game-duke-manual')).toHaveCount(0);
 await expect(page.getByText(REPAIR)).toHaveCount(0);
 await expect.poll(()=>stored(page)).toEqual({...seed,rules:[{from:0,mode:'away'},seed.rules[1]]});
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 const settings=page.getByRole('dialog',{name:'Settings',exact:true});
 await expect(settings.getByRole('status').filter({hasText:REPAIR})).toHaveText(`${REPAIR} Any later default and per-game choices you made were kept.`);
 await expect(settings.getByRole('radio',{name:'Hide away games during play',exact:true})).toBeChecked();
 await settings.getByRole('button',{name:'Close',exact:true}).click();
 // The repair is saved once: a reload reads it as ordinary preferences, without the notice.
 await page.reload();await expect(page.getByRole('button',{name:'Refresh scores',exact:true})).toBeEnabled();
 await expect(page.locator('#game-duke-away')).toBeVisible();
 await expect(page.locator('#game-duke-manual')).toHaveCount(0);
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await expect(page.getByText(REPAIR)).toHaveCount(0);
 expect(await stored(page)).toEqual({...seed,rules:[{from:0,mode:'away'},seed.rules[1]]});
});
