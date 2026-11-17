import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bundle } from './helpers.mjs';
const S=await bundle('lib/leaders-browser-server.ts'), M=await bundle('lib/leaders-browser.ts'), C=await bundle('lib/cfbd-season-leaders.ts');
const F=year=>JSON.parse(readFileSync(new URL(`./fixtures/leaders-browser-${year}.json`,import.meta.url),'utf8'));
const T=Date.parse('2026-09-06T03:59:00Z'), stamp=new Date(T).toISOString();
const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
function storage(){const map=new Map(),writes=[];return {map,writes,async get(k){return map.get(k)??null;},async put(k,v){writes.push(k);map.set(k,v);}};}
function rawSchedule(year) {
  const s=F(year).snapshot; return {team:{id:'150'},requestedSeason:{year,type:2},events:s.privacy.games.map(g=>({id:g.id,date:g.date,season:{year},seasonType:{type:2},competitions:[{date:g.date,neutralSite:g.neutralSite,status:{period:g.started?4:0,type:{name:g.state==='final'?'STATUS_FINAL':'STATUS_SCHEDULED',state:g.state==='final'?'post':'pre',completed:g.state==='final'}},competitors:g.teams.map(t=>({homeAway:t.homeAway,team:{id:t.id,shortDisplayName:t.name}}))}]}))};
}
test('current browser publication reuses the admitted exact four CFBD responses and retains legacy maxima/slot',async()=>{
 const kv=storage(),f=F(2026),calls=[];
 const fetcher=async(url,init)=>{calls.push(url);assert.equal(init.headers.Authorization,'Bearer synthetic-secret');return json([f.identities,...f.categories][C.CFBD_URLS.indexOf(url)]);};
 const env={SEASON_LEADERS_KV:kv,CFBD_API_KEY:'synthetic-secret'};
 const r=await C.refreshSeasonLeaders(env,fetcher,()=>T);assert.equal(r.status,'refreshed');assert.equal(r.browser,'published');assert.deepEqual(calls,C.CFBD_URLS);assert.ok(kv.map.has(C.SNAPSHOT_KEY));assert.ok(kv.map.has(M.browserSnapshotKey(2026)));
 assert.equal((await C.refreshSeasonLeaders(env,fetcher,()=>T)).status,'skipped');assert.equal(calls.length,4);
});
test('fixed historical bootstrap and score-free schedules reserve before source, stop repeat calls, public reads are KV only',async()=>{
 const kv=storage(),f=F(2025),calls=[]; const env={SEASON_LEADERS_KV:kv,CFBD_API_KEY:'synthetic-secret'};
 const fetcher=async(url,init)=>{calls.push(url);const u=new URL(url);if(u.hostname==='api.collegefootballdata.com'){assert.ok(kv.map.has('leaders-browser:v1:2025:attempt'));assert.equal(init.headers.Authorization,'Bearer synthetic-secret');return json(u.pathname==='/teams/fbs'?f.identities:f.categories[['passing','rushing','receiving'].indexOf(u.searchParams.get('category'))]);} assert.equal(init.headers.Authorization,undefined);return json(rawSchedule(Number(u.searchParams.get('season'))));};
 assert.equal((await S.refreshBrowserSources(env,fetcher,()=>T)).status,'refreshed');assert.equal(calls.length,6);assert.equal(calls.filter(u=>u.includes('collegefootballdata.com')).length,4);assert.equal(calls.some(u=>u.includes('collegefootballdata.com')&&u.includes('2026')),false);
 assert.equal((await S.refreshBrowserSources(env,fetcher,()=>T)).status,'skipped');assert.equal(calls.length,6);
 const snap=await S.readBrowserSnapshot(kv,2025,T);assert.ok(snap.privacy);assert.equal(snap.privacy.games[0].teams[0].score,undefined);assert.equal(calls.length,6);assert.equal((await S.browserCatalog(kv,2025,T)).find(t=>t.id==='326').name,'Texas State');
});
test('source denial persists shared stop and cancels all remaining work; last good data is not replaced',async()=>{
 for(const response of [()=>new Response('',{status:401}),()=>new Response('',{status:403}),()=>new Response('',{status:429}),()=>new Response('<html>',{headers:{'content-type':'text/html'}})]){
  const kv=storage(),old=structuredClone(F(2025).snapshot);old.checkedAt=new Date(T-31*86400000).toISOString();old.privacy.checkedAt=old.checkedAt;kv.map.set(M.browserSnapshotKey(2025),JSON.stringify(old));let calls=0;const env={SEASON_LEADERS_KV:kv,CFBD_API_KEY:'synthetic-secret'};const fetcher=async(url)=>{calls++;assert.equal(new URL(url).hostname,'api.collegefootballdata.com');return response();};
  assert.ok(M.parseLeadersSnapshot(old,2025,T),'last good historical source is valid but past30day refresh lifetime');assert.equal((await S.refreshBrowserSources(env,fetcher,()=>T)).status,'blocked');assert.equal(calls,1);assert.ok(kv.map.has('cfbd:v1:blocked'));assert.equal(kv.map.has('leaders-browser:v1:espn-blocked'),false);assert.equal((await S.refreshBrowserSources(env,fetcher,()=>T+40*86400000)).status,'blocked');assert.equal(calls,1);assert.equal(JSON.parse(kv.map.get(M.browserSnapshotKey(2025))).checkedAt,old.checkedAt);
 }
});
test('authentication precedes storage/source and fixed route rejects body/query; newer totals cannot use older upcoming privacy',async()=>{
 const kv=storage();let calls=0;const env={SEASON_LEADERS_KV:kv,CFBD_API_KEY:'synthetic-secret',CFBD_REFRESH_TOKEN:'synthetic-admin'};const fetcher=async()=>{calls++;throw Error();};
 assert.equal((await S.handleBrowserRefresh(new Request('https://app.test/api/internal/leaders-browser-refresh',{method:'POST'}),env,fetcher)).status,401);assert.equal(kv.writes.length,0);assert.equal(calls,0);
 for(const url of ['https://app.test/api/internal/leaders-browser-refresh?year=2026'])assert.equal((await S.handleBrowserRefresh(new Request(url,{method:'POST',headers:{Authorization:'Bearer synthetic-admin'}}),env,fetcher)).status,400);
 const snap=structuredClone(F(2026).snapshot);snap.checkedAt=new Date(T+1000).toISOString();snap.privacy=null;kv.map.set(M.browserSnapshotKey(2026),JSON.stringify(snap));kv.map.set('leaders-browser:v1:2026:privacy',JSON.stringify(F(2026).snapshot.privacy));assert.equal((await S.readBrowserSnapshot(kv,2026,T+1000)).privacy,null);
});
test('selected-year verified membership constrains historical anchors before source and does not trust a current-only canonical team',async()=>{
 const P=await bundle('lib/player-season-server.ts'),kv=storage();kv.map.set(C.SNAPSHOT_KEY,JSON.stringify({v:1,year:2026,teams:{'275':{id:'275',school:'Wisconsin'},'251':{id:'251',school:'Texas'}}}));kv.map.set(M.browserSnapshotKey(2025),JSON.stringify(F(2025).snapshot));let calls=0;
 const service=P.createPlayerSeasonService({SEASON_LEADERS_KV:kv,CFBD_API_KEY:'synthetic-secret'},async()=>{calls++;throw Error();},()=>T);
 const result=await service.get({id:'4870906',team:'275',anchorYear:2025,year:2025});assert.equal(result.status,400);assert.equal(result.error,'identity-context');assert.equal(calls,0);
});
test('known ESPN schedule denial stays distinct from CFBD and marker-write failure preserves the known denial',async()=>{
 for(const writeFailure of [false,true]){
  const kv=storage(),put=kv.put.bind(kv),f=F(2025);let calls=0;
  kv.put=async(k,v)=>{if(writeFailure&&k==='leaders-browser:v1:espn-blocked')throw Error('private-marker-canary');return put(k,v);};
  const fetcher=async(url,init)=>{calls++;const u=new URL(url);if(u.hostname==='api.collegefootballdata.com')return json(u.pathname==='/teams/fbs'?f.identities:f.categories[['passing','rushing','receiving'].indexOf(u.searchParams.get('category'))]);assert.equal(init.headers.Authorization,undefined);return new Response('',{status:403});};
  const env={SEASON_LEADERS_KV:kv,CFBD_API_KEY:'synthetic-secret'};const result=await S.refreshBrowserSources(env,fetcher,()=>T);
  assert.deepEqual(result,{status:writeFailure?'failed':'blocked',reason:writeFailure?'storage-unavailable':'source-blocked',source:'espn-schedule',sourceBlocked:true,httpStatus:403});assert.equal(calls,5);assert.equal(kv.map.has('cfbd:v1:blocked'),false);assert.equal(JSON.stringify(result).includes('private-marker-canary'),false);
  if(!writeFailure){assert.equal((await S.refreshBrowserSources(env,fetcher,()=>T+40*86400000)).status,'blocked');assert.equal(calls,5);}
 }
});
test('failed non-denial historical bootstrap keeps daily pacing; valid good history skips new CFBD calls for30days',async()=>{
 const kv=storage(),f=F(2025),calls=[];let failOnce=true;
 const fetcher=async(url)=>{calls.push(url);const u=new URL(url);if(u.hostname==='api.collegefootballdata.com'){if(failOnce){failOnce=false;return new Response('',{status:503});}return json(u.pathname==='/teams/fbs'?f.identities:f.categories[['passing','rushing','receiving'].indexOf(u.searchParams.get('category'))]);}return json(rawSchedule(Number(u.searchParams.get('season'))));};
 const env={SEASON_LEADERS_KV:kv,CFBD_API_KEY:'synthetic-secret'},cfbd=()=>calls.filter(u=>u.includes('api.collegefootballdata.com')).length;
 assert.equal((await S.refreshBrowserSources(env,fetcher,()=>T)).status,'failed');assert.equal(cfbd(),1);const originalAttempt=kv.map.get('leaders-browser:v1:2025:attempt');
 await S.refreshBrowserSources(env,fetcher,()=>T+3600000);assert.equal(cfbd(),1);assert.equal(kv.map.get('leaders-browser:v1:2025:attempt'),originalAttempt);
 assert.equal((await S.refreshBrowserSources(env,fetcher,()=>T+86400000)).status,'refreshed');assert.equal(cfbd(),5);assert.equal((await S.readBrowserSnapshot(kv,2025,T+86400000)).checkedAt,new Date(T+86400000).toISOString());
 await S.refreshBrowserSources(env,fetcher,()=>T+2*86400000);assert.equal(cfbd(),5,'fresh valid historical data avoids provider calls despite daily failed-attempt cadence');
});
