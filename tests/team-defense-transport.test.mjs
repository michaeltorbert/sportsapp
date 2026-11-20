// #181 same-origin team-defense loader: bounded size, schema, exact team/year, status mapping, abort.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {bundle} from './helpers.mjs';
const U=await bundle('lib/use-team-defense.ts'),S=await bundle('lib/player-season-server.ts');
const F=JSON.parse(readFileSync(new URL('./fixtures/team-defense-source.json',import.meta.url),'utf8'));
const stamp='2026-11-20T18:00:00.000Z';
const body=JSON.parse(JSON.stringify(S.teamDefenseFromPack(S.createPlayerPack({id:'59',name:'Georgia Tech'},2026,F.stats['59'],F.games['59'],F.boxes['59'],stamp),false)));
const respond=(value,status=200)=>async(url,init)=>{
 assert.equal(new URL(url,'https://local.test').pathname,'/api/team-defense');assert.equal(init.mode,'same-origin');assert.equal(init.cache,'no-store');
 assert.deepEqual(Object.fromEntries(new URL(url,'https://local.test').searchParams),{team:'59',year:'2026'});
 return new Response(typeof value==='string'?value:JSON.stringify(value),{status,headers:{'content-type':'application/json'}});};
const load=(fetcher,team='59')=>U.loadTeamDefense(team,2026,new AbortController().signal,fetcher);
test('valid genuine response parses with every tie',async()=>{
 const r=await load(respond(body));assert.equal(r.kind,'ok');assert.equal(r.defense.families.interceptions.leaders.length,3);assert.equal(r.defense.families.sacks.leaders.length,2);
});
test('failures map without leaking: 400 invalid, 503 unavailable, bad JSON/shape/team invalid, oversize cancelled',async()=>{
 assert.deepEqual(await load(respond({error:'x'},400)),{kind:'failed',reason:'invalid'});
 assert.deepEqual(await load(respond({error:'x'},503)),{kind:'failed',reason:'unavailable'});
 assert.deepEqual(await load(respond('{not json')),{kind:'failed',reason:'invalid'});
 assert.deepEqual(await load(respond({...body,basis:'postseason'})),{kind:'failed',reason:'invalid'});
 assert.deepEqual(await load(async()=>new Response(JSON.stringify(body),{status:200})) ,{kind:'ok',defense:(await load(respond(body))).defense});
 const wrongTeam=async()=>new Response(JSON.stringify(body),{status:200});assert.deepEqual(await U.loadTeamDefense('259',2026,new AbortController().signal,wrongTeam),{kind:'failed',reason:'invalid'});
 const huge={...body,games:body.games,padding:'x'.repeat(400_000)};assert.deepEqual(await load(respond(huge)),{kind:'failed',reason:'invalid'});
 assert.deepEqual(await load(async()=>{throw new TypeError('offline')}),{kind:'failed',reason:'network'});
});
test('abort propagates as AbortError and never reports a result',async()=>{
 const c=new AbortController();c.abort();await assert.rejects(U.loadTeamDefense('59',2026,c.signal,respond(body)),{name:'AbortError'});
 const later=new AbortController();const pending=U.loadTeamDefense('59',2026,later.signal,(url,init)=>new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')))));
 later.abort();await assert.rejects(pending,{name:'AbortError'});
});
