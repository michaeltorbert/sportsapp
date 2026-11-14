import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {bundle} from './helpers.mjs';
const M=await bundle('lib/player-season.ts'),S=await bundle('lib/player-season-server.ts');
const F=JSON.parse(readFileSync(new URL('./fixtures/player-source.json',import.meta.url),'utf8'));
const NOW=Date.parse('2026-11-14T05:00:00Z');
const stamp=new Date(NOW).toISOString();
const pack=k=>{const p=F.packs[k];return S.createPlayerPack(p.team,p.year,p.stats,p.games,p.boxes,stamp)};
const identity=(pid,team,year)=>S.createPlayerIdentity(F.identities[pid],pid,F.identities[pid][0].name,team,year,stamp);
const json=v=>new Response(JSON.stringify(v),{headers:{'content-type':'application/json'}});
const req=(id='4870906',year=2026,team='251',anchorYear=2026,extra={})=>({id,year,team,anchorYear,...extra});
function setup({oneSecond=false,fetchOverride}={}){
 let clock=0;const waits=[],writes=new Map(),map=new Map(),calls=[];
 const teams=Object.fromEntries([['251','Texas'],['153','North Carolina'],['275','Wisconsin'],['97','Louisville']].map(([id,school])=>[id,{id,school}]));
 map.set('season-leaders:v1:2026:regular',JSON.stringify({v:1,year:2026,teams}));
 const kv={async get(k){return map.get(k)??null},async put(k,v){if(oneSecond&&writes.has(k))assert.ok(clock-writes.get(k)>=1000,`KV same-key one-second spacing: ${k}`);writes.set(k,clock);map.set(k,v)}};
 const pacing={monotonic:()=>clock,wait:async ms=>{waits.push(ms);clock+=ms}};
 const fetcher=async(url,init)=>{calls.push(url);assert.equal(init.redirect,'manual');assert.ok(map.has('player:v1:budget'));if(fetchOverride)return fetchOverride(url,init);
  const u=new URL(url);assert.equal(u.origin,'https://api.collegefootballdata.com');
  if(u.pathname==='/player/search'){
   const name=u.searchParams.get('searchTerm');const found=Object.values(F.identities).find(v=>v[0].name===name);
   return json(found??[]);
  }
  const p=Object.values(F.packs).find(p=>p.year===Number(u.searchParams.get('year'))&&p.team.name===u.searchParams.get('team'));
  assert.ok(p,'fixed known source tuple');assert.equal(u.searchParams.get('seasonType'),'regular');
  return json(p[{'/stats/player/season':'stats','/games':'games','/games/players':'boxes'}[u.pathname]]);
 };
 return {map,kv,calls,waits,service:S.createPlayerSeasonService({SEASON_LEADERS_KV:kv,CFBD_API_KEY:'synthetic-source-key'},fetcher,()=>NOW,pacing),pacing};
}
test('real source model keeps coherent current, multiple past, transfer, FCS and all schedules',()=>{
 for(const[k,pid,passing,rushing,receiving,logs,supplied]of[
  ['251:2026','4870906',2027,110,null,12,9],['251:2025','4870906',2942,244,4,12,12],['251:2024','4870906',938,100,null,13,8],
  ['153:2026','4592532',2126,20,null,12,9],['275:2025','4592532',113,null,null,12,2],['2193:2026','5164309',1998,-87,20,12,10]]){
  const p=pack(k), info=identity(pid,p.team,p.year),s=S.playerFromPack(p,pid,info,false,[],p.year,p.team.id);
  assert.equal(s.totals.passing?.YDS,passing??undefined);assert.equal(s.totals.rushing?.YDS,rushing??undefined);assert.equal(s.totals.receiving?.YDS,receiving??undefined);
  assert.equal(s.logs.length,logs);assert.equal(s.logs.filter(l=>Object.keys(l.stats).length).length,supplied);assert.equal(M.parsePlayerSeason(s,req(pid,p.year,p.team.id,p.year))?.id,pid);
 }
 const fcs=pack('2193:2026');assert.ok(fcs.games.some(g=>g.game.id==='401868345'&&g.game.teams.some(t=>t.id==='2839')),'classification ii remains in full log');
 assert.equal(fcs.people['5164309'].stats.rushing.YDS,-87);assert.equal(fcs.people['-5860'],undefined);
 const tx=pack('251:2026');assert.equal(tx.people['4685268'].stats.rushing.YDS,537);assert.equal(tx.people['4685268'].stats.receiving.YDS,102);assert.equal(tx.people['5218633'].stats.rushing.YDS,5);
});
test('missing athlete and box are distinct; duplicate/conflicting values never become zero',()=>{
 const src=structuredClone(F.packs['251:2024']), p=pack('251:2024');assert.equal(p.games.filter(g=>!g.players['4870906']).length,5);
 src.boxes.pop();const partial=S.createPlayerPack(src.team,src.year,src.stats,src.games,src.boxes,stamp);assert.equal(partial.games.filter(g=>!g.boxSupplied).length,1);
 const rows=structuredClone(F.packs['251:2026'].stats);const value=rows.find(r=>r.playerId==='4870906'&&r.category==='passing'&&r.statType==='YDS');rows.push({...value,stat:'999'});
 const a=F.packs['251:2026'];assert.equal(S.createPlayerPack(a.team,a.year,rows,a.games,a.boxes,stamp).people['4870906'].stats.passing.YDS,null);
 const bad=structuredClone(a);bad.boxes[0].teams[0].homeAway='home';assert.throws(()=>S.createPlayerPack(bad.team,bad.year,bad.stats,bad.games,bad.boxes,stamp));
});
test('cold/historical anchor and exact metadata validate history before selected pack; cache reuse and1sec KV pacing',async()=>{
 const t=setup({oneSecond:true});const r=await t.service.get(req('4870906',2024));assert.equal(r.status,200);assert.equal(r.season.team.name,'Texas');assert.equal(r.season.year,2024);assert.equal(t.calls.length,7);
 assert.deepEqual(r.season.choices.map(c=>c.year),[2026,2025,2024,2023]);assert.ok(t.waits.every(ms=>ms>=1000));
 assert.equal((await t.service.get(req('4870906',2024))).status,200);assert.equal(t.calls.length,7);
 const current=await t.service.get(req());assert.equal(current.status,200);assert.equal(t.calls.length,7);
 const other=await t.service.get(req('5218633'));assert.equal(other.status,200);assert.equal(other.season.historyAvailable,false,'missing synthetic search metadata stays unavailable');assert.equal(t.calls.length,8);
});
test('unseeded FCS witness reconstructs exact owned source/game/player side, then own bundle/history',async()=>{
 const t=setup({oneSecond:true});const r=await t.service.get(req('5164309',2026,'2193',2026,{witnessTeam:'153',witnessEvent:'401858218'}));
 assert.equal(r.status,200);assert.equal(r.season.team.id,'2193');assert.equal(r.season.totals.rushing.YDS,-87);assert.deepEqual(r.season.choices,[{year:2026,teams:['East Tennessee State']},{year:2025,teams:['Louisville']}]);assert.equal(t.calls.length,7);
 const bad=await t.service.get(req('5164309',2026,'2193',2026,{witnessTeam:'153',witnessEvent:'401858266'}));assert.equal(bad.status,404);assert.equal(t.calls.length,7);
});
test('overlapping source-listed teams require explicit choice, never first/current; inactive anchor remains valid',async()=>{
 const t=setup();const raw=structuredClone(F.identities['4870906']);raw[0].teamStints.push({team:'Louisville',startYear:2024,endYear:2024});
 const p=pack('251:2026'),i=S.createPlayerIdentity(raw,'4870906','Arch Manning',p.team,2026,stamp);t.map.set('player:v1:identity:4870906',JSON.stringify(i));
 const r=await t.service.get(req('4870906',2024));assert.equal(r.status,200);assert.equal(r.season.needsTeamChoice,true);assert.equal(r.season.team,null);assert.deepEqual(r.season.totals,{});assert.equal(t.calls.length,3);
 const picked=await t.service.get(req('4870906',2024,'251',2026,{stintTeam:'Texas'}));assert.equal(picked.status,200);assert.equal(picked.season.team.name,'Texas');assert.equal(t.calls.length,6);
 const inactive=structuredClone(F.identities['4870906']);inactive[0].activeEndYear=2024;inactive[0].teamStints[0].endYear=2024;
 assert.equal(S.createPlayerIdentity(inactive,'4870906','Arch Manning',p.team,2024,stamp).end,2024);
});
test('same-isolate parallel visits coalesce pack and identity, failures charged and denial durable',async()=>{
 const t=setup();const results=await Promise.all([t.service.get(req()),t.service.get(req())]);assert.ok(results.every(r=>r.status===200));assert.equal(t.calls.length,4);
 const blocked=setup({fetchOverride:async()=>new Response('do not read',{status:403,headers:{'content-type':'text/html'}})});
 assert.equal((await blocked.service.get(req())).status,503);assert.equal(blocked.calls.length,1);assert.ok(blocked.map.has('cfbd:v1:blocked'));
 assert.equal((await blocked.service.get(req('4592532',2026,'153'))).status,503);assert.equal(blocked.calls.length,1);
 assert.equal(JSON.parse(blocked.map.get('player:v1:budget')).days[0].calls,3);
});
test('reservation/cache eviction/budget/storage uncertainty never becomes force retry/source proxy',async()=>{
 const t=setup();await t.service.get(req());t.map.delete('player:v1:pack:251:2026');assert.equal((await t.service.get(req())).status,503);assert.equal(t.calls.length,4);
 const full=setup();full.map.set('player:v1:budget',JSON.stringify({days:[{day:Math.floor(NOW/86400000),calls:24}]}));assert.equal((await full.service.get(req())).status,503);assert.equal(full.calls.length,0);
 let calls=0;const service=S.createPlayerSeasonService({SEASON_LEADERS_KV:{get:async()=>{throw Error('private error')},put:async()=>{}},CFBD_API_KEY:'fixture'},async()=>{calls++;throw Error()});assert.equal((await service.get(req())).status,503);assert.equal(calls,0);
 const rolling=setup();rolling.map.set('player:v1:budget',JSON.stringify({days:[{day:Math.floor(NOW/86400000)-31,calls:399}]}));assert.equal((await rolling.service.get(req())).status,503);assert.equal(rolling.calls.length,0,'partial oldest day remains conservatively within rolling allowance');
 const missing=setup();assert.equal((await missing.service.get(req('999999'))).status,404);assert.equal(missing.calls.length,3,'syntactically valid unknown player needs admitted identity bundle');
});
test('request parser rejects missing/duplicate/malformed/incompatible fields with no inferred anchor year',()=>{
 const good='id=4870906&year=2024&team=251&anchorYear=2026';assert.ok(M.parsePlayerRequest(new URLSearchParams(good)));
 for(const q of ['id=1&year=2026&team=251',good+'&team=153',good+'&url=https://example.com',good.replace('4870906','-1'),good+'&witnessTeam=153',good+'&stintTeam=%3Cscript%3E'])assert.equal(M.parsePlayerRequest(new URLSearchParams(q)),null);
});
test('existing Duke rules gate whole aggregates/direct game/logs; no subtraction, unknown state/prefs closed',async()=>{
 const {defaultDukePreferences}=await bundle('lib/duke-visibility.ts');const p=pack('153:2026'),s=S.playerFromPack(p,'4592532',identity('4592532',p.team,2026),false,[]);const prefs=defaultDukePreferences();
 assert.equal(M.playerAggregates(s,prefs).shown,true,'automatic away-only final remains visible');assert.equal(M.playerAggregates(s,null).shown,false);
 const game=s.logs.find(l=>l.game.id==='401858266').game;prefs.manual[game.id]=true;assert.equal(M.playerGameHidden(game,prefs),true);assert.equal(M.playerGame(s,game.id,prefs),null);assert.equal(M.playerAggregates(s,prefs).shown,false);
 prefs.manual[game.id]=false;assert.equal(M.playerGameHidden({...game,state:'other',started:false},prefs),false,'explicit manual show is preserved');delete prefs.manual[game.id];assert.equal(M.playerGameHidden({...game,state:'other',started:false},prefs),true);
});
