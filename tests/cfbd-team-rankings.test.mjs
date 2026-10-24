import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {bundle} from './helpers.mjs';
const rank=await bundle('lib/cfbd-team-rankings.ts'), leader=await bundle('lib/cfbd-season-leaders.ts'), shared=await bundle('lib/cfbd-source-state.ts');
const {RANKING_KEYS,parseSeasonRankings}=await bundle('lib/team-season.ts');
const sample=JSON.parse(readFileSync(new URL('./fixtures/cfbd-team-rankings-2026-sample.json',import.meta.url)));
const stamp='2026-10-23T19:51:58.000Z',now=Date.parse(stamp);
// Explicitly SYNTHETIC national population; only Texas/UNC rows above are genuine.
function input(){const ids=structuredClone(sample.identities),rows=structuredClone(sample.rows);for(let i=0;i<136;i++){const school=`Synthetic ${i}`;ids.push({id:10000+i,school,mascot:'Testers',classification:'fbs'});for(const k of ['games',...RANKING_KEYS])rows.push({season:2026,team:school,statName:k,statValue:k==='games'?6:3000+i});}return {ids,rows};}
function storage(){const map=new Map(),ops=[];return{map,ops,async get(k){ops.push(['get',k]);return map.get(k)??null;},async put(k,v){ops.push(['put',k]);map.set(k,v);}};}
const json=x=>new Response(JSON.stringify(x),{headers:{'content-type':'application/json'}});
const snapshot=(x=input())=>rank.createRankingsSnapshot(x.ids,x.rows,stamp);
function change(x,team,k,value){x.rows.find(r=>r.team===team&&r.statName===k).statValue=value;}
test('genuine minimal source totals retained; synthetic competition ranks compare exact fractions/direction/ties before rounding',()=>{
 const x=input();change(x,'Synthetic 0','games',3);change(x,'Synthetic 0','totalYards',1084);change(x,'Synthetic 1','totalYards',2169);
 const s=snapshot(x),tex=s.teams['251'].rankings;
 assert.equal(tex.metrics.totalYards.total,2168);assert.equal(tex.metrics.netPassingYards.total,1361);assert.equal(tex.games,6);
 assert.equal(tex.metrics.totalYards.tied,true);assert.equal(s.teams['10000'].rankings.metrics.totalYards.rank,tex.metrics.totalYards.rank);
 assert.equal(s.teams['10001'].rankings.metrics.totalYards.rank,tex.metrics.totalYards.rank-1);
 assert.ok(tex.metrics.totalYardsOpponent.rank<s.teams['10001'].rankings.metrics.totalYardsOpponent.rank);
 for(const k of RANKING_KEYS){const rows=Object.values(s.teams).map(t=>t.rankings.metrics[k]);for(const m of rows){const better=rows.filter(o=>k.endsWith('Opponent')?o.total/o.games<m.total/m.games:o.total/o.games>m.total/m.games).length;assert.equal(m.rank,better+1);}}
});
test('missing/conflicting/malformed member statistic withholds that metric nationally, never promotes another',()=>{
 for(const kind of ['missing','duplicate','badyear','fraction','boolean']){const x=input(),row=x.rows.find(r=>r.team==='Synthetic 0'&&r.statName==='totalYards');if(kind==='missing')x.rows.splice(x.rows.indexOf(row),1);if(kind==='duplicate')x.rows.push({...row});if(kind==='badyear')row.season=2025;if(kind==='fraction')row.statValue=1.5;if(kind==='boolean')row.statValue=true;const s=snapshot(x);assert.equal(s.teams['251'].rankings.metrics.totalYards.rank,null);assert.equal(s.teams['251'].rankings.metrics.totalYards.coverage,137);assert.notEqual(s.teams['251'].rankings.metrics.rushingYards.rank,null);}
 const x=input();change(x,'Synthetic 0','games',0);assert.equal(snapshot(x).teams['251'].rankings.metrics.rushingYards.rank,null);
 const y=input();change(y,'Texas','netPassingYards',-1);change(y,'Texas','rushingYards',0);assert.equal(snapshot(y).teams['251'].rankings.metrics.netPassingYards.total,-1);
 const z=input();z.ids.pop();assert.throws(()=>snapshot(z));
 const dup=input();dup.ids[0]={...dup.ids[1]};assert.throws(()=>snapshot(dup));
});
test('optional KV reader validates identity/year/age/metric metadata; no provider fetch or writes',async()=>{
 const kv=storage();kv.map.set(rank.RANKINGS_SNAPSHOT_KEY,JSON.stringify(snapshot()));
 const read=(n=now,name='Texas Longhorns',year=2026)=>rank.readTeamRankings(kv,'251',year,name,'Texas',n);
 assert.equal((await read()).metrics.totalYards.total,2168);assert.equal((await read(now+86400001)).stale,true);assert.equal(await read(now+259200001),null);assert.equal(await read(now-1),null);assert.equal(await read(now,'Wrong'),null);assert.equal(await read(now,'Texas Longhorns',2025),null);
 const valid=snapshot().teams['251'].rankings;
 for(const mutation of [x=>x.metrics.totalYards.rank=139,x=>x.metrics.totalYards.games=7,x=>x.metrics.totalYards.coverage=137,x=>x.metrics.totalYards.tied='yes',x=>x.population=137]){const bad=structuredClone(valid);mutation(bad);assert.equal(parseSeasonRankings(bad,2026,now),null);}
 assert.equal(kv.ops.filter(x=>x[0]==='put').length,0);
});
test('fixed daily publisher reserves before exactly two calls, skips consumed slot and retains last good on malformed source',async()=>{
 const x=input(),kv=storage(),env={SEASON_LEADERS_KV:kv,CFBD_API_KEY:'fixture-only'},calls=[];
 const fetcher=async(url,opts)=>{calls.push(url);assert.equal(opts.redirect,'manual');assert.ok(kv.ops.some(o=>o[0]==='put'&&o[1].endsWith(':attempt')));return json(url===rank.RANKINGS_URLS[0]?x.ids:x.rows);};
 assert.equal((await rank.refreshTeamRankings(env,fetcher,()=>now)).status,'refreshed');assert.deepEqual(calls,rank.RANKINGS_URLS);const good=kv.map.get(rank.RANKINGS_SNAPSHOT_KEY);
 assert.equal((await rank.refreshTeamRankings(env,fetcher,()=>now)).status,'skipped');assert.equal(calls.length,2);
 assert.equal((await rank.refreshTeamRankings(env,async()=>json({error:'bad'}),()=>now+86400000)).status,'failed');assert.equal(kv.map.get(rank.RANKINGS_SNAPSHOT_KEY),good);
});
test('legacy/common denial blocks both publishers; rank and leader denials propagate without subsequent calls',async()=>{
 for(const marker of [shared.LEGACY_CFBD_BLOCK,shared.COMMON_CFBD_BLOCK]){const kv=storage();kv.map.set(marker,'blocked');const env={SEASON_LEADERS_KV:kv,CFBD_API_KEY:'fixture'};let calls=0;const fetcher=async()=>{calls++;return json([]);};assert.equal((await rank.refreshTeamRankings(env,fetcher,()=>now)).status,'blocked');assert.equal((await leader.refreshSeasonLeaders(env,fetcher,()=>now)).status,'blocked');assert.equal(calls,0);}
 for(const status of [401,403,429,302]){const kv=storage(),env={SEASON_LEADERS_KV:kv,CFBD_API_KEY:'fixture'};let calls=0;const fetcher=async()=>{calls++;return new Response('',{status,headers:{'content-type':'text/html'}});};assert.equal((await rank.refreshTeamRankings(env,fetcher,()=>now)).status,'blocked');assert.ok(kv.map.has(shared.COMMON_CFBD_BLOCK));assert.equal((await leader.refreshSeasonLeaders(env,fetcher,()=>now)).status,'blocked');assert.equal(calls,1);}
 const kv=storage(),env={SEASON_LEADERS_KV:kv,CFBD_API_KEY:'fixture'};let calls=0;const f=async()=>{calls++;return new Response('',{status:403});};await leader.refreshSeasonLeaders(env,f,()=>now);assert.equal((await rank.refreshTeamRankings(env,f,()=>now)).status,'blocked');assert.equal(calls,1);assert.ok(kv.map.has(shared.LEGACY_CFBD_BLOCK));
});
test('authenticated fixed endpoint rejects all unauthenticated or nonempty/parameterized requests before KV/source',async()=>{
 const kv=storage(),env={SEASON_LEADERS_KV:kv,CFBD_API_KEY:'fixture',CFBD_REFRESH_TOKEN:'admin-fixture'};const fetcher=()=>{throw Error('unexpected');};
 const request=(query='',body='',auth=true)=>new Request('https://owned.test/api/internal/team-rankings-refresh'+query,{method:'POST',body,headers:auth?{Authorization:'Bearer admin-fixture'}:{}});
 assert.equal((await rank.handleRankingsRefresh(request('', '',false),env,fetcher)).status,401);for(const [q,b]of [['?force=1',''],['','x']])assert.equal((await rank.handleRankingsRefresh(request(q,b),env,fetcher)).status,400);assert.equal(kv.ops.length,0);
});

const CANARY='PRIVATE_KEY_HEADER_BODY_URL_ERROR_CANARY';
async function diagnostics(run){const lines=[],original=console.warn;console.warn=line=>lines.push(JSON.parse(line));try{return {result:await run(),lines};}finally{console.warn=original;}}
function safeDiagnostic(record){const raw=JSON.stringify(record);assert.ok(!raw.includes(CANARY));assert.ok(Object.keys(record).every(k=>['diagnostic','event','sourceTiming'].includes(k)));if(record.sourceTiming)assertTiming(record.sourceTiming);assert.equal(record.event,'team_rankings_refresh_failed');assert.ok(Object.keys(record.diagnostic).every(k=>['stage','reason','httpStatus','sourceBlocked'].includes(k)));}
test('SYNTHETIC failure diagnostics distinguish both source phases without leaking remote text, values, headers or key',async()=>{
 for(const failingStage of ['membership','stats'])for(const kind of ['http','transport','json','content-type','body','read','size']){
  const x=input(),kv=storage();let calls=0;
  const fetcher=async()=>{calls++;if(failingStage==='stats'&&calls===1)return json(x.ids);
   if(kind==='transport')throw Error(CANARY);
   if(kind==='http')return new Response(JSON.stringify({private:CANARY}),{status:502,headers:{'content-type':'application/json','private':CANARY}});
   if(kind==='json')return new Response('{'+CANARY,{headers:{'content-type':'application/json'}});
   if(kind==='content-type')return new Response(CANARY,{headers:{'content-type':'text/plain'}});
   if(kind==='body')return new Response(null,{headers:{'content-type':'application/json'}});
   if(kind==='read')return new Response(new ReadableStream({pull(){throw Error(CANARY);}}),{headers:{'content-type':'application/json'}});
   return new Response(CANARY,{headers:{'content-type':'application/json','content-length':'8000001'}});
  };
  const {result,lines}=await diagnostics(()=>rank.refreshTeamRankings({SEASON_LEADERS_KV:kv,CFBD_API_KEY:CANARY},fetcher,()=>now));
  assert.equal(result.status,'failed');assert.equal(result.diagnostic.stage,failingStage);assert.equal(result.diagnostic.reason,{'http':'source-response','transport':'source-transport','json':'source-json','content-type':'source-content-type','body':'source-body','read':'source-read','size':'source-size'}[kind]);
  if(kind==='transport')assert.equal(result.diagnostic.httpStatus,undefined);else assert.equal(result.diagnostic.httpStatus,kind==='http'?502:200);
  assert.equal(calls,failingStage==='stats'?2:1);assert.equal(lines.length,1);assert.deepEqual(lines[0].diagnostic,result.diagnostic);safeDiagnostic(lines[0]);assert.ok(!JSON.stringify(result).includes(CANARY));
 }
});
test('SYNTHETIC validation, final snapshot storage and pre-source KV boundaries have distinct safe diagnostics and retain last-good',async()=>{
 for(const failing of ['block-read','attempt-read','attempt-write','snapshot-validation','snapshot-write']){
  const x=input(),kv=storage(),get=kv.get.bind(kv),put=kv.put.bind(kv);kv.map.set(rank.RANKINGS_SNAPSHOT_KEY,'last-good');let calls=0;
  kv.get=async k=>{if(failing==='block-read'&&k===shared.COMMON_CFBD_BLOCK||failing==='attempt-read'&&k.endsWith(':attempt'))throw Error(CANARY);return get(k);};
  kv.put=async(k,v)=>{if(failing==='attempt-write'&&k.endsWith(':attempt')||failing==='snapshot-write'&&k===rank.RANKINGS_SNAPSHOT_KEY)throw Error(CANARY);return put(k,v);};
  const {result,lines}=await diagnostics(()=>rank.refreshTeamRankings({SEASON_LEADERS_KV:kv,CFBD_API_KEY:CANARY},async()=>{calls++;return json(calls===1?(failing==='snapshot-validation'?{private:CANARY}:x.ids):x.rows);},()=>now));
  assert.equal(result.status,'failed');assert.equal(result.diagnostic.stage,failing);assert.equal(result.diagnostic.reason,failing==='snapshot-validation'?'snapshot-invalid':'storage-unavailable');assert.equal(result.diagnostic.httpStatus,undefined);assert.equal(calls,failing.startsWith('snapshot-')?2:0);assert.equal(kv.map.get(rank.RANKINGS_SNAPSHOT_KEY),'last-good');assert.equal(lines.length,1);safeDiagnostic(lines[0]);
 }
});
test('SYNTHETIC rejecting, throwing or nonsettling denial cleanup cannot mask block or request another source',async()=>{
 for(const mode of ['reject','throw','never']){
  const kv=storage();let calls=0;
  const fetcher=async()=>{calls++;return {status:403,headers:new Headers({'content-type':'text/html'}),body:{cancel(){if(mode==='throw')throw Error(CANARY);if(mode==='reject')return Promise.reject(Error(CANARY));return new Promise(()=>{});}}};};
  const observed=await diagnostics(()=>Promise.race([rank.refreshTeamRankings({SEASON_LEADERS_KV:kv,CFBD_API_KEY:CANARY},fetcher,()=>now),new Promise((_,reject)=>setTimeout(()=>reject(Error('cleanup held result')),500))]));
  assert.equal(observed.result.status,'blocked');assert.deepEqual(observed.result.diagnostic,{stage:'membership',reason:'source-blocked',httpStatus:403});assert.ok(kv.map.has(shared.COMMON_CFBD_BLOCK));assert.equal(calls,1);safeDiagnostic(observed.lines[0]);
  assert.equal((await leader.refreshSeasonLeaders({SEASON_LEADERS_KV:kv,CFBD_API_KEY:CANARY},fetcher,()=>now)).status,'blocked');assert.equal(calls,1);
 }
});
test('SYNTHETIC failed common-block persistence retains observed denial and stops later source calls',async()=>{
 const kv=storage(),put=kv.put.bind(kv);kv.put=async(k,v)=>{if(k===shared.COMMON_CFBD_BLOCK)throw Error(CANARY);return put(k,v);};let calls=0;
 const {result,lines}=await diagnostics(()=>rank.refreshTeamRankings({SEASON_LEADERS_KV:kv,CFBD_API_KEY:CANARY},async()=>{calls++;return new Response('',{status:429});},()=>now));
 assert.equal(result.status,'failed');assert.equal(result.reason,'storage-unavailable');assert.deepEqual(result.diagnostic,{stage:'block-write',reason:'storage-unavailable',sourceBlocked:true,httpStatus:429});assert.equal(kv.map.has(shared.COMMON_CFBD_BLOCK),false);assert.equal(calls,1);safeDiagnostic(lines[0]);
});
test('SYNTHETIC authenticated admin JSON receives exactly the safe private-warning diagnostic; unauthorized still has no detail',async()=>{
 const kv=storage(),env={SEASON_LEADERS_KV:kv,CFBD_API_KEY:CANARY,CFBD_REFRESH_TOKEN:'admin-fixture'};
 const request=auth=>new Request('https://owned.test/api/internal/team-rankings-refresh',{method:'POST',headers:auth?{Authorization:'Bearer admin-fixture'}:{}});
 const fetcher=async()=>{throw Error(CANARY);};const no=await rank.handleRankingsRefresh(request(false),env,fetcher);assert.equal(no.status,401);assert.equal((await no.json()).diagnostic,undefined);assert.equal(kv.ops.length,0);
 const {result:response,lines}=await diagnostics(()=>rank.handleRankingsRefresh(request(true),env,fetcher));assert.equal(response.status,503);const body=await response.json();assert.deepEqual(body.diagnostic,lines[0].diagnostic);safeDiagnostic(lines[0]);assert.ok(!JSON.stringify(body).includes(CANARY));
 const controller=new AbortController();controller.abort();await assert.rejects(shared.sourceJson('https://fixed.invalid',CANARY,fetcher,controller.signal),e=>e.reason==='source-aborted'&&e.httpStatus===undefined);
});


function assertTiming(value) {
 assert.equal(value.requestLimitMs,45000);
 assert.ok(Object.keys(value).every(k=>['requestLimitMs','membershipMs','statsMs','totalMs'].includes(k)));
 for(const n of Object.values(value))assert.ok(Number.isSafeInteger(n)&&n>=0&&n<=7200000);
 assert.equal(value.totalMs,(value.membershipMs??0)+(value.statsMs??0));
}
async function flushClock(){for(let i=0;i<40;i++)await Promise.resolve();}
function fakeSourceClock(t,delays,{bodyHang=false}={}) {
 t.mock.timers.enable({apis:['setTimeout']});let elapsed=0,calls=0;const signals=[],x=input();
 const advance=async ms=>{elapsed+=ms;t.mock.timers.tick(ms);await flushClock();};
 const fetcher=async(_url,{signal})=>{
  const index=calls++;signals.push(signal);assert.equal(signal.aborted,false);
  if(bodyHang&&index===1)return new Response(new ReadableStream({start(controller){signal.addEventListener('abort',()=>controller.error(Error(CANARY)),{once:true});}}),{headers:{'content-type':'application/json'}});
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>resolve(json(index===0?x.ids:x.rows)),delays[index]);
   signal.addEventListener('abort',()=>{clearTimeout(timer);reject(Error(CANARY));},{once:true});
  });
 };
 return {fetcher,advance,monotonic:()=>elapsed,signals,calls:()=>calls};
}
test('SYNTHETIC old shared45s starves43s membership plus3s stats; per-operation45s succeeds without extra calls',async t=>{
 const clock=fakeSourceClock(t,[43000,3000]),controller=new AbortController();const timer=setTimeout(()=>controller.abort(),45000);
 const old=(async()=>{try{await shared.sourceJson(rank.RANKINGS_URLS[0],CANARY,clock.fetcher,controller.signal);await shared.sourceJson(rank.RANKINGS_URLS[1],CANARY,clock.fetcher,controller.signal);return'success';}catch(e){return e.reason;}finally{clearTimeout(timer);}})();
 await flushClock();await clock.advance(43000);assert.equal(clock.calls(),2);await clock.advance(2000);assert.equal(await old,'source-aborted');
 t.mock.timers.reset();
 const fresh=fakeSourceClock(t,[43000,3000]),kv=storage();const pending=rank.refreshTeamRankings({SEASON_LEADERS_KV:kv,CFBD_API_KEY:CANARY},fresh.fetcher,()=>now,fresh.monotonic);
 await flushClock();await fresh.advance(43000);assert.equal(fresh.calls(),2);assert.notEqual(fresh.signals[0],fresh.signals[1]);await fresh.advance(3000);
 const result=await pending;assert.equal(result.status,'refreshed');assert.deepEqual(result.sourceTiming,{requestLimitMs:45000,membershipMs:43000,statsMs:3000,totalMs:46000});assert.equal(fresh.calls(),2);assert.ok(!kv.map.get(rank.RANKINGS_SNAPSHOT_KEY).includes('sourceTiming'));
 await fresh.advance(100000);assert.ok(fresh.signals.every(s=>!s.aborted),'cleared phase timers cannot abort completed phases');
});
test('SYNTHETIC each operation receives45s through pending headers/body; failure stops later calls and preserves last-good',async t=>{
 for(const shape of ['membership','stats','stats-body']){
  if(shape!=='membership')t.mock.timers.reset();
  const clock=fakeSourceClock(t,shape==='membership'?[999999,0]:[43000,999999],{bodyHang:shape==='stats-body'}),kv=storage();kv.map.set(rank.RANKINGS_SNAPSHOT_KEY,'last-good');
  const observed=diagnostics(()=>rank.refreshTeamRankings({SEASON_LEADERS_KV:kv,CFBD_API_KEY:CANARY},clock.fetcher,()=>now,clock.monotonic));
  await flushClock();if(shape!=='membership'){await clock.advance(43000);assert.equal(clock.calls(),2);await clock.advance(44999);assert.equal(clock.signals[1].aborted,false);await clock.advance(1);}else await clock.advance(45000);
  const {result,lines}=await observed;assert.equal(result.status,'failed');assert.equal(result.diagnostic.stage,shape==='membership'?'membership':'stats');assert.equal(result.diagnostic.reason,'source-aborted');assert.equal(result.diagnostic.httpStatus,shape==='stats-body'?200:undefined);assert.equal(clock.calls(),shape==='membership'?1:2);assert.equal(kv.map.get(rank.RANKINGS_SNAPSHOT_KEY),'last-good');assertTiming(result.sourceTiming);assert.deepEqual(lines[0].sourceTiming,result.sourceTiming);safeDiagnostic(lines[0]);
  if(shape==='membership')assert.deepEqual(result.sourceTiming,{requestLimitMs:45000,membershipMs:45000,totalMs:45000});else assert.deepEqual(result.sourceTiming,{requestLimitMs:45000,membershipMs:43000,statsMs:45000,totalMs:88000});
 }
});
