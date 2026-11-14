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
