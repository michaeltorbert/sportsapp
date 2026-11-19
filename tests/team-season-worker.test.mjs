import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions,Response as SyntheticResponse} from 'miniflare';
const root=fileURLToPath(new URL('..',import.meta.url));
const fixture=n=>JSON.parse(readFileSync(new URL(`./fixtures/cfbd-${n}.json`,import.meta.url),'utf8'));
const sources=[fixture('03-fbs-identities'),...['11-national-passing','12-national-rushing','13-national-receiving'].map(fixture)];

// npm test builds first. Real compiled team route + service + serialization, with fixed offline source answers.
test('compiled team route carries genuine regular-season detail with unchanged source request budget and cache', {timeout:20000}, async()=>{
 const moduleRoot=root+'/dist/server';const names=readdirSync(moduleRoot,{recursive:true}).filter(n=>n.endsWith('.js'));
 names.sort((a,b)=>a==='index.js'?-1:b==='index.js'?1:a.localeCompare(b));
 const modules=names.map(n=>({type:'ESModule',path:moduleRoot+'/'+n,contents:readFileSync(moduleRoot+'/'+n,'utf8')}));
 const captured=JSON.parse(readFileSync(new URL('./fixtures/espn-team-season-detail-unc-2026.json',import.meta.url),'utf8'));
 const schedule=JSON.parse(readFileSync(new URL('./fixtures/espn-team-season-unc-2026.json',import.meta.url),'utf8')).schedule;
 const base='https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams/153';
 // SYNTHETIC empty postseason; original schedule/statistic field values stay genuine.
 const replies=new Map([[base+'/schedule',schedule],[base+'/schedule?season=2026&seasontype=3',{team:{id:'153'},requestedSeason:{year:2026,type:3},events:[]}],[base+'/statistics?season=2026&seasontype=2',captured]]);
 const calls=[];
 const mf=new Miniflare(convertV4MiniflareOptions({name:'compiled-team-detail-offline',modules,modulesRoot:moduleRoot,compatibilityDate:'2026-09-01',compatibilityFlags:['nodejs_compat'],cf:false,telemetry:{enabled:false},outboundService:request=>{
  calls.push(request.url);assert.ok(replies.has(request.url),`unexpected source ${request.url}`);assert.equal(request.headers.get('authorization'),null);
  return new SyntheticResponse(JSON.stringify(replies.get(request.url)),{headers:{'content-type':'application/json'}});
 }}));
 try{
  const response=await mf.dispatchFetch('https://worker.invalid/api/team?team=153');assert.equal(response.status,200);const result=await response.json();
  assert.equal(result.v,1);assert.equal(result.team.id,'153');assert.equal(result.season.year,2026);assert.equal(result.regular.entries.length,12);
  assert.deepEqual(result.stats.points,['25.8','22.1']);assert.equal(result.details.interceptionsMade,7);assert.equal(result.details.interceptionsThrown,7);assert.equal(result.details.sacksMade,19);assert.equal(result.details.sacksAllowed,26);
  assert.deepEqual(result.details.thirdDown,{offense:{converted:58,attempted:125},allowed:{converted:65,attempted:149}});assert.ok(Number.isFinite(Date.parse(result.details.checkedAt)));
  assert.deepEqual([...calls].sort(),[...replies.keys()].sort());
  const second=await(await mf.dispatchFetch('https://worker.invalid/api/team?team=153')).json();assert.deepEqual(second.details,result.details);assert.equal(calls.length,3);
 }finally{await mf.dispose();}
});

test('native workerd publisher+KV binding parses minimized real payloads; public reader has zero egress and denied source stays blocked', {timeout:30000},async()=>{
 const output=await build({stdin:{contents:`import {readSeasonLeaders} from './lib/cfbd-season-leaders.ts';
 import {POST} from './app/api/internal/season-leaders-refresh/route.ts';
 export default {async fetch(request,env){const url=new URL(request.url);if(url.pathname==='/refresh')return POST(request);return Response.json(await readSeasonLeaders(env.SEASON_LEADERS_KV,'251',2026,'Texas Longhorns','Texas'));}}`,resolveDir:root,loader:'ts'},bundle:true,platform:'browser',format:'esm',write:false,external:['cloudflare:workers']});
 let calls=[],deny=false;
 const outboundService=request=>{calls.push(request.url);assert.equal(request.headers.get('authorization'),'Bearer synthetic-test-secret');
  if(deny)return new SyntheticResponse('<html>',{status:403,headers:{'content-type':'text/html'}});
  const category=new URL(request.url).searchParams.get('category'),index=category?['passing','rushing','receiving'].indexOf(category)+1:0;
  return new SyntheticResponse(JSON.stringify(sources[index]),{headers:{'content-type':'application/json'}});
 };
 const mf=new Miniflare(convertV4MiniflareOptions({name:'cfbd-offline',script:output.outputFiles[0].text,modules:true,kvNamespaces:['SEASON_LEADERS_KV'],bindings:{CFBD_API_KEY:'synthetic-test-secret',CFBD_REFRESH_TOKEN:'test-admin'},compatibilityDate:'2026-09-01',compatibilityFlags:['nodejs_compat'],cf:false,telemetry:{enabled:false},outboundService}));
 try{
  assert.equal(await(await mf.dispatchFetch('https://worker.invalid/read')).json(),null);assert.equal(calls.length,0);
  const result=await(await mf.dispatchFetch('https://worker.invalid/refresh',{method:'POST',headers:{Authorization:'Bearer test-admin'}})).json();assert.equal(result.status,'refreshed');assert.equal(result.teams,3);assert.equal(calls.length,4);
  const leaders=await(await mf.dispatchFetch('https://worker.invalid/read')).json();assert.equal(leaders.passingYards.yards,1298);assert.equal(leaders.rushingYards.name,'Daylan Smothers');assert.equal(calls.length,4);
  assert.equal((await(await mf.dispatchFetch('https://worker.invalid/refresh',{method:'POST',headers:{Authorization:'Bearer test-admin'}})).json()).status,'skipped');assert.equal(calls.length,4);
  const kv=await mf.getKVNamespace('SEASON_LEADERS_KV');await kv.delete('season-leaders:v1:2026:regular:attempt');deny=true;
  assert.equal((await(await mf.dispatchFetch('https://worker.invalid/refresh',{method:'POST',headers:{Authorization:'Bearer test-admin'}})).json()).status,'blocked');assert.equal(calls.length,5);
  await kv.delete('season-leaders:v1:2026:regular:attempt');assert.equal((await(await mf.dispatchFetch('https://worker.invalid/refresh',{method:'POST',headers:{Authorization:'Bearer test-admin'}})).json()).status,'blocked');assert.equal(calls.length,5);
 }finally{await mf.dispose();}
});

// npm test builds first. This regression uses that actual compiled entry/router, not a route wrapper.
test('full compiled vinext entry accepts a real transport-empty authenticatedPOST withoutOrigin; rejects nonempty body offline',{timeout:20000},async()=>{
 const moduleRoot=root+'/dist/server';const names=readdirSync(moduleRoot,{recursive:true}).filter(n=>n.endsWith('.js'));
 names.sort((a,b)=>a==='index.js'?-1:b==='index.js'?1:a.localeCompare(b));
 const modules=names.map(n=>({type:'ESModule',path:moduleRoot+'/'+n,contents:readFileSync(moduleRoot+'/'+n,'utf8')}));let calls=0;
 const mf=new Miniflare(convertV4MiniflareOptions({name:'full-vinext-refresh-offline',modules,modulesRoot:moduleRoot,kvNamespaces:['SEASON_LEADERS_KV'],bindings:{CFBD_REFRESH_TOKEN:'synthetic-admin-only'},compatibilityDate:'2026-09-01',compatibilityFlags:['nodejs_compat'],cf:false,telemetry:{enabled:false},outboundService:()=>{calls++;return new SyntheticResponse('offline fixture denies all egress',{status:599});}}));
 try{
  const url='https://saturday-signal-preview.scythe-wildflower.workers.dev/api/internal/season-leaders-refresh';
  assert.equal((await mf.dispatchFetch(url,{method:'POST'})).status,401);
  const headers={Authorization:'Bearer synthetic-admin-only'};
  const response=await mf.dispatchFetch(url,{method:'POST',headers});assert.equal(response.status,503);assert.deepEqual(await response.json(),{status:'failed',reason:'configuration'},'empty stream reaches publisher, sourcekey intentionally absent');
  assert.equal((await mf.dispatchFetch(url,{method:'POST',headers,body:'x'})).status,400);
  assert.equal((await mf.dispatchFetch(url+'?force=1',{method:'POST',headers})).status,400);
  assert.equal(calls,0,'compiled entry checks never issue source requests');
 }finally{await mf.dispose();}
});

// Bundle the actual scheduled source, replacing only vinext's unrelated fetch renderer.
// Fake KV failures are deliberately confined to this process; no real bindings or egress.
test('actual scheduled source stops rankings after failed leader snapshot write or known denial+failed block persistence',async()=>{
 const output=await build({entryPoints:[root+'/worker/index.ts'],bundle:true,platform:'browser',format:'esm',write:false,plugins:[{name:'offline-fetch-renderer-only',setup(b){b.onResolve({filter:/^vinext\/server\/app-router-entry$/},()=>({path:'offline-app',namespace:'offline'}));b.onLoad({filter:/.*/,namespace:'offline'},()=>({contents:'export default {fetch(){return new Response("offline")}}',loader:'js'}));}}]});
 const worker=(await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'))).default;
 for(const failing of ['snapshot','common-block','legacy-block']){
  const map=new Map([['season-leaders:v1:2026:regular','last-good']]),logs=[];let calls=0;
  const failKey=failing==='snapshot'?'season-leaders:v1:2026:regular':failing==='common-block'?'cfbd:v1:blocked':'season-leaders:v1:2026:regular:blocked';
  const kv={async get(k){return map.get(k)??null;},async put(k,v){if(k===failKey)throw Error('private-worker-canary');map.set(k,v);}};
  const savedFetch=globalThis.fetch,savedLog=console.log;
  globalThis.fetch=async()=>{const i=calls++;return failing==='snapshot'?Response.json(sources[i]):new Response('',{status:403});};
  console.log=line=>logs.push(JSON.parse(line));
  try{
   let task;worker.scheduled({cron:'0 5,17 * * *'},{SEASON_LEADERS_KV:kv,CFBD_API_KEY:'private-worker-canary'},{waitUntil(p){task=p;}});await task;
   assert.equal(calls,failing==='snapshot'?4:1);assert.equal(logs.length,1);assert.equal(logs[0].event,'season_leaders_refresh');assert.equal(logs[0].reason,'storage-unavailable');assert.equal(logs[0].diagnostic.stage,failing==='snapshot'?'snapshot-write':'block-write');assert.equal(logs[0].diagnostic.sourceBlocked,failing==='snapshot'?undefined:true);assert.equal(logs[0].diagnostic.httpStatus,failing==='snapshot'?undefined:403);assert.equal(map.get('season-leaders:v1:2026:regular'),'last-good');assert.ok(!JSON.stringify(logs).includes('private-worker-canary'));assert.equal(map.has('team-rankings:v1:2026:attempt'),false);
  }finally{globalThis.fetch=savedFetch;console.log=savedLog;}
 }
});

// npm test builds first. Exercise the exact emitted scheduled hook, not a hand-written wrapper.
test('full compiled scheduled entry publishes shared leaders with isolated KV, no player pack and zero repeat-slot egress',{timeout:30000},async()=>{
 const moduleRoot=root+'/dist/server';const names=readdirSync(moduleRoot,{recursive:true}).filter(n=>n.endsWith('.js'));
 names.sort((a,b)=>a==='index.js'?-1:b==='index.js'?1:a.localeCompare(b));
 const modules=names.map(n=>({type:'ESModule',path:moduleRoot+'/'+n,contents:readFileSync(moduleRoot+'/'+n,'utf8')}));let calls=[];
 const yearFixture=year=>JSON.parse(readFileSync(new URL(`./fixtures/leaders-browser-${year}.json`,import.meta.url),'utf8'));
 const schedule=year=>({team:{id:'150'},requestedSeason:{year,type:2},events:yearFixture(year).snapshot.privacy.games.map(g=>({id:g.id,date:g.date,season:{year},seasonType:{type:2},competitions:[{date:g.date,timeValid:g.timeValid,neutralSite:g.neutralSite,status:{period:g.started?4:0,type:{name:g.state==='final'?'STATUS_FINAL':'STATUS_SCHEDULED',state:g.state==='final'?'post':'pre',completed:g.state==='final'}},competitors:g.teams.map(t=>({homeAway:t.homeAway,team:{id:t.id,shortDisplayName:t.name}}))}]}))});
 const mf=new Miniflare(convertV4MiniflareOptions({name:'compiled-scheduled-offline',modules,modulesRoot:moduleRoot,kvNamespaces:['SEASON_LEADERS_KV'],bindings:{CFBD_API_KEY:'synthetic-scheduled-only'},compatibilityDate:'2026-09-01',compatibilityFlags:['nodejs_compat'],cf:false,telemetry:{enabled:false},outboundService:request=>{
  calls.push(request.url);const url=new URL(request.url);
  if(url.hostname==='api.collegefootballdata.com'){
   assert.equal(request.headers.get('authorization'),'Bearer synthetic-scheduled-only');const year=Number(url.searchParams.get('year'));assert.ok([2025,2026].includes(year));const f=yearFixture(year),category=url.searchParams.get('category');
   assert.ok(url.pathname==='/teams/fbs'||url.pathname==='/stats/player/season');if(category)assert.equal(url.searchParams.get('seasonType'),'regular');
   return new SyntheticResponse(JSON.stringify(category?f.categories[['passing','rushing','receiving'].indexOf(category)]:f.identities),{headers:{'content-type':'application/json'}});
  }
  assert.equal(url.hostname,'site.api.espn.com');assert.equal(request.headers.get('authorization'),null,'never forward source bearer to ESPN');assert.equal(url.pathname,'/apis/site/v2/sports/football/college-football/teams/150/schedule');assert.equal(url.searchParams.get('seasontype'),'2');
  return new SyntheticResponse(JSON.stringify(schedule(Number(url.searchParams.get('season')))),{headers:{'content-type':'application/json'}});
 }}));
 try{
  const kv=await mf.getKVNamespace('SEASON_LEADERS_KV');
  await kv.put('team-rankings:v1:2026:attempt',String(Math.floor(Date.now()/86400000)));
  const worker=await mf.getWorker();
  await worker.scheduled({scheduledTime:Date.now(),cron:'0 5,17 * * *'});
  const raw=await kv.get('season-leaders:v1:2026:regular');assert.ok(raw);const published=JSON.parse(raw);
  assert.equal(published.teams['251'].leaders.passingYards.name,'Arch Manning');assert.equal(published.teams['251'].leaders.passingYards.yards,2201);assert.equal(Object.keys(published.teams).length,9);assert.ok(!raw.includes('sourceTiming'));assert.ok(!raw.includes('diagnostic'));
  const expected=[...[2026,2025].flatMap(year=>[`https://api.collegefootballdata.com/teams/fbs?year=${year}`,...['passing','rushing','receiving'].map(category=>`https://api.collegefootballdata.com/stats/player/season?year=${year}&category=${category}&seasonType=regular`)]),...[2025,2026].map(year=>`https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams/150/schedule?season=${year}&seasontype=2`)];assert.deepEqual(calls,expected,'one original current batch, one new historical batch, two distinct privacy schedules');
  for(const year of [2025,2026]){
   const response=await mf.dispatchFetch(`https://worker.invalid/api/leaders?season=${year}&category=passing&conference=all&team=251&page=1`);assert.equal(response.status,200);const result=await response.json();assert.equal(result.snapshot.year,year);assert.ok(result.snapshot.privacy.games.length>0);assert.equal(result.snapshot.tables.passing.find(r=>r.id==='4870906'&&r.team==='251').yards,year===2025?2942:2201);
  }
  assert.equal((await kv.list()).keys.some(k=>k.name.startsWith('player:v1:pack:')),false,'national publication does not fetch player packs');
  await worker.scheduled({scheduledTime:Date.now(),cron:'0 5,17 * * *'});assert.deepEqual(calls,expected,'same current slot, historical admission and privacy slots make zero repeated source calls');
 }finally{await mf.dispose();}
});
