import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions,Response as SyntheticResponse} from 'miniflare';
const root=fileURLToPath(new URL('..',import.meta.url));
const fixture=n=>JSON.parse(readFileSync(new URL(`./fixtures/cfbd-${n}.json`,import.meta.url),'utf8'));
const sources=[fixture('03-fbs-identities'),...['11-national-passing','12-national-rushing','13-national-receiving'].map(fixture)];

test('native workerd publisher+KV binding parses minimized real payloads; public reader has zero egress and denied source stays blocked', {timeout:30000},async()=>{
 const output=await build({stdin:{contents:`import {readSeasonLeaders} from './lib/cfbd-season-leaders.ts';
 import {POST} from './app/api/internal/season-leaders-refresh/route.ts';
 export default {async fetch(request,env){const url=new URL(request.url);if(url.pathname==='/refresh')return POST(new Request(request.url,{method:'POST',headers:{Authorization:'Bearer test-admin'}}));return Response.json(await readSeasonLeaders(env.SEASON_LEADERS_KV,'251',2026,'Texas Longhorns','Texas'));}}`,resolveDir:root,loader:'ts'},bundle:true,platform:'browser',format:'esm',write:false,external:['cloudflare:workers']});
 let calls=[],deny=false;
 const outboundService=request=>{calls.push(request.url);assert.equal(request.headers.get('authorization'),'Bearer synthetic-test-secret');
  if(deny)return new SyntheticResponse('<html>',{status:403,headers:{'content-type':'text/html'}});
  const category=new URL(request.url).searchParams.get('category'),index=category?['passing','rushing','receiving'].indexOf(category)+1:0;
  return new SyntheticResponse(JSON.stringify(sources[index]),{headers:{'content-type':'application/json'}});
 };
 const mf=new Miniflare(convertV4MiniflareOptions({name:'cfbd-offline',script:output.outputFiles[0].text,modules:true,kvNamespaces:['SEASON_LEADERS_KV'],bindings:{CFBD_API_KEY:'synthetic-test-secret',CFBD_REFRESH_TOKEN:'test-admin'},compatibilityDate:'2026-09-01',compatibilityFlags:['nodejs_compat'],cf:false,telemetry:{enabled:false},outboundService}));
 try{
  assert.equal(await(await mf.dispatchFetch('https://worker.invalid/read')).json(),null);assert.equal(calls.length,0);
  const result=await(await mf.dispatchFetch('https://worker.invalid/refresh')).json();assert.equal(result.status,'refreshed');assert.equal(result.teams,3);assert.equal(calls.length,4);
  const leaders=await(await mf.dispatchFetch('https://worker.invalid/read')).json();assert.equal(leaders.passingYards.yards,1298);assert.equal(leaders.rushingYards.name,'Daylan Smothers');assert.equal(calls.length,4);
  assert.equal((await(await mf.dispatchFetch('https://worker.invalid/refresh')).json()).status,'skipped');assert.equal(calls.length,4);
  const kv=await mf.getKVNamespace('SEASON_LEADERS_KV');await kv.delete('season-leaders:v1:2026:regular:attempt');deny=true;
  assert.equal((await(await mf.dispatchFetch('https://worker.invalid/refresh')).json()).status,'blocked');assert.equal(calls.length,5);
  await kv.delete('season-leaders:v1:2026:regular:attempt');assert.equal((await(await mf.dispatchFetch('https://worker.invalid/refresh')).json()).status,'blocked');assert.equal(calls.length,5);
 }finally{await mf.dispose();}
});
