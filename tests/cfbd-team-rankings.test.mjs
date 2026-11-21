import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {bundle} from './helpers.mjs';
const rank=await bundle('lib/cfbd-team-rankings.ts'), leader=await bundle('lib/cfbd-season-leaders.ts'), shared=await bundle('lib/cfbd-source-state.ts');
const {RANKING_KEYS,parseSeasonRankings}=await bundle('lib/team-season.ts');
const sample=JSON.parse(readFileSync(new URL('./fixtures/cfbd-team-rankings-2026-sample.json',import.meta.url)));
// #189: the exact 1.28.0 parser (verbatim, see fixtures/cfbd-scoring-provenance.json), never a stripped lookalike.
const legacy=await (async()=>{const {build}=await import('esbuild');const {fileURLToPath}=await import('node:url');const out=await build({stdin:{contents:readFileSync(new URL('./fixtures/legacy-ranking-parser-1.28.0.ts.txt',import.meta.url),'utf8'),resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'ts'},bundle:true,platform:'node',format:'esm',write:false});return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);})();
const stamp='2026-10-23T19:51:58.000Z',now=Date.parse(stamp);
// Explicitly SYNTHETIC national population; only Texas/UNC rows above are genuine.
function input(){const ids=structuredClone(sample.identities),rows=structuredClone(sample.rows);for(let i=0;i<136;i++){const school=`Synthetic ${i}`;ids.push({id:10000+i,school,mascot:'Testers',classification:'fbs'});for(const k of ['games',...RANKING_KEYS])rows.push({season:2026,team:school,statName:k,statValue:k==='games'?6:3000+i});}
 // #189 SYNTHETIC completed games: every member plays one home game against a SYNTHETIC FCS opponent.
 const games=ids.map((t,i)=>({id:800000000+i,season:2026,seasonType:'regular',completed:true,homeId:t.id,homeTeam:t.school,homeClassification:'fbs',homePoints:20+(i%30),awayId:900000+i,awayTeam:`Synthetic FCS ${i}`,awayClassification:'fcs',awayPoints:i%17}));
 return {ids,rows,games};}
const served=x=>url=>json(url===rank.RANKINGS_URLS[0]?x.ids:url===rank.RANKINGS_URLS[1]?x.rows:x.games);
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
test('fixed daily publisher reserves before exactly three calls, skips consumed slot and retains last good on malformed source',async()=>{
 const x=input(),kv=storage(),env={SEASON_LEADERS_KV:kv,CFBD_API_KEY:'fixture-only'},calls=[];
 const fetcher=async(url,opts)=>{calls.push(url);assert.equal(opts.redirect,'manual');assert.ok(kv.ops.some(o=>o[0]==='put'&&o[1].endsWith(':attempt')));return served(x)(url);};
 const first=await rank.refreshTeamRankings(env,fetcher,()=>now);assert.equal(first.status,'refreshed');assert.equal(first.scoring,'published');assert.equal(first.scoringDiagnostic,undefined);
 assert.deepEqual(calls,rank.RANKINGS_URLS);assert.equal(calls.length,3);assert.equal(calls[2],'https://api.collegefootballdata.com/games?year=2026&seasonType=regular&classification=fbs');
 const good=kv.map.get(rank.RANKINGS_SNAPSHOT_KEY);assert.ok(good.length<rank.RANKINGS_MAX_CHARS,`snapshot ${good.length} characters`);
 assert.equal((await rank.refreshTeamRankings(env,fetcher,()=>now)).status,'skipped');assert.equal(calls.length,3);
 assert.equal((await rank.refreshTeamRankings(env,async()=>json({error:'bad'}),()=>now+86400000)).status,'failed');assert.equal(kv.map.get(rank.RANKINGS_SNAPSHOT_KEY),good);
});
test('#189 published scoring child is read through the unchanged v1 key; yardage identical to the legacy-only generation',async()=>{
 const x=input(),kv=storage();await rank.refreshTeamRankings({SEASON_LEADERS_KV:kv,CFBD_API_KEY:'fixture'},async url=>served(x)(url),()=>now);
 const tex=await rank.readTeamRankings(kv,'251',2026,'Texas Longhorns','Texas',now);
 assert.equal(tex.scoring.basis,'regular-completed');assert.equal(tex.scoring.games,1);assert.equal(tex.scoring.checkedAt,tex.checkedAt);
 assert.deepEqual([tex.scoring.offense.total,tex.scoring.defense.total],[x.games.find(g=>g.homeId===251).homePoints,x.games.find(g=>g.homeId===251).awayPoints]);
 const {scoring,...yardage}=tex,{scoring:legacyNone,...legacyYardage}=parseSeasonRankings(snapshot(x).teams['251'].rankings,2026,now);
 assert.equal(legacyNone,null);assert.deepEqual(yardage,legacyYardage,'legacy yardage values/ranks/games unchanged');
 assert.equal(scoring.offense.coverage,138);
});
test('#189 compatibility: exact 1.28.0 parser reads new snapshots unchanged; new parser reads old snapshots with scoring null',async()=>{
 const x=input(),kv=storage();await rank.refreshTeamRankings({SEASON_LEADERS_KV:kv,CFBD_API_KEY:'fixture'},async url=>served(x)(url),()=>now);
 const stored=JSON.parse(kv.map.get(rank.RANKINGS_SNAPSHOT_KEY)),fresh=stored.teams['251'].rankings;assert.ok(fresh.scoring);
 const old=legacy.parseSeasonRankings(structuredClone(fresh),2026,now),current=parseSeasonRankings(structuredClone(fresh),2026,now);
 assert.ok(old);assert.equal('scoring' in old,false);const {scoring,...rest}=current;assert.deepEqual(old,rest);
 const before=snapshot(x).teams['251'].rankings;assert.equal('scoring' in before,false,'legacy factory output unchanged');
 const read=parseSeasonRankings(structuredClone(before),2026,now);assert.equal(read.scoring,null);const {scoring:none,...same}=read;assert.deepEqual(same,legacy.parseSeasonRankings(structuredClone(before),2026,now));
 // An invalid child is only null; the yardage generation stays usable for both parsers.
 const bad=structuredClone(fresh);bad.scoring.offense.games=99;assert.equal(parseSeasonRankings(bad,2026,now).scoring,null);assert.ok(parseSeasonRankings(bad,2026,now).metrics.totalYards);assert.ok(legacy.parseSeasonRankings(bad,2026,now));
 const otherGeneration=structuredClone(fresh);otherGeneration.scoring.checkedAt='2026-10-22T19:51:58.000Z';assert.equal(parseSeasonRankings(otherGeneration,2026,now).scoring,null);
});
function safeScoringWarning(record){const raw=JSON.stringify(record);assert.ok(!raw.includes(CANARY));assert.equal(record.event,'team_rankings_scoring_unavailable');assert.ok(Object.keys(record).every(k=>['event','scoringDiagnostic','sourceTiming'].includes(k)));assert.ok(Object.keys(record.scoringDiagnostic).every(k=>['stage','reason','httpStatus'].includes(k)));if(record.sourceTiming)assertTiming(record.sourceTiming);}
test('#189 SYNTHETIC non-denial games/scoring failures still publish usable yardage with scoring unavailable and a safe private warning',async()=>{
 const cases={
  http:[()=>new Response(JSON.stringify({private:CANARY}),{status:502,headers:{'content-type':'application/json',private:CANARY}}),{stage:'games',reason:'source-response',httpStatus:502}],
  transport:[()=>{throw Error(CANARY);},{stage:'games',reason:'source-transport'}],
  json:[()=>new Response('{'+CANARY,{headers:{'content-type':'application/json'}}),{stage:'games',reason:'source-json',httpStatus:200}],
  size:[()=>new Response(CANARY,{headers:{'content-type':'application/json','content-length':'8000001'}}),{stage:'games',reason:'source-size',httpStatus:200}],
  invalid:[x=>{const g=structuredClone(x.games);g.push(structuredClone(g[0]));return json(g);},{stage:'scoring-validation',reason:'scoring-invalid'}],
  incomplete:[x=>json(x.games.slice(1)),null],
 };
 for(const [name,[games,expected]] of Object.entries(cases)){
  const x=input(),kv=storage();kv.map.set(rank.RANKINGS_SNAPSHOT_KEY,'last-good');let calls=0;
  const fetcher=async url=>{calls++;return url===rank.RANKINGS_URLS[2]?games(x):served(x)(url);};
  const {result,lines}=await diagnostics(()=>rank.refreshTeamRankings({SEASON_LEADERS_KV:kv,CFBD_API_KEY:CANARY},fetcher,()=>now));
  assert.equal(result.status,'refreshed',name);assert.equal(calls,3);assert.equal(result.diagnostic,undefined);assert.ok(!JSON.stringify(result).includes(CANARY));
  const stored=kv.map.get(rank.RANKINGS_SNAPSHOT_KEY);assert.notEqual(stored,'last-good');
  const tex=await rank.readTeamRankings(kv,'251',2026,'Texas Longhorns','Texas',now);assert.equal(tex.metrics.totalYards.total,2168,'yardage published');
  if(expected){assert.equal(result.scoring,'unavailable');assert.deepEqual(result.scoringDiagnostic,expected);assert.equal(tex.scoring,null);assert.equal('scoring' in JSON.parse(stored).teams['251'].rankings,false);
   assert.equal(lines.length,1);assert.deepEqual(lines[0].scoringDiagnostic,expected);safeScoringWarning(lines[0]);}
  else{// SYNTHETIC one member without a completed game: values published, every national scoring rank withheld.
   assert.equal(result.scoring,'published');assert.equal(lines.length,0);const missing=await rank.readTeamRankings(kv,'153',2026,'North Carolina Tar Heels','North Carolina',now);assert.equal(missing.scoring,null);assert.equal(tex.scoring.offense.rank,null);assert.equal(tex.scoring.offense.coverage,137);}
 }
});
test('#189 SYNTHETIC actual denial on the games read persists the shared block, keeps last-good and stops later providers',async()=>{
 for(const status of [401,403,429,302]){
  const x=input(),kv=storage();kv.map.set(rank.RANKINGS_SNAPSHOT_KEY,'last-good');let calls=0;
  const fetcher=async url=>{calls++;return url===rank.RANKINGS_URLS[2]?new Response('',{status,headers:{'content-type':'text/html'}}):served(x)(url);};
  const {result,lines}=await diagnostics(()=>rank.refreshTeamRankings({SEASON_LEADERS_KV:kv,CFBD_API_KEY:CANARY},fetcher,()=>now));
  assert.equal(result.status,'blocked');assert.deepEqual(result.diagnostic,{stage:'games',reason:'source-blocked',httpStatus:status});assert.equal(result.scoring,undefined);
  assert.ok(kv.map.has(shared.COMMON_CFBD_BLOCK));assert.equal(kv.map.get(rank.RANKINGS_SNAPSHOT_KEY),'last-good');assert.equal(calls,3);safeDiagnostic(lines[0]);
  assert.equal((await leader.refreshSeasonLeaders({SEASON_LEADERS_KV:kv,CFBD_API_KEY:CANARY},fetcher,()=>now)).status,'blocked');assert.equal(calls,3);
 }
 const kv=storage(),put=kv.put.bind(kv);kv.put=async(k,v)=>{if(k===shared.COMMON_CFBD_BLOCK)throw Error(CANARY);return put(k,v);};kv.map.set(rank.RANKINGS_SNAPSHOT_KEY,'last-good');const x=input();
 const {result}=await diagnostics(()=>rank.refreshTeamRankings({SEASON_LEADERS_KV:kv,CFBD_API_KEY:CANARY},async url=>url===rank.RANKINGS_URLS[2]?new Response('',{status:403}):served(x)(url),()=>now));
 assert.deepEqual([result.status,result.reason],['failed','storage-unavailable']);assert.deepEqual(result.diagnostic,{stage:'block-write',reason:'storage-unavailable',sourceBlocked:true,httpStatus:403});assert.equal(kv.map.get(rank.RANKINGS_SNAPSHOT_KEY),'last-good');
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
  assert.equal(result.status,'failed');assert.equal(result.diagnostic.stage,failing);assert.equal(result.diagnostic.reason,failing==='snapshot-validation'?'snapshot-invalid':'storage-unavailable');assert.equal(result.diagnostic.httpStatus,undefined);assert.equal(calls,failing==='snapshot-write'?3:failing==='snapshot-validation'?2:0);assert.equal(kv.map.get(rank.RANKINGS_SNAPSHOT_KEY),'last-good');assert.equal(lines.length,1);safeDiagnostic(lines[0]);
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
 assert.ok(Object.keys(value).every(k=>['requestLimitMs','membershipMs','statsMs','gamesMs','totalMs'].includes(k)));
 for(const n of Object.values(value))assert.ok(Number.isSafeInteger(n)&&n>=0&&n<=7200000);
 assert.equal(value.totalMs,(value.membershipMs??0)+(value.statsMs??0)+(value.gamesMs??0));
}
async function flushClock(){for(let i=0;i<40;i++)await Promise.resolve();}
function fakeSourceClock(t,delays,{bodyHang=false}={}) {
 t.mock.timers.enable({apis:['setTimeout']});let elapsed=0,calls=0;const signals=[],x=input();
 const advance=async ms=>{elapsed+=ms;t.mock.timers.tick(ms);await flushClock();};
 const fetcher=async(_url,{signal})=>{
  const index=calls++;signals.push(signal);assert.equal(signal.aborted,false);
  if(bodyHang&&index===1)return new Response(new ReadableStream({start(controller){signal.addEventListener('abort',()=>controller.error(Error(CANARY)),{once:true});}}),{headers:{'content-type':'application/json'}});
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>resolve(json(index===0?x.ids:index===1?x.rows:x.games)),delays[index]);
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
 const fresh=fakeSourceClock(t,[43000,3000,2000]),kv=storage();const pending=rank.refreshTeamRankings({SEASON_LEADERS_KV:kv,CFBD_API_KEY:CANARY},fresh.fetcher,()=>now,fresh.monotonic);
 await flushClock();await fresh.advance(43000);assert.equal(fresh.calls(),2);assert.notEqual(fresh.signals[0],fresh.signals[1]);await fresh.advance(3000);
 // #189: the third fixed games read has its own fresh 45s operation timer too.
 assert.equal(fresh.calls(),3);assert.notEqual(fresh.signals[1],fresh.signals[2]);await fresh.advance(2000);
 const result=await pending;assert.equal(result.status,'refreshed');assert.equal(result.scoring,'published');assert.deepEqual(result.sourceTiming,{requestLimitMs:45000,membershipMs:43000,statsMs:3000,gamesMs:2000,totalMs:48000});assert.equal(fresh.calls(),3);assert.ok(!kv.map.get(rank.RANKINGS_SNAPSHOT_KEY).includes('sourceTiming'));
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
test('#189 SYNTHETIC a games read held past its own 45s publishes yardage with scoring unavailable; no retry',async t=>{
 const clock=fakeSourceClock(t,[1000,1000,999999]),kv=storage();kv.map.set(rank.RANKINGS_SNAPSHOT_KEY,'last-good');
 const observed=diagnostics(()=>rank.refreshTeamRankings({SEASON_LEADERS_KV:kv,CFBD_API_KEY:CANARY},clock.fetcher,()=>now,clock.monotonic));
 await flushClock();await clock.advance(1000);await clock.advance(1000);assert.equal(clock.calls(),3);await clock.advance(44999);assert.equal(clock.signals[2].aborted,false);await clock.advance(1);
 const {result,lines}=await observed;assert.equal(result.status,'refreshed');assert.equal(result.scoring,'unavailable');assert.deepEqual(result.scoringDiagnostic,{stage:'games',reason:'source-aborted'});
 assert.deepEqual(result.sourceTiming,{requestLimitMs:45000,membershipMs:1000,statsMs:1000,gamesMs:45000,totalMs:47000});assert.equal(clock.calls(),3);
 assert.notEqual(kv.map.get(rank.RANKINGS_SNAPSHOT_KEY),'last-good');assert.equal((await rank.readTeamRankings(kv,'251',2026,'Texas Longhorns','Texas',now)).scoring,null);safeScoringWarning(lines[0]);
});
