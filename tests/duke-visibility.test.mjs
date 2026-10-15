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
 halftime:{state:'live',started:true,period:2,clock:0,intermission:true,halftime:true},
 overtime:{state:'live',started:true,period:5},
 final:{state:'final',started:true,period:4},
 'postponed without start evidence':{state:'other',started:false,period:0},
 'called off after play started':{state:'other',started:true,period:2},
};
const startedStatuses = ['delayed after play started','live 0-0 at period 0','live','halftime','overtime','final','called off after play started'];
// ORD-020: play under way means live, including halftime and overtime, or paused after it started.
const underwayStatuses = ['delayed after play started','live 0-0 at period 0','live','halftime','overtime'];
const venues = {
 home:[1,{neutralSite:false}], away:[0,{neutralSite:false}],
 'neutral, listed away':[0,{neutralSite:true}], 'neutral, listed home':[1,{neutralSite:true}],
 'unknown venue, listed away':[0,{}], 'malformed venue, listed away':[0,{neutralSite:'false'}],
};
function fixture(venue, status, changes = {}) { const [side, extra] = venues[venue]; const g = duke(side, { date:'2026-09-05T20:00Z', ...extra, ...statuses[status], ...changes }); if (!g.started) for (const t of g.teams) t.score = 0; return g; }
test('ORD-020 automatic default hides only confirmed away games while play is under way', () => {
  const p = v.defaultDukePreferences();
  for (const venue of Object.keys(venues)) for (const status of Object.keys(statuses)) {
    const g = fixture(venue, status), hidden = venue === 'away' && underwayStatuses.includes(status);
    assert.equal(v.dukeStarted(g), startedStatuses.includes(status), `${status} started`);
    assert.equal(v.dukeHidden(g,p), hidden, `${venue}, ${status}`);
    // Only started games with a known venue are marked as seen started. A game not yet started
    // records only that it was seen waiting, never a decision.
    const remembered = v.rememberDukeGames(p,[g]);
    if (startedStatuses.includes(status) && typeof g.neutralSite === 'boolean') assert.deepEqual([remembered.remembered,remembered.waiting], [{ game1: hidden },{}], `${venue}, ${status} remembered`);
    else if (startedStatuses.includes(status)) assert.equal(remembered, p, `${venue}, ${status} not remembered`);
    else assert.deepEqual([remembered.remembered,remembered.waiting], [{},{ game1: 1 }], `${venue}, ${status} only seen waiting`);
    assert.equal(v.dukeHidden(g,remembered), hidden, `${venue}, ${status} after remembering`);
    // A saved entry's true/false never decides visibility. Only its presence counts: a game this device
    // saw start stays protected if a status correction reports a delay without start evidence.
    for (const value of [true,false]) assert.equal(v.dukeHidden(g,{...p,remembered:{game1:value}}), venue === 'away' && (underwayStatuses.includes(status) || status === 'delayed before play'), `${venue}, ${status}, saved ${value}`);
  }
  // Hydration stays hidden for Duke only.
  assert.equal(v.dukeHidden(fixture('home','upcoming'),null),true);
  assert.equal(v.dukeHidden(game(),null),false);
});
test('ORD-020 an away game stays visible through a delay, hides while played and shows again at the final', () => {
  let p = v.defaultDukePreferences();
  for (const status of ['upcoming','past kickoff, still scheduled','delayed before play']) {
    const g = fixture('away',status);
    p = v.rememberDukeGames(p,[g]);
    assert.equal(v.dukeHidden(g,p),false,status);
  }
  assert.deepEqual(p.remembered,{});
  for (const status of underwayStatuses) assert.equal(v.dukeHidden(fixture('away',status),p),true,status);
  p = v.rememberDukeGames(p,[fixture('away','live')]);
  assert.deepEqual(p.remembered,{game1:true});
  assert.equal(v.rememberDukeGames(p,[fixture('away','live')]),p);
  // A later default change or a status correction back to a delay cannot reveal play in progress.
  p = v.changeDukeDefault(p,'show',Date.parse('2026-09-05T22:00Z'));
  for (const status of ['delayed before play','delayed after play started','live']) assert.equal(v.dukeHidden(fixture('away',status),p),true,status);
  // The correction neither records the seen-started game as waiting nor moves it to the newer default.
  assert.equal(v.rememberDukeGames(p,[fixture('away','delayed before play')]),p);
  // The final, or a call-off, shows it again under the automatic setting, including after reload.
  p = v.parseDukePreferences(JSON.stringify(p));
  for (const status of ['final','called off after play started','postponed without start evidence']) assert.equal(v.dukeHidden(fixture('away',status),p),false,status);
  // The user's own choices win in every state: a hide persists after the final, a reveal shows play.
  p.manual.game1 = true;
  for (const status of Object.keys(statuses)) assert.equal(v.dukeHidden(fixture('away',status),p),true,`manual hide ${status}`);
  p.manual.game1 = false;
  assert.equal(v.dukeHidden(fixture('away','live'),p),false);
  // A home game seen started under the automatic setting stays visible after a later Always hide.
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
  assert.equal(v.dukeHidden(fixture('away','live'),p),true);
  assert.equal(v.dukeHidden(fixture('away','final'),p),false,'the automatic kickoff default shows the final (ORD-020)');
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
  // Under that automatic default, an away game is hidden while played and shown at the final (ORD-020).
  for (const [venue, mode, live] of [['away','show',true],['home','hide',false]]) {
    const p = choose(v.defaultDukePreferences(),mode,afterKickoff,[]);
    assert.deepEqual(p.waiting,{});
    assert.equal(v.dukeHidden(fixture(venue,'live'),p),live,`${venue} unseen live`);
    assert.equal(v.dukeHidden(fixture(venue,'final'),p),false,`${venue} unseen final`);
    assert.deepEqual(v.rememberDukeGames(p,[fixture(venue,'live')]).remembered,{game1:live});
  }
  // Seen waiting earlier, but the default changed while the game was not loaded: still protected.
  let p = v.rememberDukeGames(v.defaultDukePreferences(),[fixture('away','delayed before play')]);
  p = choose(p,'show',afterKickoff,[game({id:'other'})]);
  assert.deepEqual(p.waiting,{game1:1});
  assert.equal(v.dukeHidden(fixture('away','live'),p),true);
  // A default chosen before scheduled kickoff applies whether or not the game was seen.
  p = choose(v.defaultDukePreferences(),'show',Date.parse('2026-09-05T19:00Z'),[]);
  assert.equal(v.dukeHidden(fixture('away','live'),p),false);
  // Started with no usable kickoff time and never seen waiting: the automatic setting applies unless the
  // user has chosen Always hide at some point (ORD-020). Normalized ESPN feeds drop events without a date.
  assert.equal(v.dukeHidden(fixture('home','live',{date:'not a date'}),v.defaultDukePreferences()),false);
  assert.equal(v.dukeHidden(fixture('away','live',{date:'not a date'}),v.defaultDukePreferences()),true);
  assert.equal(v.dukeHidden(fixture('home','live',{date:'not a date'}),v.changeDukeDefault(v.changeDukeDefault(v.defaultDukePreferences(),'hide',1),'show',2)),true);
  assert.equal(v.dukeHidden(fixture('home','live',{date:'not a date'}),{...v.defaultDukePreferences(),waiting:{game1:1}}),false);
});
// Review of the issue #155 plan: a game seen under an explicit Always hide must keep it when ESPN later
// reports a delay with the period and score evidence gone, even after a newer default was chosen.
test('ORD-020 a default in effect when this device saw play start survives a status correction and later defaults', () => {
  const beforeKickoff = Date.parse('2026-09-05T19:00Z'), afterKickoff = Date.parse('2026-09-05T22:00Z');
  for (const venue of ['home','away']) {
    let p = v.changeDukeDefault(v.defaultDukePreferences(),'hide',beforeKickoff);
    p = v.rememberDukeGames(p,[fixture(venue,'live')]);
    assert.deepEqual([p.remembered,p.waiting],[{game1:true},{}],venue);
    p = choose(p,'show',afterKickoff,[fixture(venue,'live')]);
    for (const status of ['delayed before play','live','final','called off after play started']) {
      p = v.parseDukePreferences(JSON.stringify(v.rememberDukeGames(p,[fixture(venue,status)])));
      assert.equal(v.dukeHidden(fixture(venue,status),p),true,`${venue} ${status}`);
      // Presence, not the saved value, keeps the kickoff rule.
      assert.equal(v.dukeHidden(fixture(venue,status),{...p,remembered:{game1:false}}),true,`${venue} ${status} saved false`);
    }
    // The correction was never recorded as waiting, so it cannot adopt Always show later.
    assert.deepEqual(p.waiting,{},venue);
    p.manual.game1 = false;
    assert.equal(v.dukeHidden(fixture(venue,'final'),p),false,`${venue} shown by the user`);
  }
});
test('manual choices survive final, rescheduling, serialization and default changes for their own event only', () => {
  let p = v.defaultDukePreferences(); p.manual.game1 = false; p.manual.home = true;
  p = v.parseDukePreferences(JSON.stringify(p));
  p = v.changeDukeDefault(p,'hide',Date.parse('2026-09-05T21:00Z'));
  assert.equal(v.dukeHidden(fixture('away','final',{date:'2026-09-20T01:00Z'}),p),false);
  assert.equal(v.dukeHidden(fixture('away','upcoming',{id:'home'}),v.changeDukeDefault(p,'show',Date.parse('2026-09-06T00:00Z'))),true);
  assert.equal(v.dukeHidden(fixture('away','live',{id:'next',date:'2026-09-12T20:00Z'}),p),true);
  // A game the user hid stays hidden after the final or a call-off, whatever the venue (ORD-020).
  for (const status of ['final','called off after play started']) assert.equal(v.dukeHidden(fixture('home',status,{id:'home'}),p),true,status);
  // Remembering never overwrites a manual choice and records only the automatic decision.
  const remembered = v.rememberDukeGames(p,[fixture('away','live')]);
  assert.deepEqual(remembered.manual,{game1:false,home:true});
  assert.equal(v.dukeHidden(fixture('away','live'),remembered),false);
});
test('v1 preferences migrate once: the default timeline is kept and ambiguous per-game values are cleared', () => {
  const rules = [{from:0,mode:'away'},{from:Date.parse('2026-09-12T20:00Z'),mode:'show'}];
  const migrated = v.migrateLegacyDukePreferences(JSON.stringify({version:1,rules,overrides:{game1:false,other:true}}));
  assert.deepEqual(migrated,{prefs:{version:2,rules,manual:{},remembered:{},waiting:{}},corrupted:false,cleared:2,repaired:false});
  assert.deepEqual(v.decodeDukePreferences(JSON.stringify(migrated.prefs)),{prefs:migrated.prefs,corrupted:false,repaired:false});
  assert.deepEqual(v.migrateLegacyDukePreferences(null),{prefs:v.defaultDukePreferences(),corrupted:false,cleared:0,repaired:false});
  // ORD-020: a first rule of Always hide was only ever the damaged-data fallback. It is repaired; later choices stay.
  const fallback = v.migrateLegacyDukePreferences(JSON.stringify({version:1,rules:[{from:0,mode:'hide'},rules[1]],overrides:{}}));
  assert.deepEqual([fallback.prefs.rules,fallback.corrupted,fallback.cleared,fallback.repaired],[[{from:0,mode:'away'},rules[1]],false,0,true]);
  // The v2 reader never accepts the v1 shape, so an existing v2 value is the only one read.
  assert.equal(v.decodeDukePreferences(JSON.stringify({version:1,rules,overrides:{}})).corrupted,true);
});
// ORD-020 supersedes the fail-closed Always hide: damaged data uses the automatic setting, flagged for a warning.
test('malformed v1 and v2 preferences are flagged and use the automatic setting, never a global hide',()=>{
  const automatic = (prefs, raw) => {
    assert.deepEqual(prefs,v.defaultDukePreferences(),raw);
    for (const status of Object.keys(statuses)) assert.equal(v.dukeHidden(fixture('home',status),prefs),false,`${raw}: home ${status}`);
    assert.equal(v.dukeHidden(fixture('away','live'),prefs),true,`${raw}: away live`);
    assert.equal(v.dukeHidden(fixture('away','final'),prefs),false,`${raw}: away final`);
  };
  const v1 =['broken','{}','null',JSON.stringify({version:1,rules:[{from:0,mode:'show'}],overrides:{game1:'false'}}),JSON.stringify({version:1,rules:[{from:5,mode:'show'}],overrides:{}}),JSON.stringify({version:2,rules:[{from:0,mode:'show'}],manual:{},remembered:{}})];
  for(const raw of v1){ const m = v.migrateLegacyDukePreferences(raw); assert.equal(m.corrupted,true,raw); assert.equal(m.cleared,0); assert.equal(m.repaired,false); automatic(m.prefs,raw); }
  const good = {version:2,rules:[{from:0,mode:'show'}],manual:{},remembered:{},waiting:{}};
  const v2 = ['broken','{}','null',JSON.stringify({...good,manual:{game1:'false'}}),JSON.stringify({...good,remembered:[]}),JSON.stringify({...good,remembered:undefined}),JSON.stringify({...good,rules:[{from:0,mode:'away'},{from:-1,mode:'show'}]}),JSON.stringify({...good,manual:{'bad id':true}}),
   JSON.stringify({...good,waiting:undefined}),JSON.stringify({...good,waiting:{game1:0}}),JSON.stringify({...good,waiting:{game1:2}}),JSON.stringify({...good,waiting:{game1:'1'}}),JSON.stringify({...good,waiting:{game1:1.5}}),JSON.stringify({...good,waiting:[1]})];
  for(const raw of v2){ assert.equal(v.decodeDukePreferences(raw).corrupted,true,raw); assert.equal(v.decodeDukePreferences(raw).repaired,false,raw); automatic(v.parseDukePreferences(raw),raw); }
  assert.equal(v.dukeHidden(fixture('home','upcoming'),v.parseDukePreferences(JSON.stringify(good))),false);
  const seen = {...good,rules:[...good.rules,{from:5,mode:'hide'}],waiting:{game1:2}};
  assert.deepEqual(v.decodeDukePreferences(JSON.stringify(seen)),{prefs:seen,corrupted:false,repaired:false});
});
test('ORD-020 a saved first rule of Always hide is the damaged-data fallback and is repaired without losing choices',()=>{
  const later = Date.parse('2026-09-06T12:00Z');
  for (const rest of [[],[{from:later,mode:'show'}],[{from:later,mode:'hide'}],[{from:later,mode:'away'},{from:later+1,mode:'hide'}]]) {
    const saved = {version:2,rules:[{from:0,mode:'hide'},...rest],manual:{kept:true,shown:false},remembered:{game1:true,home:false},waiting:{waiting:rest.length+1,early:1}};
    const decoded = v.decodeDukePreferences(JSON.stringify(saved));
    // Only the first rule changes: every timestamped rule, per-game choice, saved entry and waiting count stays.
    assert.deepEqual(decoded,{prefs:{...saved,rules:[{from:0,mode:'away'},...rest]},corrupted:false,repaired:true});
    assert.deepEqual(v.decodeDukePreferences(JSON.stringify(decoded.prefs)),{prefs:decoded.prefs,corrupted:false,repaired:false},'idempotent');
  }
  // Home games governed by the repaired baseline are visible in every state; a per-game hide stays.
  const p = v.parseDukePreferences(JSON.stringify({version:2,rules:[{from:0,mode:'hide'},{from:later,mode:'away'}],manual:{kept:true},remembered:{game1:true},waiting:{}}));
  for (const status of Object.keys(statuses)) {
    assert.equal(v.dukeHidden(fixture('home',status),p),false,`home ${status}`);
    assert.equal(v.dukeHidden(fixture('home',status,{id:'kept'}),p),true,`hidden by the user, ${status}`);
  }
  // A deliberate Always hide is always a later, timestamped rule, so it is not repaired and stays in force.
  const deliberate = v.decodeDukePreferences(JSON.stringify(v.changeDukeDefault(v.defaultDukePreferences(),'hide',Date.parse('2026-09-01T00:00Z'))));
  assert.equal(deliberate.repaired,false);
  for (const status of Object.keys(statuses)) assert.equal(v.dukeHidden(fixture('home',status),deliberate.prefs),true,`deliberate hide ${status}`);
  assert.equal(v.decodeDukePreferences(JSON.stringify(v.defaultDukePreferences())).repaired,false);
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
  // ORD-020: at the final it is listed, counted, focusable and in Guide again.
  const ended=v.protectDukeBoard(scoreboard(games.map(g=>g===d?{...d,state:'final'}:g)),p);
  assert.deepEqual(viewGames(ended,['acc']).map(g=>g.id),[d.id]);
  assert.equal(viewGames(ended,[],false,d.id).some(g=>g.id===d.id),true);
  assert.equal(guideBoard(ended,'all').allCount,2);
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
 // [ESPN status, play under way]: scores stay 0-0, so only the period is start evidence.
 const espn=[[{type:{name:'STATUS_SCHEDULED',state:'pre'}},false],[{period:0,type:{name:'STATUS_DELAYED',state:'pre'}},false],[{period:0,type:{name:'STATUS_IN_PROGRESS',state:'in'}},true],
  [{period:2,type:{name:'STATUS_HALFTIME',state:'in'}},true],[{period:3,type:{name:'STATUS_DELAYED',state:'in'}},true],[{period:4,type:{name:'STATUS_FINAL',state:'post',completed:true}},false],[{period:2,type:{name:'STATUS_POSTPONED',state:'post'}},false]];
 for(const neutralSite of [true,false,undefined,'false']) for(const dukeSide of [0,1]) for(const [status,underway] of espn){
  const raw={events:[{id:'test',date:'2026-09-05T20:00Z',status,competitions:[{neutralSite,competitors:['away','home'].map((homeAway,i)=>({id:String(i),homeAway,score:'0',team:{id:i===dukeSide?'150':'x'}}))}]}]};
  const g=normalizeScoreboard(raw,'2026-09-05').games[0];
  assert.equal(g.neutralSite,typeof neutralSite==='boolean'?neutralSite:undefined);
  // Only a confirmed away game hides, and only while ESPN reports play under way (ORD-020).
  assert.equal(v.dukeHidden(g,v.defaultDukePreferences()),neutralSite===false&&dukeSide===0&&underway,`${neutralSite} ${dukeSide} ${status.type.name}`);
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
