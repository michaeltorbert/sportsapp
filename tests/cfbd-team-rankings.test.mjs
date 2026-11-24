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

// ---- 1.29.1 E-S5-502: SYNTHETIC source/time/storage. These prove code behaviour only, never a live 502 or hosted cron. ----
const DAY=86400000,HOUR=3600000,CRON='0 5,17 * * *',ATTEMPT='team-rankings:v1:2026:attempt';
const slot=Math.floor(now/DAY),day0=slot*DAY,at05=day0+5*HOUR+4878,at17=day0+17*HOUR+4878; // observed hosted jitter 4.878s
const sched=t=>({cron:CRON,scheduledTime:t});
const receiptOf=(over={})=>({v:1,slot,at:at05+1597,phase:'primary05',stage:'membership',reason:'source-response',httpStatus:502,...over});
const receipt=over=>JSON.stringify(receiptOf(over));
const json502=()=>new Response(JSON.stringify({private:CANARY}),{status:502,headers:{'content-type':'application/json',private:CANARY}});
const status=code=>()=>new Response(JSON.stringify({private:CANARY}),{status:code,headers:{'content-type':'application/json'}});
/** Explicit schedule argument: `undefined` really means no controller context (operator/legacy). */
const run=(kv,fetcher,t,schedule)=>diagnostics(()=>rank.refreshTeamRankings({SEASON_LEADERS_KV:kv,CFBD_API_KEY:CANARY},fetcher,()=>t+1597,undefined,schedule));
const puts=(kv,key)=>kv.ops.filter(o=>o[0]==='put'&&o[1]===key).length;
function counter(answer){const calls=[];return {calls,fetcher:async url=>{calls.push(url);return answer(url);}};}
function consumedDay(kv,withReceipt=receipt()){kv.map.set(ATTEMPT,String(slot));if(withReceipt!==null)kv.map.set(rank.RANKINGS_ELIGIBLE_KEY,withReceipt);kv.map.set(rank.RANKINGS_SNAPSHOT_KEY,'last-good');}
function safeRecoveryLine(record){const raw=JSON.stringify(record);assert.ok(!raw.includes(CANARY));assert.equal(record.event,'team_rankings_refresh_failed');assert.ok(Object.keys(record).every(k=>['diagnostic','recoveryDiagnostic','event','sourceTiming'].includes(k)));if(record.sourceTiming)assertTiming(record.sourceTiming);}

test('1.29.1 SYNTHETIC 05 membership non-denial502 mints one receipt; jittered17 reserves before egress and publishes once; repeats, unscheduled and next day',async()=>{
 const x=input(),kv=storage();kv.map.set(rank.RANKINGS_SNAPSHOT_KEY,'last-good');
 const a05=counter(json502),first=await run(kv,a05.fetcher,at05,sched(at05));
 assert.deepEqual([first.result.status,first.result.reason],['failed','source-unavailable']);assert.deepEqual(first.result.diagnostic,{stage:'membership',reason:'source-response',httpStatus:502});
 assert.equal(first.result.attempt,undefined);assert.equal(first.result.recoveryDiagnostic,undefined);assert.deepEqual(a05.calls,[rank.RANKINGS_URLS[0]],'one source call');
 assert.equal(kv.map.get(ATTEMPT),String(slot),'primary marker value format unchanged');assert.deepEqual(JSON.parse(kv.map.get(rank.RANKINGS_ELIGIBLE_KEY)),receiptOf());
 assert.ok(!kv.map.get(rank.RANKINGS_ELIGIBLE_KEY).includes(CANARY));assert.equal(kv.map.has(rank.RANKINGS_RECOVERY_KEY),false);assert.equal(kv.map.get(rank.RANKINGS_SNAPSHOT_KEY),'last-good');
 assert.equal(first.lines.length,1);safeDiagnostic(first.lines[0]);
 const calls=[],f17=async url=>{assert.equal(kv.map.get(rank.RANKINGS_RECOVERY_KEY),String(slot),'consumption reserved before any egress');calls.push(url);return served(x)(url);};
 const recovered=await run(kv,f17,at17,sched(at17));
 assert.equal(recovered.result.status,'refreshed');assert.equal(recovered.result.scoring,'published');assert.equal(recovered.result.attempt,'recovery');assert.deepEqual(calls,rank.RANKINGS_URLS,'unchanged three fixed reads');
 assert.equal(kv.map.get(ATTEMPT),String(slot),'primary marker never rewritten');assert.equal(puts(kv,ATTEMPT),1);assert.equal(puts(kv,rank.RANKINGS_ELIGIBLE_KEY),1);assert.equal(puts(kv,rank.RANKINGS_RECOVERY_KEY),1);
 const tex=await rank.readTeamRankings(kv,'251',2026,'Texas Longhorns','Texas',at17+1597),home=x.games.find(g=>g.homeId===251);
 assert.deepEqual([tex.scoring.offense.total,tex.scoring.defense.total],[home.homePoints,home.awayPoints]);assert.equal(tex.metrics.totalYards.total,2168);
 for(const [label,schedule,t] of [['repeat17',sched(at17+1000),at17+1000],['unscheduled/operator',undefined,at17+2000],['duplicate05',sched(at05),at05+5000]]){
  const r=await run(kv,f17,t,schedule);assert.deepEqual([r.result.status,r.result.reason],['skipped','refresh-slot'],label);assert.equal(r.result.attempt,undefined);assert.equal(calls.length,3,label);
 }
 assert.equal(puts(kv,rank.RANKINGS_RECOVERY_KEY),1);
 // Next UTC day: ordinary primary independent of yesterday's consumed recovery; old receipt grants nothing at 17.
 const next=counter(served(x)),primary=await run(kv,next.fetcher,at05+DAY,sched(at05+DAY));
 assert.equal(primary.result.status,'refreshed');assert.equal(primary.result.attempt,undefined);assert.equal(next.calls.length,3);assert.equal(kv.map.get(ATTEMPT),String(slot+1));
 const later=await run(kv,next.fetcher,at17+DAY,sched(at17+DAY));assert.equal(later.result.status,'skipped');assert.equal(next.calls.length,3);
});

test('1.29.1 SYNTHETIC real authenticated operator POST carries no schedule: a valid current receipt is never even read',async t=>{
 const real=Date.now(),into=real%DAY;if(into<60000||into>DAY-60000){t.skip('within one minute of UTC midnight');return;}
 const s=Math.floor(real/DAY),kv=storage();kv.map.set(ATTEMPT,String(s));kv.map.set(rank.RANKINGS_ELIGIBLE_KEY,receipt({slot:s,at:s*DAY}));
 let calls=0;const env={SEASON_LEADERS_KV:kv,CFBD_API_KEY:CANARY,CFBD_REFRESH_TOKEN:'admin-fixture'};
 const response=await rank.handleRankingsRefresh(new Request('https://owned.test/api/internal/team-rankings-refresh',{method:'POST',headers:{Authorization:'Bearer admin-fixture'}}),env,async()=>{calls++;throw Error(CANARY);});
 assert.equal(response.status,200);assert.deepEqual(await response.json(),{status:'skipped',reason:'refresh-slot'});assert.equal(calls,0);
 assert.equal(kv.ops.some(o=>o[1]===rank.RANKINGS_ELIGIBLE_KEY||o[1]===rank.RANKINGS_RECOVERY_KEY),false);
});

test('1.29.1 SYNTHETIC legacy/malformed/stale/future/consumed receipts and untrusted schedule context fail closed with zero calls',async()=>{
 const cases={
  'legacy consumed slot, no receipt (the Nov 24 state)':[null,sched(at17)],
  'previous-day receipt':[receipt({slot:slot-1,at:at05-DAY+1597}),sched(at17)],
  'receipt time on another day':[receipt({at:at05-DAY}),sched(at17)],
  'future receipt time':[receipt({at:at17+600000}),sched(at17)],
  'fractional receipt time':[receipt({at:at05+0.5}),sched(at17)],
  'malformed JSON':['{'+CANARY,sched(at17)],
  'oversize':[receipt({pad:'x'.repeat(300)}),sched(at17)],
  'extra field':[receipt({extra:1}),sched(at17)],
  'missing field':[(()=>{const r=receiptOf();delete r.httpStatus;return JSON.stringify(r);})(),sched(at17)],
  'wrong version':[receipt({v:2}),sched(at17)],
  'string slot':[receipt({slot:String(slot)}),sched(at17)],
  'wrong phase':[receipt({phase:'recovery17'}),sched(at17)],
  'stats stage':[receipt({stage:'stats'}),sched(at17)],
  'other reason':[receipt({reason:'source-transport'}),sched(at17)],
  'status503':[receipt({httpStatus:503}),sched(at17)],
  'no schedule':[receipt(),undefined],
  'wrong cron':[receipt(),{cron:'0 17 * * *',scheduledTime:at17}],
  'missing scheduledTime':[receipt(),{cron:CRON}],
  'string scheduledTime':[receipt(),{cron:CRON,scheduledTime:String(at17)}],
  'NaN scheduledTime':[receipt(),{cron:CRON,scheduledTime:NaN}],
  'yesterday 17 scheduledTime':[receipt(),sched(at17-DAY)],
  'hour16 scheduledTime':[receipt(),sched(at17-HOUR)],
  'hour18 scheduledTime':[receipt(),sched(at17+HOUR)],
  'duplicate 05 delivery':[receipt(),sched(at05)],
 };
 for(const [label,[raw,schedule]] of Object.entries(cases)){
  const kv=storage();consumedDay(kv,raw);const c=counter(()=>{throw Error('unexpected egress');});
  const {result}=await run(kv,c.fetcher,at17,schedule);
  assert.deepEqual([result.status,result.reason],['skipped','refresh-slot'],label);assert.equal(c.calls.length,0,label);assert.equal(kv.ops.some(o=>o[0]==='put'),false,label);assert.equal(kv.map.get(rank.RANKINGS_SNAPSHOT_KEY),'last-good');
 }
 for(const [label,value] of [['already consumed today',String(slot)],['malformed consumption','x'],['future consumption',String(slot+1)]]){
  const kv=storage();consumedDay(kv);kv.map.set(rank.RANKINGS_RECOVERY_KEY,value);const c=counter(()=>{throw Error('unexpected egress');});
  const {result}=await run(kv,c.fetcher,at17,sched(at17));assert.equal(result.status,'skipped',label);assert.equal(c.calls.length,0,label);assert.equal(kv.map.get(rank.RANKINGS_RECOVERY_KEY),value);
 }
 // A previous day's consumption does not block today's single opportunity.
 const x=input(),kv=storage();consumedDay(kv);kv.map.set(rank.RANKINGS_RECOVERY_KEY,String(slot-1));const c=counter(served(x));
 const {result}=await run(kv,c.fetcher,at17,sched(at17));assert.equal(result.attempt,'recovery');assert.equal(result.status,'refreshed');assert.equal(c.calls.length,3);assert.equal(kv.map.get(rank.RANKINGS_RECOVERY_KEY),String(slot));
});

test('1.29.1 SYNTHETIC only a trusted 05 membership non-denial502 mints; every other primary outcome leaves no 17 opportunity',async()=>{
 const x=input(),U=rank.RANKINGS_URLS;
 const cases={
  status500:[sched(at05),at05,url=>url===U[0]?status(500)():served(x)(url),'failed'],
  status503:[sched(at05),at05,url=>url===U[0]?status(503)():served(x)(url),'failed'],
  status504:[sched(at05),at05,url=>url===U[0]?status(504)():served(x)(url),'failed'],
  stats502:[sched(at05),at05,url=>url===U[1]?json502():served(x)(url),'failed'],
  gamesOnly502:[sched(at05),at05,url=>url===U[2]?json502():served(x)(url),'refreshed'],
  transport:[sched(at05),at05,()=>{throw Error(CANARY);},'failed'],
  contentType:[sched(at05),at05,url=>url===U[0]?new Response('[]',{headers:{'content-type':'text/plain'}}):served(x)(url),'failed'],
  json:[sched(at05),at05,url=>url===U[0]?new Response('{',{headers:{'content-type':'application/json'}}):served(x)(url),'failed'],
  validation:[sched(at05),at05,url=>url===U[0]?json({private:CANARY}):served(x)(url),'failed'],
  success:[sched(at05),at05,served(x),'refreshed'],
  'primary at 17 with membership502':[sched(at17),at17,json502,'failed'],
  'unscheduled membership502':[undefined,at05,json502,'failed'],
  'missing scheduledTime membership502':[{cron:CRON},at05,json502,'failed'],
  'wrong cron membership502':[{cron:'0 5 * * *',scheduledTime:at05},at05,json502,'failed'],
 };
 for(const [label,[schedule,t,answer,expected]] of Object.entries(cases)){
  const kv=storage(),c=counter(answer),{result}=await run(kv,c.fetcher,t,schedule);
  assert.equal(result.status,expected,label);assert.equal(result.attempt,undefined,label);assert.equal(result.recoveryDiagnostic,undefined,label);
  assert.equal(kv.map.has(rank.RANKINGS_ELIGIBLE_KEY),false,label);assert.equal(kv.map.get(ATTEMPT),String(slot),label);
  const before=c.calls.length,later=await run(kv,c.fetcher,at17+60000,sched(at17+60000));
  assert.deepEqual([later.result.status,later.result.reason],['skipped','refresh-slot'],label);assert.equal(c.calls.length,before,label);assert.equal(kv.map.has(rank.RANKINGS_RECOVERY_KEY),false,label);
 }
});

test('1.29.1 SYNTHETIC an aborted 05 membership read (own 45s) mints nothing',async t=>{
 const clock=fakeSourceClock(t,[999999]),kv=storage();
 const observed=diagnostics(()=>rank.refreshTeamRankings({SEASON_LEADERS_KV:kv,CFBD_API_KEY:CANARY},clock.fetcher,()=>at05+1597,clock.monotonic,sched(at05)));
 await flushClock();await clock.advance(45000);
 const {result}=await observed;assert.deepEqual(result.diagnostic,{stage:'membership',reason:'source-aborted'});assert.equal(clock.calls(),1);assert.equal(kv.map.has(rank.RANKINGS_ELIGIBLE_KEY),false);
});

test('1.29.1 SYNTHETIC legacy/common blocks override a valid receipt; recovery and primary denials (incl. HTML/challenge502) persist the block and stop',async()=>{
 for(const marker of [shared.LEGACY_CFBD_BLOCK,shared.COMMON_CFBD_BLOCK]){
  const kv=storage();consumedDay(kv);kv.map.set(marker,'blocked');const c=counter(()=>{throw Error('unexpected egress');});
  const {result}=await run(kv,c.fetcher,at17,sched(at17));assert.deepEqual([result.status,result.reason],['blocked','source-blocked']);assert.equal(c.calls.length,0);assert.equal(kv.map.has(rank.RANKINGS_RECOVERY_KEY),false);
 }
 const denials={
  401:()=>new Response('',{status:401}),403:()=>new Response('',{status:403,headers:{'content-type':'text/html'}}),429:()=>new Response('',{status:429}),302:()=>new Response('',{status:302}),
  html502:()=>new Response('<html>'+CANARY,{status:502,headers:{'content-type':'text/html'}}),
  challenge502:()=>new Response(JSON.stringify({private:CANARY}),{status:502,headers:{'content-type':'application/json','cf-mitigated':'challenge'}}),
 };
 for(const [label,answer] of Object.entries(denials)){
  const kv=storage();consumedDay(kv);const c=counter(answer);
  const {result,lines}=await run(kv,c.fetcher,at17,sched(at17));
  assert.deepEqual([result.status,result.reason,result.attempt],['blocked','source-blocked','recovery'],label);assert.equal(result.diagnostic.stage,'membership');assert.equal(result.diagnostic.reason,'source-blocked');
  assert.ok(kv.map.has(shared.COMMON_CFBD_BLOCK),label);assert.equal(kv.map.get(rank.RANKINGS_SNAPSHOT_KEY),'last-good');assert.equal(c.calls.length,1);safeDiagnostic(lines[0]);assert.ok(!JSON.stringify(result).includes(CANARY));
  assert.equal((await leader.refreshSeasonLeaders({SEASON_LEADERS_KV:kv,CFBD_API_KEY:CANARY},c.fetcher,()=>at17+1597)).status,'blocked');assert.equal(c.calls.length,1,'later products stopped');
  // A primary 05 denial (HTML/challenge 502 included) never mints.
  const primary=storage(),p=counter(answer);const r=await run(primary,p.fetcher,at05,sched(at05));
  assert.equal(r.result.status,'blocked',label);assert.equal(primary.map.has(rank.RANKINGS_ELIGIBLE_KEY),false,label);assert.equal(p.calls.length,1);
 }
 // Failed block persistence during recovery stays storage-unavailable (Worker stop).
 const kv=storage(),put=kv.put.bind(kv);kv.put=async(k,v)=>{if(k===shared.COMMON_CFBD_BLOCK)throw Error(CANARY);return put(k,v);};consumedDay(kv);
 const {result}=await run(kv,counter(()=>new Response('',{status:403})).fetcher,at17,sched(at17));
 assert.deepEqual([result.status,result.reason,result.attempt],['failed','storage-unavailable','recovery']);assert.deepEqual(result.diagnostic,{stage:'block-write',reason:'storage-unavailable',sourceBlocked:true,httpStatus:403});
});

test('1.29.1 SYNTHETIC failed recovery never renews; a consumed day stays consumed',async()=>{
 const x=input();
 for(const [label,answer] of [['membership502 again',json502],['stats502',url=>url===rank.RANKINGS_URLS[1]?json502():served(x)(url)],['transport',()=>{throw Error(CANARY);}]]){
  const kv=storage();consumedDay(kv);const c=counter(answer);
  const {result}=await run(kv,c.fetcher,at17,sched(at17));
  assert.deepEqual([result.status,result.reason,result.attempt],['failed','source-unavailable','recovery'],label);assert.equal(kv.map.get(rank.RANKINGS_RECOVERY_KEY),String(slot));
  assert.equal(puts(kv,rank.RANKINGS_ELIGIBLE_KEY),0,'recovery never mints');assert.equal(puts(kv,ATTEMPT),0,'recovery never writes the primary marker');assert.equal(kv.map.get(rank.RANKINGS_SNAPSHOT_KEY),'last-good');
  const before=c.calls.length,again=await run(kv,c.fetcher,at17+600000,sched(at17+600000));assert.equal(again.result.status,'skipped',label);assert.equal(c.calls.length,before,label);
 }
});

test('1.29.1 SYNTHETIC receipt and consumption storage faults: storage-unavailable, known502 retained, zero recovery egress',async()=>{
 // Eligibility write failure after a known 502: original source diagnostic kept, Worker stop signalled.
 const kv=storage(),put=kv.put.bind(kv);kv.put=async(k,v)=>{if(k===rank.RANKINGS_ELIGIBLE_KEY)throw Error(CANARY);return put(k,v);};
 const c=counter(json502),{result,lines}=await run(kv,c.fetcher,at05,sched(at05));
 assert.deepEqual([result.status,result.reason],['failed','storage-unavailable']);assert.deepEqual(result.diagnostic,{stage:'membership',reason:'source-response',httpStatus:502});
 assert.deepEqual(result.recoveryDiagnostic,{stage:'eligibility-write',reason:'storage-unavailable'});assert.equal(c.calls.length,1);assert.ok(!JSON.stringify(result).includes(CANARY));
 assert.equal(lines.length,1);assert.deepEqual(lines[0].recoveryDiagnostic,result.recoveryDiagnostic);assert.deepEqual(lines[0].diagnostic,result.diagnostic);safeRecoveryLine(lines[0]);
 for(const [label,fault] of [['receipt read',k=>k===rank.RANKINGS_ELIGIBLE_KEY],['consumption read',k=>k===rank.RANKINGS_RECOVERY_KEY]]){
  const s=storage(),get=s.get.bind(s);consumedDay(s);s.get=async k=>{if(fault(k))throw Error(CANARY);return get(k);};const f=counter(()=>{throw Error('unexpected egress');});
  const r=await run(s,f.fetcher,at17,sched(at17));
  assert.deepEqual([r.result.status,r.result.reason],['failed','storage-unavailable'],label);assert.deepEqual(r.result.diagnostic,{stage:'recovery-read',reason:'storage-unavailable'});assert.equal(f.calls.length,0,label);assert.equal(s.map.has(rank.RANKINGS_RECOVERY_KEY),false);safeDiagnostic(r.lines[0]);
 }
 const s=storage(),sput=s.put.bind(s);consumedDay(s);s.put=async(k,v)=>{if(k===rank.RANKINGS_RECOVERY_KEY)throw Error(CANARY);return sput(k,v);};const f=counter(()=>{throw Error('unexpected egress');});
 const r=await run(s,f.fetcher,at17,sched(at17));
 assert.deepEqual([r.result.status,r.result.reason],['failed','storage-unavailable']);assert.deepEqual(r.result.diagnostic,{stage:'recovery-write',reason:'storage-unavailable'});assert.equal(f.calls.length,0);assert.equal(s.map.get(rank.RANKINGS_SNAPSHOT_KEY),'last-good');safeDiagnostic(r.lines[0]);
});

// ---- 1.29.2 operator recovery. SYNTHETIC source/time/storage: code behaviour only, never a live 502, hosted cron or production KV. ----
const OP_TOKEN='operator-fixture',PROD='https://saturday-signal.scythe-wildflower.workers.dev',PREVIEW='https://saturday-signal-preview.scythe-wildflower.workers.dev';
const NOV24=Date.UTC(2026,10,24),NOV25=Date.UTC(2026,10,25),DEC2=Date.UTC(2026,11,2),at20=NOV24+20*HOUR; // outside both scheduled windows
const SKIP={status:'skipped',reason:'refresh-slot'};
const slotOf=t=>Math.floor(t/DAY);
const opPuts=(kv,key)=>kv.ops.filter(o=>o[0]==='put'&&(key===undefined||o[1]===key)).length;
const noEgress=()=>counter(()=>{throw Error('unexpected egress');});
const dayReceiptOf=(day,over={})=>({v:1,slot:slotOf(day),at:day+5*HOUR+6475,phase:'primary05',stage:'membership',reason:'source-response',httpStatus:502,...over});
const dayReceipt=(day,over)=>JSON.stringify(dayReceiptOf(day,over));
const priorSnapshot=(day,x=input())=>JSON.stringify(rank.createRankingsSnapshot(x.ids,x.rows,new Date(day-DAY+5*HOUR).toISOString()));
/** The reviewed Nov 24 production state: consumed attempt, no receipt, unused recovery, prior-day snapshot only. */
function spentDay(kv,day,{snap=priorSnapshot(day),withReceipt=null}={}){kv.map.set(ATTEMPT,String(slotOf(day)));if(withReceipt!==null)kv.map.set(rank.RANKINGS_ELIGIBLE_KEY,withReceipt);if(snap!==null)kv.map.set(rank.RANKINGS_SNAPSHOT_KEY,snap);}
const opEnv=kv=>({SEASON_LEADERS_KV:kv,CFBD_API_KEY:CANARY,CFBD_REFRESH_TOKEN:OP_TOKEN});
const opRequest=({origin=PROD,auth=`Bearer ${OP_TOKEN}`,method='POST',query='',body}={})=>new Request(`${origin}/api/internal/team-rankings-recovery${query}`,{method,...(body===undefined?{}:{body}),headers:auth===null?{}:{Authorization:auth}});
async function quiet(run){const original=console.warn;console.warn=()=>{};try{return await run();}finally{console.warn=original;}}
const post=(kv,fetcher,t,opts)=>quiet(async()=>{const r=await rank.handleRankingsRecovery(opRequest(opts),opEnv(kv),fetcher,()=>t);return {status:r.status,body:await r.json()};});
const scheduledAt=(kv,fetcher,t)=>quiet(()=>rank.refreshTeamRankings({SEASON_LEADERS_KV:kv,CFBD_API_KEY:CANARY},fetcher,()=>t+1597,undefined,sched(t)));

test('1.29.2 recovery route checks auth before any storage or egress; malformed authenticated requests rejected before work',async()=>{
 for(const [label,opts,over] of [['hosted preflight, no auth',{auth:null}],['wrong token',{auth:'Bearer nope'}],['raw token',{auth:OP_TOKEN}],['GET no auth',{auth:null,method:'GET'}],['query no auth',{auth:null,query:'?force=1'}],['token unset',{},{CFBD_REFRESH_TOKEN:undefined}],['empty token',{auth:'Bearer '},{CFBD_REFRESH_TOKEN:''}]]){
  const kv=storage();spentDay(kv,NOV24);kv.ops.length=0;const c=noEgress();
  const r=await rank.handleRankingsRecovery(opRequest(opts),{...opEnv(kv),...(over??{})},c.fetcher,()=>at20);
  assert.equal(r.status,401,label);assert.deepEqual(await r.json(),{error:'Unauthorized'});assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(kv.ops.length,0,label);assert.equal(c.calls.length,0,label);
 }
 for(const [label,opts] of [['query',{query:'?force=1'}],['body',{body:'x'}],['json body',{body:'{}'}],['GET',{method:'GET'}],['PUT',{method:'PUT',body:''}]]){
  const kv=storage();spentDay(kv,NOV24);kv.ops.length=0;const c=noEgress();
  const r=await rank.handleRankingsRecovery(opRequest(opts),opEnv(kv),c.fetcher,()=>at20);
  assert.equal(r.status,400,label);assert.equal(kv.ops.length,0,label);assert.equal(c.calls.length,0,label);
 }
});

test('1.29.2 temporary legacy admission: exact Nov 24 production state recovers once, reserved before egress, nothing minted or rewritten',async()=>{
 const x=input(),kv=storage();spentDay(kv,NOV24);const before=kv.map.get(rank.RANKINGS_SNAPSHOT_KEY),s=slotOf(NOV24),calls=[];
 const fetcher=async url=>{assert.equal(kv.map.get(rank.RANKINGS_RECOVERY_KEY),String(s),'shared recovery marker reserved before any egress');calls.push(url);return served(x)(url);};
 const r=await post(kv,fetcher,at20);
 assert.equal(r.status,200);assert.deepEqual([r.body.status,r.body.attempt,r.body.admission,r.body.scoring],['refreshed','recovery','legacy-2026-11-24','published']);
 assert.deepEqual(calls,rank.RANKINGS_URLS,'unchanged three fixed reads, no retries');
 assert.equal(kv.map.get(ATTEMPT),String(s));assert.equal(opPuts(kv,ATTEMPT),0,'daily marker never written');assert.equal(opPuts(kv,rank.RANKINGS_ELIGIBLE_KEY),0,'no fake receipt');assert.equal(kv.map.has(rank.RANKINGS_ELIGIBLE_KEY),false);
 assert.equal(opPuts(kv,rank.RANKINGS_RECOVERY_KEY),1);assert.notEqual(kv.map.get(rank.RANKINGS_SNAPSHOT_KEY),before);
 assert.ok(Object.keys(r.body).every(k=>['status','checkedAt','teams','sourceTiming','scoring','scoringDiagnostic','attempt','admission'].includes(k)));assert.ok(!JSON.stringify(r.body).includes(CANARY));
 assert.equal((await rank.readTeamRankings(kv,'251',2026,'Texas Longhorns','Texas',at20+1)).metrics.totalYards.total,2168);
 // Once consumed: operator repeat, scheduled 17 and the ordinary operator refresh all skip with zero egress.
 assert.deepEqual((await post(kv,fetcher,at20+60000)).body,SKIP);
 assert.deepEqual(await scheduledAt(kv,fetcher,NOV24+17*HOUR+4878),SKIP);
 assert.deepEqual(await quiet(()=>rank.refreshTeamRankings({SEASON_LEADERS_KV:kv,CFBD_API_KEY:CANARY},fetcher,()=>at20+120000)),SKIP);
 assert.equal(calls.length,3);assert.equal(opPuts(kv,rank.RANKINGS_RECOVERY_KEY),1);
});

test('1.29.2 legacy admission: exact day bounds, Date.UTC expiry, fixed production origin only, exact attempt',async()=>{
 const x=input();
 const attempt=async(t,{origin=PROD,day=NOV24,setup}={})=>{const kv=storage();spentDay(kv,day);setup?.(kv);const c=counter(served(x));const r=await post(kv,c.fetcher,t,{origin});return {r,kv,c};};
 for(const t of [NOV24,NOV24+1,NOV25-1]){const {r,c}=await attempt(t);assert.equal(r.body.admission,'legacy-2026-11-24',String(t));assert.equal(c.calls.length,3);}
 // Exactly Date.UTC(2026,10,25) refuses even with that day's own consumed attempt; other days never qualify.
 for(const [label,t,day] of [['Nov25 00:00:00.000',NOV25,NOV25],['Nov25 later',NOV25+20*HOUR,NOV25],['Nov23',NOV24-4*HOUR,NOV24-DAY],['Dec 2',DEC2+20*HOUR,DEC2]]){
  const {r,kv,c}=await attempt(t,{day});assert.deepEqual(r.body,SKIP,label);assert.equal(c.calls.length,0,label);assert.equal(opPuts(kv),0,label);
 }
 {const {r,c}=await attempt(at20,{setup:kv=>kv.map.set(ATTEMPT,String(slotOf(NOV25)))});assert.deepEqual(r.body,SKIP,'future attempt marker');assert.equal(c.calls.length,0);}
 for(const origin of [PREVIEW,'http://127.0.0.1:8787','https://saturday-signal.scythe-wildflower.workers.dev.evil.test','http://saturday-signal.scythe-wildflower.workers.dev']){
  const {r,kv,c}=await attempt(at20,{origin});assert.deepEqual(r.body,SKIP,origin);assert.equal(c.calls.length,0,origin);assert.equal(opPuts(kv),0,origin);
 }
 assert.equal(rank.RANKINGS_LEGACY_DAY_START,Date.parse('2026-11-24T00:00:00.000Z'));assert.equal(rank.RANKINGS_LEGACY_DAY_END,Date.parse('2026-11-25T00:00:00.000Z'));
});

test('1.29.2 present-but-ineligible or malformed receipt (incl. nested formats) never falls through to the legacy branch',async()=>{
 const s=slotOf(NOV24),cases={
  'malformed JSON':'{'+CANARY,'empty string':'','null literal':'null','array':JSON.stringify([dayReceiptOf(NOV24)]),
  'nested wrapper':JSON.stringify({receipt:dayReceiptOf(NOV24)}),'nested status':dayReceipt(NOV24,{httpStatus:{code:502}}),'nested slot':dayReceipt(NOV24,{slot:[s]}),
  'previous day':dayReceipt(NOV24-DAY),'future time':dayReceipt(NOV24,{at:at20+HOUR}),'status503':dayReceipt(NOV24,{httpStatus:503}),'stats stage':dayReceipt(NOV24,{stage:'stats'}),
  'extra field':dayReceipt(NOV24,{extra:1}),'v2':dayReceipt(NOV24,{v:2}),'oversize':dayReceipt(NOV24,{pad:'x'.repeat(300)}),'string slot':dayReceipt(NOV24,{slot:String(s)}),
 };
 for(const [label,raw] of Object.entries(cases)){
  const kv=storage();spentDay(kv,NOV24,{withReceipt:raw});const c=noEgress();const r=await post(kv,c.fetcher,at20);
  assert.deepEqual(r.body,SKIP,label);assert.equal(c.calls.length,0,label);assert.equal(opPuts(kv),0,label);
 }
});

/** Genuine generated snapshots: legacy-factory (no scoring, as 1.23–1.28 wrote) and the real publisher (with scoring). */
const generatedAt=(ms,x=input())=>JSON.stringify(rank.createRankingsSnapshot(x.ids,x.rows,new Date(ms).toISOString()));
async function publishedAt(ms,x=input()){const kv=storage();const r=await quiet(()=>rank.refreshTeamRankings({SEASON_LEADERS_KV:kv,CFBD_API_KEY:CANARY},async url=>served(x)(url),()=>ms));assert.equal(r.scoring,'published');return kv.map.get(rank.RANKINGS_SNAPSHOT_KEY);}
test('1.29.2 snapshot gate: absent or genuine prior-day generations allowed regardless of age; same-day (boundary equality) or future refuses',async()=>{
 const x=input(),raw=v=>typeof v==='string'||v===null?v:JSON.stringify(v);
 const published=await publishedAt(NOV24-DAY+5*HOUR);assert.ok(JSON.parse(published).teams['251'].rankings.scoring,'publisher fixture carries scoring');
 const allowed=[['absent',null],['legacy-factory prior day',generatedAt(NOV24-DAY+5*HOUR)],['published prior day with scoring',published],
  ['three days old',generatedAt(NOV24-3*DAY)],['ten days old (past reader max age)',generatedAt(NOV24-10*DAY)],['one ms before UTC midnight',generatedAt(NOV24-1)]];
 for(const [label,snap] of allowed){
  const kv=storage();spentDay(kv,NOV24,{snap});const c=counter(served(x));const r=await post(kv,c.fetcher,at20);
  assert.equal(r.body.status,'refreshed',label);assert.equal(r.body.admission,'legacy-2026-11-24',label);assert.equal(c.calls.length,3,label);
 }
 const valid=JSON.parse(generatedAt(NOV24-DAY+5*HOUR)),noChecked=structuredClone(valid),noTeams=structuredClone(valid);delete noChecked.checkedAt;delete noTeams.teams;
 const refused={
  'generated exactly at UTC midnight':generatedAt(NOV24),'generated same day':generatedAt(NOV24+5*HOUR),'published same day':await publishedAt(NOV24+5*HOUR),'generated future':generatedAt(NOV25+HOUR),
  'non-ISO checkedAt':{...valid,checkedAt:'Nov 23 2026'},'missing checkedAt':noChecked,'numeric checkedAt':{...valid,checkedAt:NOV24-DAY},
  'v2':{...valid,v:2},'wrong year':{...valid,year:2025},'teams array':{...valid,teams:[]},'teams missing':noTeams,'nested wrapper':{snapshot:valid},
  'array':[valid],'plain text':'last-good','empty string':'','JSON null':'null','oversize':JSON.stringify({...valid,pad:'x'.repeat(rank.RANKINGS_MAX_CHARS)}),
 };
 for(const [label,snap] of Object.entries(refused)){
  const kv=storage();spentDay(kv,NOV24,{snap:raw(snap)});const c=noEgress();const r=await post(kv,c.fetcher,at20);
  assert.deepEqual(r.body,SKIP,label);assert.equal(c.calls.length,0,label);assert.equal(opPuts(kv),0,label);
 }
 // A same-day success still refuses even if the shared recovery marker were somehow absent afterwards.
 const kv=storage();spentDay(kv,NOV24);const c=counter(served(x));assert.equal((await post(kv,c.fetcher,at20)).body.status,'refreshed');kv.map.delete(rank.RANKINGS_RECOVERY_KEY);
 assert.deepEqual((await post(kv,c.fetcher,at20+1000)).body,SKIP);assert.equal(c.calls.length,3);
});

test('1.29.2 snapshot gate: empty, incomplete or malformed v1 roster/member ranking shape refuses with zero egress',async()=>{
 const base=JSON.parse(generatedAt(NOV24-DAY+5*HOUR)),otherStamp=new Date(NOV24-2*DAY).toISOString();
 const mutate=fn=>{const s=structuredClone(base);fn(s);return JSON.stringify(s);};
 const extra=s=>{s.teams['999999']={...structuredClone(s.teams['251']),id:'999999',school:'Synthetic Extra'};};
 const cases={
  'empty teams':mutate(s=>{s.teams={};}),'137 members':mutate(s=>{delete s.teams['10000'];}),'139 members':mutate(extra),'single member':mutate(s=>{s.teams={251:s.teams['251']};}),
  'key/id mismatch':mutate(s=>{s.teams['251'].id='153';}),'numeric id':mutate(s=>{s.teams['251'].id=251;}),'non-numeric key':mutate(s=>{s.teams.abc={...s.teams['251'],id:'abc'};delete s.teams['251'];}),
  'leading-zero key':mutate(s=>{s.teams['0251']={...s.teams['251'],id:'0251'};delete s.teams['251'];}),'duplicate school':mutate(s=>{s.teams['153'].school='Texas';}),
  'missing mascot':mutate(s=>{delete s.teams['251'].mascot;}),'blank school':mutate(s=>{s.teams['251'].school=' ';}),'null member':mutate(s=>{s.teams['251']=null;}),'array member':mutate(s=>{s.teams['251']=[];}),
  'missing rankings':mutate(s=>{delete s.teams['251'].rankings;}),'member checkedAt differs':mutate(s=>{s.teams['251'].rankings.checkedAt=otherStamp;}),
  'member year 2025':mutate(s=>{s.teams['251'].rankings.year=2025;}),'member population 137':mutate(s=>{s.teams['251'].rankings.population=137;}),
  'metrics missing':mutate(s=>{delete s.teams['251'].rankings.metrics;}),'metric rank 139':mutate(s=>{s.teams['251'].rankings.metrics.totalYards.rank=139;}),
  'metric games mismatch':mutate(s=>{s.teams['251'].rankings.metrics.totalYards.games=7;}),'metric coverage inconsistent':mutate(s=>{s.teams['251'].rankings.metrics.totalYards.coverage=137;}),
  'metric tied string':mutate(s=>{s.teams['251'].rankings.metrics.totalYards.tied='yes';}),'games zero':mutate(s=>{s.teams['251'].rankings.games=0;}),
 };
 for(const [label,snap] of Object.entries(cases)){
  const kv=storage();spentDay(kv,NOV24,{snap});const c=noEgress();const r=await post(kv,c.fetcher,at20);
  assert.deepEqual(r.body,SKIP,label);assert.equal(c.calls.length,0,label);assert.equal(opPuts(kv),0,label);
 }
 // Control: the same genuine base, unmutated, is admitted.
 const kv=storage();spentDay(kv,NOV24,{snap:JSON.stringify(base)});const c=counter(served(input()));assert.equal((await post(kv,c.fetcher,at20)).body.admission,'legacy-2026-11-24');
});

test('1.29.2 operator recovery never becomes a primary: only the strict current daily marker and an unused shared marker admit',async()=>{
 const s=slotOf(NOV24);
 for(const [label,value] of [['absent',null],['previous day',String(s-1)],['future',String(s+1)],['leading zero','0'+s],['padded',` ${s}`],['decimal',`${s}.0`],['malformed','x']]){
  const kv=storage();spentDay(kv,NOV24);if(value===null)kv.map.delete(ATTEMPT);else kv.map.set(ATTEMPT,value);const c=noEgress();
  const r=await post(kv,c.fetcher,at20);assert.deepEqual(r.body,SKIP,label);assert.equal(c.calls.length,0,label);assert.equal(opPuts(kv),0,label);assert.equal(kv.map.get(ATTEMPT)??null,value,label);
 }
 for(const [label,value] of [['already consumed today',String(s)],['malformed consumption','x'],['future consumption',String(s+1)]]){
  const kv=storage();spentDay(kv,NOV24);kv.map.set(rank.RANKINGS_RECOVERY_KEY,value);const c=noEgress();
  const r=await post(kv,c.fetcher,at20);assert.deepEqual(r.body,SKIP,label);assert.equal(c.calls.length,0,label);assert.equal(kv.map.get(rank.RANKINGS_RECOVERY_KEY),value);
 }
 const x=input(),kv=storage();spentDay(kv,NOV24);kv.map.set(rank.RANKINGS_RECOVERY_KEY,String(s-1));const c=counter(served(x));
 assert.equal((await post(kv,c.fetcher,at20)).body.status,'refreshed','an earlier day\'s consumption does not block today');
});

test('1.29.2 new valid receipt, both directions: operator then scheduled17 skips; scheduled17 then operator skips',async()=>{
 const x=input(),s=slotOf(DEC2),at05d=DEC2+5*HOUR+4878,at17d=DEC2+17*HOUR+4878;
 // A real 1.29.1 scheduled 05 membership 502 mints the receipt that the operator path accepts (no legacy needed, any origin).
 const kv=storage();kv.map.set(rank.RANKINGS_SNAPSHOT_KEY,priorSnapshot(DEC2));
 const primary=await scheduledAt(kv,counter(json502).fetcher,at05d);assert.equal(primary.diagnostic.httpStatus,502);assert.ok(kv.map.has(rank.RANKINGS_ELIGIBLE_KEY));
 const calls=[],f=async url=>{assert.equal(kv.map.get(rank.RANKINGS_RECOVERY_KEY),String(s));calls.push(url);return served(x)(url);};
 const r=await post(kv,f,DEC2+11*HOUR,{origin:PREVIEW});
 assert.deepEqual([r.body.status,r.body.admission,r.body.attempt],['refreshed','receipt','recovery']);assert.deepEqual(calls,rank.RANKINGS_URLS);
 assert.equal(opPuts(kv,rank.RANKINGS_ELIGIBLE_KEY),1,'receipt not renewed');assert.equal(opPuts(kv,ATTEMPT),1,'only the scheduled primary wrote it');
 assert.deepEqual(await scheduledAt(kv,f,at17d),SKIP);assert.equal(calls.length,3);
 // Reverse direction.
 const kv2=storage();kv2.map.set(rank.RANKINGS_SNAPSHOT_KEY,priorSnapshot(DEC2));await scheduledAt(kv2,counter(json502).fetcher,at05d);
 const c2=counter(served(x)),r17=await scheduledAt(kv2,c2.fetcher,at17d);assert.equal(r17.attempt,'recovery');assert.equal(r17.admission,undefined,'scheduled result shape unchanged');assert.equal(c2.calls.length,3);
 assert.deepEqual((await post(kv2,c2.fetcher,at17d+HOUR)).body,SKIP);assert.equal(c2.calls.length,3);
 // The ordinary operator refresh still never reads the receipt.
 const kv3=storage();spentDay(kv3,DEC2,{withReceipt:dayReceipt(DEC2)});kv3.ops.length=0;
 assert.deepEqual(await quiet(()=>rank.refreshTeamRankings({SEASON_LEADERS_KV:kv3,CFBD_API_KEY:CANARY},noEgress().fetcher,()=>DEC2+11*HOUR)),SKIP);
 assert.equal(kv3.ops.some(o=>o[1]===rank.RANKINGS_ELIGIBLE_KEY||o[1]===rank.RANKINGS_RECOVERY_KEY),false);
});

test('1.29.2 failed operator recovery never renews or mints; the day stays consumed for operator and scheduled paths',async()=>{
 const x=input();
 for(const [label,answer] of [['membership502 again',json502],['stats502',url=>url===rank.RANKINGS_URLS[1]?json502():served(x)(url)],['transport',()=>{throw Error(CANARY);}]]){
  const kv=storage();spentDay(kv,NOV24);const before=kv.map.get(rank.RANKINGS_SNAPSHOT_KEY),c=counter(answer);
  const r=await post(kv,c.fetcher,at20);
  assert.equal(r.status,503,label);assert.deepEqual([r.body.status,r.body.reason,r.body.attempt,r.body.admission],['failed','source-unavailable','recovery','legacy-2026-11-24'],label);
  assert.ok(Object.keys(r.body.diagnostic).every(k=>['stage','reason','httpStatus'].includes(k)));assert.ok(!JSON.stringify(r.body).includes(CANARY));
  assert.equal(opPuts(kv,rank.RANKINGS_ELIGIBLE_KEY),0,label);assert.equal(opPuts(kv,ATTEMPT),0,label);assert.equal(kv.map.get(rank.RANKINGS_SNAPSHOT_KEY),before,'last good kept');
  const n=c.calls.length;assert.deepEqual((await post(kv,c.fetcher,at20+1000)).body,SKIP);assert.deepEqual(await scheduledAt(kv,c.fetcher,NOV24+17*HOUR),SKIP);assert.equal(c.calls.length,n,label);
 }
});

test('1.29.2 denial gates: legacy/common markers refuse first; a recovery denial persists the shared block and stops later products',async()=>{
 for(const marker of [shared.LEGACY_CFBD_BLOCK,shared.COMMON_CFBD_BLOCK]){
  const kv=storage();spentDay(kv,NOV24);kv.map.set(marker,'blocked');const c=noEgress();const r=await post(kv,c.fetcher,at20);
  assert.equal(r.status,409);assert.deepEqual(r.body,{status:'blocked',reason:'source-blocked'});assert.equal(c.calls.length,0);assert.equal(opPuts(kv),0);
  assert.equal(kv.ops.some(o=>o[1]===ATTEMPT||o[1]===rank.RANKINGS_ELIGIBLE_KEY),false,'denial checked before admission state');
 }
 for(const [label,answer] of [['403 html',()=>new Response('',{status:403,headers:{'content-type':'text/html'}})],['429',()=>new Response('',{status:429})],['html502',()=>new Response('<html>'+CANARY,{status:502,headers:{'content-type':'text/html'}})]]){
  const kv=storage();spentDay(kv,NOV24);const before=kv.map.get(rank.RANKINGS_SNAPSHOT_KEY),c=counter(answer);const r=await post(kv,c.fetcher,at20);
  assert.equal(r.status,409,label);assert.deepEqual([r.body.status,r.body.attempt],['blocked','recovery']);assert.ok(kv.map.has(shared.COMMON_CFBD_BLOCK));assert.equal(kv.map.get(rank.RANKINGS_SNAPSHOT_KEY),before);assert.equal(c.calls.length,1);
  assert.equal((await leader.refreshSeasonLeaders({SEASON_LEADERS_KV:kv,CFBD_API_KEY:CANARY},c.fetcher,()=>at20)).status,'blocked');assert.equal(c.calls.length,1);
 }
});

test('1.29.2 storage faults before egress return storage-unavailable with zero source calls and no reservation',async()=>{
 for(const [label,stage,fault] of [['block read','block-read',k=>k===shared.COMMON_CFBD_BLOCK],['attempt read','attempt-read',k=>k===ATTEMPT],['receipt read','recovery-read',k=>k===rank.RANKINGS_ELIGIBLE_KEY],['consumption read','recovery-read',k=>k===rank.RANKINGS_RECOVERY_KEY],['snapshot read','recovery-read',k=>k===rank.RANKINGS_SNAPSHOT_KEY]]){
  const kv=storage(),get=kv.get.bind(kv);spentDay(kv,NOV24);kv.get=async k=>{if(fault(k))throw Error(CANARY);return get(k);};const c=noEgress();
  const r=await post(kv,c.fetcher,at20);assert.equal(r.status,503,label);assert.deepEqual(r.body.diagnostic,{stage,reason:'storage-unavailable'},label);assert.equal(c.calls.length,0,label);assert.equal(kv.map.has(rank.RANKINGS_RECOVERY_KEY),false,label);assert.ok(!JSON.stringify(r.body).includes(CANARY));
 }
 const kv=storage(),put=kv.put.bind(kv);spentDay(kv,NOV24);kv.put=async(k,v)=>{if(k===rank.RANKINGS_RECOVERY_KEY)throw Error(CANARY);return put(k,v);};const c=noEgress();
 const r=await post(kv,c.fetcher,at20);assert.equal(r.status,503);assert.deepEqual(r.body.diagnostic,{stage:'recovery-write',reason:'storage-unavailable'});assert.equal(c.calls.length,0);
 const missing=await rank.handleRankingsRecovery(opRequest(),{SEASON_LEADERS_KV:storage(),CFBD_REFRESH_TOKEN:OP_TOKEN},noEgress().fetcher,()=>at20);
 assert.equal(missing.status,503);assert.deepEqual(await missing.json(),{status:'failed',reason:'configuration'});
});

test('1.29.2 scheduled behaviour unchanged: the legacy Nov 24 state still gives the scheduled 17 nothing',async()=>{
 const kv=storage();spentDay(kv,NOV24);const c=noEgress();
 assert.deepEqual(await scheduledAt(kv,c.fetcher,NOV24+17*HOUR+4878),SKIP);assert.equal(c.calls.length,0);assert.equal(opPuts(kv),0);
});
