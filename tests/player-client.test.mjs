import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync}from'node:fs';import {bundle}from'./helpers.mjs';
const C=await bundle('lib/player-season-client.ts');const F=JSON.parse(readFileSync(new URL('./fixtures/player-pages.json',import.meta.url),'utf8'));const r={id:'4870906',team:'251',anchorYear:2026,year:2024};const json=v=>new Response(JSON.stringify(v),{headers:{'content-type':'application/json'}});
test('player client uses only fixed same-origin API, exact anchor/year identity and bounded response; no provider fallback',async()=>{
 const calls=[];let body=F.subjects['4870906:2024'];const fetcher=async(url,init)=>{calls.push([url,init]);return json(body)};
 const ok=await C.loadPlayerSeason(r,new AbortController().signal,fetcher);assert.equal(ok.kind,'ok');assert.equal(ok.season.year,2024);const u=new URL(calls[0][0],'https://app.test');assert.equal(u.pathname,'/api/player');assert.equal(u.searchParams.get('anchorYear'),'2026');assert.equal(u.searchParams.get('year'),'2024');assert.equal(calls[0][1].mode,'same-origin');
 for(const changed of [{year:2026},{id:'4592532'},{anchor:{team:'153',year:2026}}]){body={...F.subjects['4870906:2024'],...changed};assert.equal((await C.loadPlayerSeason(r,new AbortController().signal,fetcher)).kind,'failed')}
 assert.equal((await C.loadPlayerSeason(r,new AbortController().signal,async()=>new Response('x'.repeat(500001)))).reason,'invalid');
 let n=0;assert.equal((await C.loadPlayerSeason(r,new AbortController().signal,async()=>{n++;return new Response('',{status:503})})).reason,'unavailable');assert.equal(n,1);
 const controller=new AbortController();controller.abort();await assert.rejects(C.loadPlayerSeason(r,controller.signal,async()=>{throw Error('must not fetch')}),{name:'AbortError'});
});
