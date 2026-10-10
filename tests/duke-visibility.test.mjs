import test from 'node:test';
import assert from 'node:assert/strict';
import { bundle, game, scoreboard } from './helpers.mjs';
const v = await bundle('lib/duke-visibility.ts');
const { viewGames } = await bundle('lib/scoreboard-views.ts');
const { guideBoard } = await bundle('lib/guide.ts');
const { conditions, transitions } = await bundle('services/alerts/rules.ts');
const { normalizeScoreboard } = await bundle('lib/espn-data.ts');
function duke(side = 0, changes = {}) { const g = game(changes); g.teams[side].id = '150'; g.teams[side].conferenceId = '1'; return g; }
// The helper's game() is live and started with unknown venue; every case states both explicitly.
// Scheduled kickoff 2026-09-05T20:00Z has passed in every "past" case; only play status may matter.
const statuses = {
 upcoming:{state:'upcoming',started:false,period:0,date:'2026-09-12T20:00Z'},
 'past kickoff, still scheduled':{state:'upcoming',started:false,period:0},
 'delayed before play':{state:'delayed',started:false,period:0},
 'delayed after play started':{state:'delayed',started:true,period:2},
 'live 0-0 at period 0':{state:'live',started:false,period:0},
 live:{state:'live',started:true,period:4},
 final:{state:'final',started:true,period:4},
 'postponed without start evidence':{state:'other',started:false,period:0},
};
const startedStatuses = ['delayed after play started','live 0-0 at period 0','live','final'];
const venues = {
 home:[1,{neutralSite:false}], away:[0,{neutralSite:false}],
 'neutral, listed away':[0,{neutralSite:true}], 'neutral, listed home':[1,{neutralSite:true}],
 'unknown venue, listed away':[0,{}], 'malformed venue, listed away':[0,{neutralSite:'false'}],
};
function fixture(venue, status, changes = {}) { const [side, extra] = venues[venue]; const g = duke(side, { date:'2026-09-05T20:00Z', ...extra, ...statuses[status], ...changes }); if (!g.started) for (const t of g.teams) t.score = 0; return g; }
test('ORD-019 automatic default hides only confirmed away games once play has started', () => {
  const p = v.defaultDukePreferences();
  for (const venue of Object.keys(venues)) for (const status of Object.keys(statuses)) {
    const g = fixture(venue, status), hidden = venue === 'away' && startedStatuses.includes(status);
    assert.equal(v.dukeStarted(g), startedStatuses.includes(status), `${status} started`);
    assert.equal(v.dukeHidden(g,p), hidden, `${venue}, ${status}`);
    // Only started games with a known venue are remembered, and as the automatic decision. A game
    // not yet started records only that it was seen waiting, never a decision.
    const remembered = v.rememberDukeGames(p,[g]);
    if (startedStatuses.includes(status) && typeof g.neutralSite === 'boolean') assert.deepEqual([remembered.remembered,remembered.waiting], [{ game1: hidden },{}], `${venue}, ${status} remembered`);
    else if (startedStatuses.includes(status)) assert.equal(remembered, p, `${venue}, ${status} not remembered`);
    else assert.deepEqual([remembered.remembered,remembered.waiting], [{},{ game1: 1 }], `${venue}, ${status} only seen waiting`);
    assert.equal(v.dukeHidden(g,remembered), hidden, `${venue}, ${status} after remembering`);
  }
  // Hydration stays hidden for Duke only.
  assert.equal(v.dukeHidden(fixture('home','upcoming'),null),true);
  assert.equal(v.dukeHidden(game(),null),false);
});
test('ORD-019 an away game stays visible through a delay, hides when play starts and stays protected', () => {
  let p = v.defaultDukePreferences();
  for (const status of ['upcoming','past kickoff, still scheduled','delayed before play']) {
    const g = fixture('away',status);
    p = v.rememberDukeGames(p,[g]);
    assert.equal(v.dukeHidden(g,p),false,status);
  }
  assert.deepEqual(p.remembered,{});
  p = v.rememberDukeGames(p,[fixture('away','live')]);
  assert.deepEqual(p.remembered,{game1:true});
  assert.equal(v.rememberDukeGames(p,[fixture('away','live')]),p);
  // A later status correction or default change cannot reveal the started result.
  p = v.changeDukeDefault(p,'show',Date.parse('2026-09-05T22:00Z'));
  for (const status of ['delayed before play','delayed after play started','final']) assert.equal(v.dukeHidden(fixture('away',status),p),true,status);
  p = v.parseDukePreferences(JSON.stringify(p));
  assert.equal(v.dukeHidden(fixture('away','final'),p),true);
  // Only the user's explicit reveal shows it; it beats the remembered decision.
  p.manual.game1 = false;
  assert.equal(v.dukeHidden(fixture('away','final'),p),false);
  // A home game remembered as visible stays visible after a later Always hide.
  let home = v.rememberDukeGames(v.defaultDukePreferences(),[fixture('home','live')]);
  home = v.changeDukeDefault(home,'hide',Date.parse('2026-09-05T22:00Z'));
  assert.equal(v.dukeHidden(fixture('home','final'),home),false);
});
test('Always hide and Always show cover every venue and state; newest mode until play starts, kickoff mode after', () => {
  const always = mode => ({ version:2, rules:[{from:0,mode}], manual:{}, remembered:{}, waiting:{} });
  for (const venue of Object.keys(venues)) for (const status of Object.keys(statuses)) {
    assert.equal(v.dukeHidden(fixture(venue,status),always('hide')),true,`hide ${venue}, ${status}`);
    assert.equal(v.dukeHidden(fixture(venue,status),always('show')),false,`show ${venue}, ${status}`);
    assert.equal(v.rememberDukeGames(always('hide'),[fixture(venue,status)]).remembered.game1 ?? 'none', startedStatuses.includes(status) && typeof venues[venue][1].neutralSite === 'boolean' ? true : 'none');
  }
  // Changed after the scheduled kickoff of a delayed game: the newest default governs it before play.
  const afterKickoff = Date.parse('2026-09-05T21:00Z');
  let p = v.changeDukeDefault(v.defaultDukePreferences(),'hide',afterKickoff);
  assert.equal(v.dukeHidden(fixture('home','delayed before play'),p),true);
  p = v.changeDukeDefault(p,'away',afterKickoff + 60000);
  assert.equal(v.dukeHidden(fixture('home','delayed before play'),p),false);
  // Started games use the default in effect at kickoff, including games this device never loaded.
  p = v.changeDukeDefault(v.defaultDukePreferences(),'show',afterKickoff);
  assert.equal(v.dukeHidden(fixture('away','final'),p),true);
  assert.equal(v.dukeHidden(fixture('away','live',{id:'later',date:'2026-09-12T20:00Z'}),p),false);
  const history = { version:2, rules:[{from:0,mode:'show'},{from:afterKickoff,mode:'hide'}], manual:{}, remembered:{}, waiting:{} };
  assert.equal(v.dukeHidden(fixture('away','final'),history),false);
  assert.equal(v.dukeHidden(fixture('home','live',{id:'later',date:'2026-09-12T20:00Z'}),history),true);
});
// The hook's setMode order: freeze started games, change the default, then observe waiting games again.
const choose = (p, mode, now, games) => v.rememberDukeGames(v.changeDukeDefault(v.rememberDukeGames(p,games),mode,now),games);
test('ORD-019 a default chosen while a seen game waits past kickoff survives live, final and reload', () => {
  const afterKickoff = Date.parse('2026-09-05T21:00Z');
  for (const [venue, mode, hidden] of [['home','hide',true],['away','show',false],['neutral, listed away','hide',true],['unknown venue, listed away','hide',true]]) {
    let p = v.rememberDukeGames(v.defaultDukePreferences(),[fixture(venue,'delayed before play')]);
    assert.deepEqual(p.waiting,{game1:1},venue);
    p = choose(p,mode,afterKickoff,[fixture(venue,'delayed before play')]);
    assert.deepEqual([p.waiting,p.remembered],[{game1:2},{}],`${venue}: nothing frozen before play`);
    assert.equal(v.dukeHidden(fixture(venue,'delayed before play'),p),hidden,`${venue} ${mode} delayed`);
    for (const status of ['live 0-0 at period 0','live','final']) {
      p = v.parseDukePreferences(JSON.stringify(v.rememberDukeGames(p,[fixture(venue,status)])));
      assert.equal(v.dukeHidden(fixture(venue,status),p),hidden,`${venue} ${mode} ${status}`);
    }
    // Known venues freeze the chosen default at start; a later default change cannot undo it.
    if (typeof venues[venue][1].neutralSite === 'boolean') assert.deepEqual(p.remembered,{game1:hidden},venue);
    p = v.changeDukeDefault(p,mode==='hide'?'show':'hide',afterKickoff+3600000);
    assert.equal(v.dukeHidden(fixture(venue,'final'),p),hidden,`${venue} after a later change`);
  }
  // Switching back while still waiting applies the newest choice, not the first one.
  let p = v.rememberDukeGames(v.defaultDukePreferences(),[fixture('away','delayed before play')]);
  p = choose(p,'show',afterKickoff,[fixture('away','delayed before play')]);
  p = choose(p,'away',afterKickoff+60000,[fixture('away','delayed before play')]);
  assert.equal(v.dukeHidden(fixture('away','live'),v.rememberDukeGames(p,[fixture('away','live')])),true);
});
test('ORD-019 games never seen waiting keep kickoff history, including changes made while they were not loaded', () => {
  const afterKickoff = Date.parse('2026-09-05T21:00Z');
  // Never loaded before it started: the default at scheduled kickoff applies.
  for (const [venue, mode, hidden] of [['away','show',true],['home','hide',false]]) {
    const p = choose(v.defaultDukePreferences(),mode,afterKickoff,[]);
    assert.deepEqual(p.waiting,{});
    assert.equal(v.dukeHidden(fixture(venue,'final'),p),hidden,`${venue} unseen`);
    assert.deepEqual(v.rememberDukeGames(p,[fixture(venue,'final')]).remembered,{game1:hidden});
  }
  // Seen waiting earlier, but the default changed while the game was not loaded: still protected.
  let p = v.rememberDukeGames(v.defaultDukePreferences(),[fixture('away','delayed before play')]);
  p = choose(p,'show',afterKickoff,[game({id:'other'})]);
  assert.deepEqual(p.waiting,{game1:1});
  assert.equal(v.dukeHidden(fixture('away','live'),p),true);
  // A default chosen before scheduled kickoff applies whether or not the game was seen.
  p = choose(v.defaultDukePreferences(),'show',Date.parse('2026-09-05T19:00Z'),[]);
  assert.equal(v.dukeHidden(fixture('away','live'),p),false);
  // Started with no usable kickoff time and never seen waiting: fail closed.
  assert.equal(v.dukeHidden(fixture('home','live',{date:'not a date'}),v.defaultDukePreferences()),true);
  assert.equal(v.dukeHidden(fixture('home','live',{date:'not a date'}),{...v.defaultDukePreferences(),waiting:{game1:1}}),false);
});
test('manual choices survive final, rescheduling, serialization and default changes for their own event only', () => {
  let p = v.defaultDukePreferences(); p.manual.game1 = false; p.manual.home = true;
  p = v.parseDukePreferences(JSON.stringify(p));
  p = v.changeDukeDefault(p,'hide',Date.parse('2026-09-05T21:00Z'));
  assert.equal(v.dukeHidden(fixture('away','final',{date:'2026-09-20T01:00Z'}),p),false);
  assert.equal(v.dukeHidden(fixture('away','upcoming',{id:'home'}),v.changeDukeDefault(p,'show',Date.parse('2026-09-06T00:00Z'))),true);
  assert.equal(v.dukeHidden(fixture('away','live',{id:'next',date:'2026-09-12T20:00Z'}),p),true);
  // Remembering never overwrites a manual choice and records only the automatic decision.
  const remembered = v.rememberDukeGames(p,[fixture('away','live')]);
  assert.deepEqual(remembered.manual,{game1:false,home:true});
  assert.equal(v.dukeHidden(fixture('away','live'),remembered),false);
});
test('v1 preferences migrate once: the default timeline is kept and ambiguous per-game values are cleared', () => {
  const rules = [{from:0,mode:'away'},{from:Date.parse('2026-09-12T20:00Z'),mode:'show'}];
  const migrated = v.migrateLegacyDukePreferences(JSON.stringify({version:1,rules,overrides:{game1:false,other:true}}));
  assert.deepEqual(migrated,{prefs:{version:2,rules,manual:{},remembered:{},waiting:{}},corrupted:false,cleared:2});
  assert.deepEqual(v.decodeDukePreferences(JSON.stringify(migrated.prefs)),{prefs:migrated.prefs,corrupted:false});
  assert.deepEqual(v.migrateLegacyDukePreferences(null),{prefs:v.defaultDukePreferences(),corrupted:false,cleared:0});
  assert.equal(v.migrateLegacyDukePreferences(JSON.stringify({version:1,rules:[{from:0,mode:'hide'}],overrides:{}})).prefs.rules[0].mode,'hide');
  // The v2 reader never accepts the v1 shape, so an existing v2 value is the only one read.
  assert.equal(v.decodeDukePreferences(JSON.stringify({version:1,rules,overrides:{}})).corrupted,true);
});
test('malformed v1 and v2 preferences fail closed',()=>{
  const home = fixture('home','upcoming');
  const v1 = ['broken','{}','null',JSON.stringify({version:1,rules:[{from:0,mode:'show'}],overrides:{game1:'false'}}),JSON.stringify({version:1,rules:[{from:5,mode:'show'}],overrides:{}}),JSON.stringify({version:2,rules:[{from:0,mode:'show'}],manual:{},remembered:{}})];
  for(const raw of v1){ const m = v.migrateLegacyDukePreferences(raw); assert.equal(m.corrupted,true,raw); assert.equal(m.cleared,0); assert.equal(v.dukeHidden(home,m.prefs),true,raw); }
  const good = {version:2,rules:[{from:0,mode:'show'}],manual:{},remembered:{},waiting:{}};
  const v2 = ['broken','{}','null',JSON.stringify({...good,manual:{game1:'false'}}),JSON.stringify({...good,remembered:[]}),JSON.stringify({...good,remembered:undefined}),JSON.stringify({...good,rules:[{from:0,mode:'away'},{from:-1,mode:'show'}]}),JSON.stringify({...good,manual:{'bad id':true}}),
   JSON.stringify({...good,waiting:undefined}),JSON.stringify({...good,waiting:{game1:0}}),JSON.stringify({...good,waiting:{game1:2}}),JSON.stringify({...good,waiting:{game1:'1'}}),JSON.stringify({...good,waiting:{game1:1.5}}),JSON.stringify({...good,waiting:[1]})];
  for(const raw of v2){ assert.equal(v.decodeDukePreferences(raw).corrupted,true,raw); assert.equal(v.dukeHidden(home,v.parseDukePreferences(raw)),true,raw); }
  assert.equal(v.dukeHidden(home,v.parseDukePreferences(JSON.stringify(good))),false);
  const seen = {...good,rules:[...good.rules,{from:5,mode:'hide'}],waiting:{game1:2}};
  assert.deepEqual(v.decodeDukePreferences(JSON.stringify(seen)),{prefs:seen,corrupted:false});
});
test('ORD-010/019 hiding wins over pinning, hash focus, all categories and Guide bounds while shown records remain',()=>{
 const d=duke(0,{date:'2026-09-05T13:00Z',neutralSite:false}),other=game({id:'other'}),p=v.defaultDukePreferences();
 for(const games of [[d,other],[other,d]]){
  const raw=scoreboard(games),safe=v.protectDukeBoard(raw,p);
  assert.deepEqual(safe.games.map(g=>g.id),['other']);assert.equal(safe.games[0].teams[0].record,'0-0');assert.equal(other.teams[0].record,'0-0');
  for(const filter of [[],['acc'],['top25'],['close'],['upset'],['acc','top25','close','upset']]) assert.equal(viewGames(safe,filter,false,d.id).some(g=>g.id===d.id),false);
  assert.equal(guideBoard(safe,'all').allCount,1);assert.equal(guideBoard(safe,'all').start,guideBoard(scoreboard([other]),'all').start);
  // Before play starts the same away game is listed, counted, focusable and in Guide.
  const pregame={...d,state:'upcoming',started:false,period:0,teams:d.teams.map(t=>({...t,score:0}))};
  const shown=v.protectDukeBoard(scoreboard(games.map(g=>g===d?pregame:g)),p);
  assert.deepEqual(viewGames(shown,[]).map(g=>g.id),['other',d.id]);
  assert.deepEqual(viewGames(shown,['acc']).map(g=>g.id),[d.id]);
  assert.equal(viewGames(shown,[],false,d.id).some(g=>g.id===d.id),true);
  assert.equal(guideBoard(shown,'all').allCount,2);assert.equal(guideBoard(shown,'all').start,Date.parse('2026-09-05T13:00Z'));
 }
 const home=duke(1,{id:'duke-home',neutralSite:false});home.teams[1].record='2-1';
 assert.equal(v.protectDukeBoard(scoreboard([home]),p).games[0].teams[1].record,'2-1');
});
test('no Duke triggers or transition events in either participant position, including kickoff and final',()=>{
 for(const side of [0,1])for(const state of ['live','upcoming','final','delayed']){
  const g=duke(side,{state,date:'2026-09-05T20:05Z'}),now=Date.parse('2026-09-05T20:00Z');
  g.teams[0].rank=5;g.teams[0].score=7;g.teams[1].rank=null;g.teams[1].score=14;
  assert.equal(Object.values(conditions(g,now)).some(Boolean),false);
  assert.deepEqual(transitions({game:{...g,state:'upcoming'},observedAt:now-1000},g,now),[]);
 }
 assert.ok(Object.values(conditions(game(),Date.now())).some(Boolean));
});
test('normalization preserves neutral-site false/true and treats malformed or absent metadata as unknown',()=>{
 for(const neutralSite of [true,false,undefined,'false']) for(const dukeSide of [0,1]) for(const status of [{type:{name:'STATUS_SCHEDULED',state:'pre'}},{period:0,type:{name:'STATUS_DELAYED',state:'pre'}},{period:0,type:{name:'STATUS_IN_PROGRESS',state:'in'}},{period:4,type:{name:'STATUS_FINAL',state:'post',completed:true}}]){
  const raw={events:[{id:'test',date:'2026-09-05T20:00Z',status,competitions:[{neutralSite,competitors:['away','home'].map((homeAway,i)=>({id:String(i),homeAway,score:'0',team:{id:i===dukeSide?'150':'x'}}))}]}]};
  const g=normalizeScoreboard(raw,'2026-09-05').games[0];
  assert.equal(g.neutralSite,typeof neutralSite==='boolean'?neutralSite:undefined);
  // Only a confirmed away game hides, and only once ESPN reports play under way or finished.
  assert.equal(v.dukeHidden(g,v.defaultDukePreferences()),neutralSite===false&&dukeSide===0&&/IN_PROGRESS|FINAL/.test(status.type.name),`${neutralSite} ${dukeSide} ${status.type.name}`);
 }
});

test('already-queued Duke notifications are suppressed before delivery claims',async()=>{
 const { database } = await import('./helpers.mjs');const { deliver } = await bundle('services/alerts/worker.ts');
 const {db,sqlite}=database();const now=Date.parse('2026-09-05T20:00Z');
 sqlite.prepare('INSERT INTO subscriptions VALUES(?,?,?,?,?,?,?,?,?)').run('device','https://fcm.googleapis.com/test','test','test','owner',1,1,1,1);
 sqlite.prepare('INSERT INTO alert_events VALUES(?,?,?,?,?,?)').run('game1:one-score-fourth','game1','one-score-fourth','2026-09-05',now-1000,'{}');
 const original=globalThis.fetch;globalThis.fetch=()=>{throw Error('No Duke push may be attempted');};
 try{
  assert.equal(sqlite.prepare("SELECT value FROM poll_state WHERE id='preferences_delivery_enabled'").get().value,1);
  assert.ok(sqlite.prepare("SELECT value FROM poll_state WHERE id='preferences_epoch'").get().value<now-1000);
  assert.equal(sqlite.prepare("SELECT close_game FROM subscription_settings WHERE subscription_id='device'").get().close_game,1);
  await deliver({DB:db},now,[duke()]);assert.equal(sqlite.prepare('SELECT count(*) AS n FROM deliveries').get().n,0);
  // Same subscription/event becomes claimable for a non-Duke matchup. Invalid test keys prevent transport.
  await deliver({DB:db},now,[game()]);assert.equal(sqlite.prepare('SELECT count(*) AS n FROM deliveries').get().n,1);
 }finally{globalThis.fetch=original;sqlite.close();}
});

test('TBD placeholder dates do not pin games or prevent a new future default',()=>{
 const g=duke(0,{started:false,state:'upcoming',timeValid:false,date:'2026-09-05T00:00Z'}),now=Date.parse('2026-09-05T18:00Z');
 const p=v.defaultDukePreferences(),seen=v.rememberDukeGames(p,[g]);assert.deepEqual([seen.remembered,seen.waiting],[{},{game1:1}]);
 assert.equal(v.dukeHidden(g,v.changeDukeDefault(p,'show',now)),false);
 assert.equal(v.decodeDukePreferences('corrupted').corrupted,true);
 assert.equal(v.decodeDukePreferences(null).corrupted,false);
});
