import test from 'node:test';
import assert from 'node:assert/strict';
import { bundle, game, scoreboard } from './helpers.mjs';
const v = await bundle('lib/duke-visibility.ts');
const { viewGames } = await bundle('lib/scoreboard-views.ts');
const { guideBoard } = await bundle('lib/guide.ts');
const { conditions, transitions } = await bundle('services/alerts/rules.ts');
const { normalizeScoreboard } = await bundle('lib/espn-data.ts');
function duke(side = 0, changes = {}) { const g = game(changes); g.teams[side].id = '150'; g.teams[side].conferenceId = '1'; return g; }
test('home requires affirmative non-neutral metadata; away, neutral, old cache and hydration stay hidden', () => {
  const p = v.defaultDukePreferences();
  assert.equal(v.dukeHidden(duke(1,{neutralSite:false}),p),false);
  for (const g of [duke(),duke(1),duke(1,{neutralSite:true}),duke(0,{neutralSite:false})]) assert.equal(v.dukeHidden(g,p),true);
  assert.equal(v.dukeHidden(duke(1,{neutralSite:false}),null),true);
  assert.equal(v.dukeHidden(game(),null),false);
});
test('explicit event overrides survive final, rescheduling and serialization without revealing next game', () => {
  let p = v.defaultDukePreferences(); p.overrides.game1 = false;
  p = v.parseDukePreferences(JSON.stringify(p));
  assert.equal(v.dukeHidden(duke(0,{state:'final',date:'2026-09-20T01:00Z'}),p),false);
  assert.equal(v.dukeHidden(duke(0,{id:'next'}),p),true);
  p.overrides.game1 = true;
  assert.equal(v.dukeHidden(duke(1,{neutralSite:false}),p),true);
});
test('future default changes preserve even unseen older games and explicit future choices', () => {
  const now=Date.parse('2026-09-12T20:00Z');
  let p=v.defaultDukePreferences();p.overrides.explicit=true;
  p=v.changeDukeDefault(p,'show',now);
  assert.equal(v.dukeHidden(duke(),p),true);
  assert.equal(v.dukeHidden(duke(0,{id:'future',date:'2026-09-19T20:00Z'}),p),false);
  assert.equal(v.dukeHidden(duke(0,{id:'explicit',date:'2026-09-19T20:00Z'}),p),true);
  const pinned=v.rememberDukeGames(p,[duke()],now);
  assert.equal(pinned.overrides.game1,true);
  assert.equal(v.rememberDukeGames(pinned,[duke()],now),pinned);
});
test('malformed saved preferences fail closed',()=>{
 for(const raw of ['broken','{}',JSON.stringify({version:1,rules:[{from:0,mode:'show'}],overrides:{game1:'false'}})]) assert.equal(v.dukeHidden(duke(1,{neutralSite:false}),v.parseDukePreferences(raw)),true);
});
test('ORD-010 hiding wins over pinning, hash focus, all categories, Guide bounds and record rendering',()=>{
 const d=duke(0,{date:'2026-09-05T13:00Z'}),other=game({id:'other'}),p=v.defaultDukePreferences();
 for(const games of [[d,other],[other,d]]){
  const raw=scoreboard(games),safe=v.protectDukeBoard(raw,p);
  assert.deepEqual(safe.games.map(g=>g.id),['other']);assert.equal(safe.games[0].teams[0].record,'');assert.equal(other.teams[0].record,'0-0');
  for(const filter of ['watch','acc','top25','close','upset']) assert.equal(viewGames(safe,filter,false,d.id).some(g=>g.id===d.id),false);
  assert.equal(guideBoard(safe,'all').allCount,1);assert.equal(guideBoard(safe,'all').start,guideBoard(scoreboard([other]),'all').start);
 }
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
 for(const neutralSite of [true,false,undefined,'false']){
  const raw={events:[{id:'test',date:'2026-09-05T20:00Z',status:{type:{name:'STATUS_SCHEDULED',state:'pre'}},competitions:[{neutralSite,competitors:['away','home'].map((homeAway,i)=>({id:String(i),homeAway,team:{id:i?'150':'x'}}))}]}]};
  const g=normalizeScoreboard(raw,'2026-09-05').games[0];
  assert.equal(g.neutralSite,typeof neutralSite==='boolean'?neutralSite:undefined);
  assert.equal(v.dukeHidden(g,v.defaultDukePreferences()),neutralSite!==false);
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
 const p=v.defaultDukePreferences();assert.equal(v.rememberDukeGames(p,[g],now),p);
 assert.equal(v.dukeHidden(g,v.changeDukeDefault(p,'show',now)),false);
 assert.equal(v.decodeDukePreferences('corrupted').corrupted,true);
 assert.equal(v.decodeDukePreferences(null).corrupted,false);
});
