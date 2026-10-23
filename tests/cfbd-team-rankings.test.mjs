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
