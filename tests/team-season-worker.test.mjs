import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions,Response as SyntheticResponse} from 'miniflare';
const root=fileURLToPath(new URL('..',import.meta.url));
const fixture=n=>JSON.parse(readFileSync(new URL(`./fixtures/cfbd-${n}.json`,import.meta.url),'utf8'));
const sources=[fixture('03-fbs-identities'),...['11-national-passing','12-national-rushing','13-national-receiving'].map(fixture)];

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
