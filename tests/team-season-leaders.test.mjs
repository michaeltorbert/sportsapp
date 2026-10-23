import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bundle } from './helpers.mjs';
const { createLeadersSnapshot, readSeasonLeaders, refreshSeasonLeaders, handleLeadersRefresh, CFBD_URLS, SNAPSHOT_KEY, LEADERS_INTERVAL_MS, LEADERS_MAX_AGE_MS } = await bundle('lib/cfbd-season-leaders.ts');
const { createTeamSeasonService, teamScheduleUrl, teamStatsUrl } = await bundle('lib/team-season-server.ts');
const { parseTeamSeason } = await bundle('lib/team-season.ts');
const fixture = n => JSON.parse(readFileSync(new URL(`./fixtures/${n}.json`,import.meta.url),'utf8'));
const identities = fixture('cfbd-03-fbs-identities'), categories = ['11-national-passing','12-national-rushing','13-national-receiving'].map(n=>fixture('cfbd-'+n));
const T0=Date.parse('2026-10-23T05:00:00Z');
const stamp=new Date(T0).toISOString();
const snapshot=()=>createLeadersSnapshot(identities,categories,stamp);
function storage(){ const map=new Map(), ops=[];return {map,ops,async get(k){ops.push(['get',k]);return map.get(k)??null;},async put(k,v){ops.push(['put',k]);map.set(k,v);}};}
const json=b=>new Response(JSON.stringify(b),{headers:{'content-type':'application/json'}});

test('Observed national YDS captures select maxima and match independently captured Texas and UNC team rows',()=>{
 const snap=snapshot();assert.equal(Object.keys(snap.teams).length,3);
 for(const [team,n]of [['251','01-texas-2026-playerseason'],['153','09-unc-2026-playerseason']]){
  const direct=fixture('cfbd-'+n);
  for(const [i,key]of ['passingYards','rushingYards','receivingYards'].entries()){
   const rows=direct.filter(r=>r.category===['passing','rushing','receiving'][i]&&r.statType==='YDS').sort((a,b)=>Number(b.stat)-Number(a.stat));
   assert.equal(snap.teams[team].leaders[key].yards,Number(rows[0].stat));assert.equal(snap.teams[team].leaders[key].name,rows[0].player);
  }
 }
 assert.deepEqual(snap.teams['251'].leaders.rushingYards,{athleteId:'4871053',name:'Daylan Smothers',yards:289});
});
test('SYNTHETIC invalid maxima do not promote runner-up; zero/negative valid; ties deterministic and ambiguity fails',()=>{
 const teams=[{id:251,school:'Texas',mascot:'Longhorns',classification:'fbs'}];
 const row=(playerId,player,stat)=>({season:2026,team:'Texas',category:'passing',statType:'YDS',playerId,player,stat});
 const make=rows=>createLeadersSnapshot(teams,[rows,[{...row('1','Rusher','0'),category:'rushing'}],[{...row('2','Receiver','-2'),category:'receiving'}]],stamp).teams['251'].leaders;
 assert.equal(make([row('1','Valid','0')]).passingYards.yards,0);assert.equal(make([row('1','Valid','-4')]).passingYards.yards,-4);
 for(const invalid of [row('2','','200'),row('2','Bad','1.5'),row('2','Bad','1000000'),{...row('2','Bad','200'),season:2025}])assert.equal(make([row('1','Lower','10'),invalid]).passingYards,null);
 const a=row('20','A','100'),b=row('10','B','100');assert.deepEqual(make([a,b]),make([b,a]));assert.equal(make([a,b]).passingYards.athleteId,'10');
 assert.equal(make([a,{...a,stat:'101'}]).passingYards,null);
 assert.throws(()=>createLeadersSnapshot([...teams,...teams],categories,stamp),/identity/);
});
test('public KV reader requires matching year/id/canonical school/name, preserves independent age and expires after36h',async()=>{
 const kv=storage();await kv.put(SNAPSHOT_KEY,JSON.stringify(snapshot()));
 const read=(time=T0,year=2026,id='251',name='Texas Longhorns',short='Texas')=>readSeasonLeaders(kv,id,year,name,short,time);
 assert.equal((await read()).rushingYards.name,'Daylan Smothers');assert.equal((await read()).checkedAt,stamp);
 assert.equal((await read(T0+LEADERS_INTERVAL_MS+1)).stale,true);
 assert.equal(await read(T0+LEADERS_MAX_AGE_MS+1),null);assert.equal(await read(T0-1),null);
 for(const args of [[T0,2025],[T0,2026,'999999'],[T0,2026,'251','Texas A&M Aggies'],[T0,2026,'251','Texas Longhorns','TEX']])assert.equal(await read(...args),null);
 assert.equal(kv.ops.filter(x=>x[0]==='put').length,1,'reader never writes');
});
test('fixed controlled publisher makes4serial reads once/slot, auth beforeKV, public cache hits/misses make zeroCFBD calls',async()=>{
 const kv=storage();let now=T0,calls=[];
 const fetcher=async(url,init)=>{assert.equal(kv.map.has(SNAPSHOT_KEY+':attempt'),true);assert.equal(init.redirect,'manual');assert.equal(init.headers.Authorization,'Bearer test-source');calls.push(url);return json([identities,...categories][CFBD_URLS.indexOf(url)]);};
 const env={SEASON_LEADERS_KV:kv,CFBD_API_KEY:'test-source',CFBD_REFRESH_TOKEN:'test-admin'};
 const no=new Request('https://app.test/api/internal/season-leaders-refresh',{method:'POST'});
 assert.equal((await handleLeadersRefresh(no,env,fetcher)).status,401);assert.equal(kv.ops.length,0);
 assert.equal((await refreshSeasonLeaders(env,fetcher,()=>now)).status,'refreshed');assert.deepEqual(calls,CFBD_URLS);
 assert.equal((await refreshSeasonLeaders(env,fetcher,()=>now)).status,'skipped');assert.equal(calls.length,4);
 await readSeasonLeaders(kv,'251',2026,'Texas Longhorns','Texas',T0);await readSeasonLeaders(kv,'999999',2026,'Unknown','Unknown',T0);assert.equal(calls.length,4);
 now+=LEADERS_INTERVAL_MS;assert.equal((await refreshSeasonLeaders(env,fetcher,()=>now)).status,'refreshed');assert.equal(calls.length,8);
});
test('SYNTHETIC denial/html persists permanent block, cancels rest, future cron/admin skips even nextslot; errors preserve lastgood',async()=>{
 for(const response of [()=>new Response('',{status:302,headers:{location:'https://other.invalid'}}),()=>new Response('',{status:401}),()=>new Response('',{status:403}),()=>new Response('',{status:429}),()=>new Response('<html>',{headers:{'content-type':'text/html'}}),()=>new Response('<html>',{headers:{'content-type':'application/json'}})]){
  const kv=storage();kv.map.set(SNAPSHOT_KEY,JSON.stringify(snapshot()));let calls=0;
  const env={SEASON_LEADERS_KV:kv,CFBD_API_KEY:'test-source'};
  const fetcher=async()=>{calls++;return response();};
  assert.equal((await refreshSeasonLeaders(env,fetcher,()=>T0)).status,'blocked');
  assert.equal((await refreshSeasonLeaders(env,fetcher,()=>T0+LEADERS_INTERVAL_MS*3)).status,'blocked');assert.equal(calls,1);assert.ok(kv.map.has(SNAPSHOT_KEY+':blocked'));assert.equal(JSON.parse(kv.map.get(SNAPSHOT_KEY)).checkedAt,stamp);
 }
 for(const response of [()=>new Response('x',{headers:{'content-type':'application/json','content-length':'8000001'}}),()=>json({wrong:'shape'})]){
  const kv=storage();let calls=0;assert.equal((await refreshSeasonLeaders({SEASON_LEADERS_KV:kv,CFBD_API_KEY:'test-source'},async()=>{calls++;return response();},()=>T0)).status,'failed');assert.ok(calls<=4);assert.equal(kv.map.has(SNAPSHOT_KEY),false);
 }
 const bad={get:async()=>null,put:async()=>{throw Error('disk');}};let calls=0;assert.equal((await refreshSeasonLeaders({SEASON_LEADERS_KV:bad,CFBD_API_KEY:'source'},async()=>{calls++;return json([]);},()=>T0)).status,'failed');assert.equal(calls,0);
});
test('base season and cached/stale retries read only optionalKV; ESPN never calls retiredCore; parser metadata survives',async()=>{
 const duke=fixture('espn-team-season-duke-2026');let calls=[],reads=0;
 const fetcher=async(url)=>{calls.push(url);if(url===teamScheduleUrl('150'))return json(duke.default);if(url===teamScheduleUrl('150',{year:2026,type:3}))return json(duke.postseason);if(url===teamStatsUrl('150',2026))return json(duke.stats);throw Error('unexpected');};
 const kv=storage();kv.map.set(SNAPSHOT_KEY,JSON.stringify(snapshot()));
 const service=createTeamSeasonService(fetcher,()=>T0,async(...args)=>{reads++;return readSeasonLeaders(kv,...args,T0);});
 const first=await service.get('150'),second=await service.get('150');assert.equal(first.status,200);assert.equal(calls.length,3);assert.equal(reads,2);assert.ok(first.season.stats);assert.ok(second.season.regular.entries.length);assert.equal(calls.some(u=>u.includes('core.api')),false);
 const parsed=parseTeamSeason(first.season,'150');assert.equal(parsed.leaders.checkedAt,stamp);assert.equal(parsed.leaders.year,2026);
});

test('SYNTHETIC hung optional KV reader respects remaining original root allowance; late rows cannot mutate answer',async(t)=>{
 const duke=fixture('espn-team-season-duke-2026');let clock=0,release;
 t.mock.method(performance,'now',()=>clock);
 const fetcher=async(url)=>{clock=8990;if(url===teamScheduleUrl('150'))return json(duke.default);if(url===teamScheduleUrl('150',{year:2026,type:3}))return json(duke.postseason);if(url===teamStatsUrl('150',2026))return json(duke.stats);throw Error('unexpected');};
 const hung=new Promise(resolve=>{release=resolve;});
 const service=createTeamSeasonService(fetcher,()=>T0,()=>hung),start=Date.now();
 const result=await service.get('150');assert.equal(result.status,200);assert.ok(Date.now()-start<500,'only10ms original allowance, not a new3s timeout');assert.equal(result.season.leaders,null);assert.ok(result.season.stats);assert.equal(result.season.regular.entries.length,12);
 const frozen=JSON.stringify(result);release(snapshot().teams['150'].leaders);await new Promise(resolve=>setTimeout(resolve,1));assert.equal(JSON.stringify(result),frozen);
});
test('SYNTHETIC fast base plus never-resolving KV cannot exceed3s optional deadline',async()=>{
 const duke=fixture('espn-team-season-duke-2026');const fetcher=async(url)=>json(url===teamScheduleUrl('150')?duke.default:url===teamStatsUrl('150',2026)?duke.stats:duke.postseason);
 const start=Date.now(),result=await createTeamSeasonService(fetcher,()=>T0,()=>new Promise(()=>{})).get('150');assert.equal(result.status,200);assert.ok(result.season.stats);assert.equal(result.season.leaders,null);assert.ok(Date.now()-start<3500);
});

test('SYNTHETIC refresh byte validation accepts transport-empty stream; rejects body/timeout withoutKV/source; auth stays first',async()=>{
 const kv=storage();let calls=0;const env={SEASON_LEADERS_KV:kv,CFBD_REFRESH_TOKEN:'test-admin'},fetcher=async()=>{calls++;throw Error('noegress');};
 const request=(body,authorized=true)=>new Request('https://app.test/api/internal/season-leaders-refresh',{method:'POST',headers:authorized?{Authorization:'Bearer test-admin'}:{},body,duplex:'half'});
 const empty=request(new ReadableStream({start(c){c.close();}}));const accepted=await handleLeadersRefresh(empty,env,fetcher);assert.equal(accepted.status,503);assert.deepEqual(await accepted.json(),{status:'failed',reason:'configuration'});
 for(const body of ['x',new ReadableStream({start(c){c.enqueue(new Uint8Array([1]));c.close();}})])assert.equal((await handleLeadersRefresh(request(body),env,fetcher)).status,400);
 let cancel=false;const hung=new ReadableStream({pull(){return new Promise(()=>{});},cancel(){cancel=true;}}),start=Date.now();assert.equal((await handleLeadersRefresh(request(hung),env,fetcher)).status,400);assert.ok(Date.now()-start<1500);assert.equal(cancel,true);
 const untrusted=new ReadableStream({pull(){return new Promise(()=>{});}});assert.equal((await handleLeadersRefresh(request(untrusted,false),env,fetcher)).status,401);assert.equal(kv.ops.length,0);assert.equal(calls,0);
});
test('parallel optional readers share one deadline; a hung ranking read preserves fast leaders and cannot mutate cached base',async()=>{
 const duke=fixture('espn-team-season-duke-2026');const fetcher=async url=>json(url===teamScheduleUrl('150')?duke.default:url===teamStatsUrl('150',2026)?duke.stats:duke.postseason);
 const expected=snapshot().teams['251'].leaders;let resolveRank;const hung=new Promise(resolve=>resolveRank=resolve);
 const service=createTeamSeasonService(fetcher,()=>T0,async()=>expected,()=>hung),started=Date.now();
 const answer=await service.get('150');assert.equal(answer.status,200);assert.deepEqual(answer.season.leaders,expected);assert.equal(answer.season.rankings,null);assert.ok(Date.now()-started<3500);
 resolveRank({shouldNeverAppear:true});await Promise.resolve();assert.equal(answer.season.rankings,null);
});
test('SYNTHETIC shared denial cleanup rejection preserves the leaders legacy and common persistent blocks',async()=>{
 const kv=storage();let calls=0;
 const result=await refreshSeasonLeaders({SEASON_LEADERS_KV:kv,CFBD_API_KEY:'offline-fixture'},async()=>{calls++;return {status:403,headers:new Headers({'content-type':'text/html'}),body:{cancel:()=>Promise.reject(Error('private error must stay private'))}};},()=>T0);
 assert.equal(result.status,'blocked');assert.equal(calls,1);assert.ok(kv.map.has(SNAPSHOT_KEY+':blocked'));assert.ok(kv.map.has('cfbd:v1:blocked'));
});
