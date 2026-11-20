import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {bundle} from './helpers.mjs';
let calls=0;
const fixture=n=>JSON.parse(readFileSync(new URL('./fixtures/'+n,import.meta.url),'utf8'));
const raw={...fixture('espn-summary-final.json'),...fixture('espn-summary-scoring-final.json')};
globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify(raw),{headers:{'content-type':'application/json'}})};
const route=await bundle('app/api/stats/route.ts');
const current=await bundle('lib/game-stats.ts');
const client=await bundle('lib/stats-client.ts');
const bytes=readFileSync(new URL('./fixtures/player-v123-game-stats.ts.txt',import.meta.url));
assert.equal(createHash('sha256').update(bytes).digest('hex'),'fd074290bbea1ebacee9cac05787eed0e89f58161182687df4db032c98b73d53');
const result=await build({stdin:{contents:bytes.toString(),resolveDir:fileURLToPath(new URL('../lib/',import.meta.url)),loader:'ts'},bundle:true,platform:'node',format:'esm',write:false});
const old=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
test('actual frozen b72/v1.23 strict parser accepts default/scoring bodies; source season only opts in and never changes source caching',async()=>{
 for(const flag of ['playerContext=2','playerContext=true','playerContext=','playerContext=1&playerContext=0']){
  const r=await route.GET(new Request('http://local/api/stats?event=401858481&phase=final&'+flag));assert.equal(r.status,400);
 }
 assert.equal(calls,0);
 for(const flags of ['','&scoring=1','&scoring=1&playerContext=0']){
  const body=await(await route.GET(new Request('http://local/api/stats?event=401858481&phase=final'+flags))).json();
  assert.equal('sourceSeason'in body,false);assert.ok(old.parseGameStats(body),'genuine released parser accepts exact body');
 }
 const opted=await(await route.GET(new Request('http://local/api/stats?event=401858481&phase=final&scoring=1&playerContext=1'))).json();
 assert.equal(opted.sourceSeason,2026);assert.ok(current.parseGameStats(opted));assert.equal(old.parseGameStats(opted),null,'old strict schema proves opt-in is necessary');assert.equal(calls,1);
});
test('new client requests additive context once and accepts an old worker without source year',async()=>{
 const snapshot=current.normalizeGameStats(raw,'401858481','2026-11-14T05:00:00Z'),urls=[];
 const legacy=current.gameStatsForClient(snapshot,true,false);
 const out=await client.loadGameStats({eventId:snapshot.eventId,teamIds:snapshot.teamIds,phase:'final',refresh:false},Date.now()+8000,new AbortController().signal,async url=>{urls.push(url);return new Response(JSON.stringify(legacy),{headers:{'content-type':'application/json'}})});
 assert.equal(out.kind,'ok');assert.equal(out.stats.sourceSeason,undefined);assert.equal(new URL(urls[0],'http://local').searchParams.get('playerContext'),'1');
});
test('#181 additive defense: the EXACT released 1.27 parser accepts the new body and strips new categories and marker',async()=>{
 const players=await bundle('lib/player-season.ts'),server=await bundle('lib/player-season-server.ts');
 // Immutable released source (git show 90aa9d8:lib/player-season.ts), compiled unmodified against unchanged lib/ dependencies.
 const bytes=readFileSync(new URL('./fixtures/player-season-127.ts.txt',import.meta.url));
 assert.equal(bytes.length,8107);assert.equal(createHash('sha256').update(bytes).digest('hex'),'8fcca3bfbd229f887b0e5afa0ce24f7bd0ef58152d147ed915b719fa142428c4');
 const r=await build({stdin:{contents:bytes.toString(),resolveDir:fileURLToPath(new URL('../lib/',import.meta.url)),loader:'ts'},bundle:true,platform:'node',format:'esm',write:false});
 const legacy=await import('data:text/javascript;base64,'+Buffer.from(r.outputFiles[0].text).toString('base64'));
 const F=fixture('team-defense-source.json'),pack=server.createPlayerPack({id:'59',name:'Georgia Tech'},2026,F.stats['59'],F.games['59'],F.boxes['59'],'2026-11-20T18:00:00.000Z');
 const body=JSON.parse(JSON.stringify(server.playerFromPack(pack,'5222695',null,false,[]))),request={id:'5222695',year:2026,team:'59',anchorYear:2026};
 const seen=legacy.parsePlayerSeason(body,request);assert.ok(seen,'released client accepts the new body');
 assert.equal(seen.totals.defensive,undefined);assert.equal(seen.totals.interceptions,undefined);assert.equal('defense' in seen,false,'marker stripped');
 assert.ok(seen.logs.every(l=>l.stats.defensive===undefined&&l.stats.interceptions===undefined));
 assert.deepEqual(players.parsePlayerSeason(body,request).totals.interceptions,{INT:1,YDS:1,TD:0});
 const {defense,...older}=body;assert.equal(defense,'available');const parsedOld=players.parsePlayerSeason(older,request);assert.ok(parsedOld);assert.equal(parsedOld.defense,undefined,'old worker says nothing about defense');
});
test('#181 PV1-02 malformed optional defense is quarantined; valid offense/identity/history/logs survive; valid new fields still show',async()=>{
 const players=await bundle('lib/player-season.ts'),server=await bundle('lib/player-season-server.ts');
 const F=fixture('team-defense-source.json'),pack=server.createPlayerPack({id:'59',name:'Georgia Tech'},2026,F.stats['59'],F.games['59'],F.boxes['59'],'2026-11-20T18:00:00.000Z');
 // SYNTHETIC offense alongside genuine defense, so preservation is observable.
 pack.people['5105677'].stats.passing={YDS:100};
 const body=JSON.parse(JSON.stringify(server.playerFromPack(pack,'5105677',null,false,[]))),request={id:'5105677',year:2026,team:'59',anchorYear:2026};
 const ok=players.parsePlayerSeason(body,request);assert.equal(ok.totals.defensive.SACKS,3);assert.equal(ok.defense,'available');
 for(const [label,mutate] of [['marker',b=>{b.defense='broken'}],['string value',b=>{b.totals.defensive.TOT='bad'}],['unsupported PD',b=>{b.totals.defensive.PD=3}],['fraction count',b=>{b.totals.defensive.TOT=1.5}],['quarter sack',b=>{b.totals.defensive.SACKS=0.25}],['log',b=>{b.logs.find(l=>l.stats.defensive).stats.defensive.SOLO=-1}]]){
  const bad=structuredClone(body);mutate(bad);const s=players.parsePlayerSeason(bad,request);
  assert.ok(s,`${label}: whole body survives`);assert.equal(s.defense,'unavailable',label);
  assert.equal(s.totals.passing.YDS,100,`${label}: offense kept`);assert.equal(s.name,'Taje Mccoy');assert.equal(s.logs.length,12);
  if(label!=='marker'&&label!=='log')assert.equal(s.totals.defensive,undefined,`${label}: invalid category not shown, not zero`);
  if(label==='log'){assert.equal(s.totals.defensive.SACKS,3,'valid totals still shown');assert.ok(s.logs.every(l=>l.stats.defensive?.SOLO!==-1));}
 }
 const invalidOld=structuredClone(body);invalidOld.totals.passing.YDS='bad';assert.equal(players.parsePlayerSeason(invalidOld,request),null,'prior categories keep the original strict contract');
});
