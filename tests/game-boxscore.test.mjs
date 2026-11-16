import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { bundle } from './helpers.mjs';
const stats = await bundle('lib/game-stats.ts');
const box = await bundle('lib/game-boxscore.ts');
const fixture = name => JSON.parse(readFileSync(new URL('./fixtures/'+name, import.meta.url), 'utf8'));
const raw = () => fixture('espn-summary-full-final.json');
const checked = '2026-11-15T22:41:48.637Z';
const normalize = value => stats.normalizeGameStats(value, value.header.id, checked);
const oracleBytes = readFileSync(new URL('./fixtures/game-stats-v124.ts.txt', import.meta.url));
assert.equal(createHash('sha256').update(oracleBytes).digest('hex'), '56ea286110a145fc471dd483de5dd585affaf513e649fb1e75f4ca5ebbf7ae84');
const compiled = await build({ stdin: { contents: oracleBytes.toString(), resolveDir: fileURLToPath(new URL('../lib/', import.meta.url)), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
const old = await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const sourceCategory = (value, side, category) => value.boxscore.players[side].statistics.find(c => c.name === category);
const get = (value, side, category) => value.boxscore.teams[side].categories[category];

test('genuine full final derivative matches provenance and all 74 source rows, values and independent totals', () => {
 const value = raw(), snapshot = normalize(value), p = fixture('espn-summary-full-provenance.json');
 const bytes = readFileSync(new URL('./fixtures/espn-summary-full-final.json',import.meta.url));
 assert.equal(createHash('sha256').update(bytes).digest('hex'),p.fixtureSha256);
 assert.equal(p.frozenOracle.sha256,createHash('sha256').update(oracleBytes).digest('hex'));
 assert.equal(snapshot.boxscore.partial,undefined);
 let rows=0;
 for(const [side,team] of value.boxscore.players.entries()) for(const category of box.BOX_CATEGORIES){
  const source=sourceCategory(value,side,category), result=get(snapshot,side,category), columns=box.BOX_REGISTRY[category].columns;
  assert.equal(snapshot.boxscore.teams[side].teamId,team.team.id);
  assert.equal(result.rows.length,source.athletes.length);
  rows+=result.rows.length;
  for(const [index,row] of source.athletes.entries()){
   assert.equal(result.rows[index].athleteId,row.athlete.id);
   assert.equal(result.rows[index].name,row.athlete.displayName.trim());
   assert.deepEqual(result.rows[index].values,columns.map(c=>{const i=source.keys.indexOf(c.key);return i>=0 && source.labels[i]===c.label ? row.stats[i]??null : null;}));
  }
  assert.deepEqual(result.totals,source.totals.length ? columns.map(c=>{const i=source.keys.indexOf(c.key);return i>=0 && source.labels[i]===c.label ? source.totals[i]??null : null;}) : null);
 }
 assert.equal(rows,74);
 assert.equal(get(snapshot,0,'defensive').rows[0].values[2],'1.5');
 assert.equal(get(snapshot,0,'rushing').rows.at(-1).values[1],'-3');
 assert.equal(get(snapshot,0,'rushing').rows.at(-1).values[2],'-3.0');
 assert.equal(get(snapshot,1,'kicking').rows[0].values[1],'33.0');
 assert.equal(get(snapshot,1,'kicking').totals[1],'33.3');
 assert.equal(get(snapshot,0,'passing').rows[0].values[5],null);
 assert.equal(get(snapshot,0,'interceptions').rows.length,0);
 assert.equal(get(snapshot,0,'interceptions').totals,null);
 assert.ok(stats.parseGameStats(snapshot));
 assert.ok(box.boxscoreBytes(snapshot.boxscore)<box.BOXSCORE_MAX_BYTES);
 assert.doesNotMatch(JSON.stringify(snapshot.boxscore),/headshot|jersey|pickcenter|odds|https?:/);
});

test('released 1.24 exact projection oracle for every scoring/context/extension combination and historical fixtures',()=>{
 const examples=[raw(),...['final','live','pregame'].map(n=>fixture('espn-summary-'+n+'.json'))];
 const combined={...fixture('espn-summary-final.json'),...fixture('espn-summary-scoring-final.json')};examples.push(combined);
 for(const value of examples){
  const legacy=old.normalizeGameStats(value,value.header.id,checked), current=normalize(value);
  for(const scoring of [false,true]) for(const context of [false,true]){
   const projected=stats.gameStatsForClient(current,scoring,context);
   assert.deepEqual(projected,old.gameStatsForClient(legacy,scoring,context));
   assert.equal(JSON.stringify(projected),JSON.stringify(old.gameStatsForClient(legacy,scoring,context)));
   assert.ok(old.parseGameStats(projected));assert.equal('boxscore'in projected,false);
   const expanded=stats.gameStatsForClient(current,scoring,context,true);
   assert.ok(stats.parseGameStats(expanded));assert.equal(old.parseGameStats(expanded),null);
   delete expanded.boxscore;assert.deepEqual(expanded,projected);
  }
 }
});

test('historical supplied QBR retained; key-only optional QBR preserves five final columns',()=>{
 const current=normalize(raw());assert.equal(get(current,0,'passing').rows[0].values[5],null);
 const value=fixture('espn-summary-final.json'), snapshot=normalize(value);
 for(const [side] of value.boxscore.players.entries()){
  const source=sourceCategory(value,side,'passing'), i=source.keys.indexOf('adjQBR');
  if(i>=0&&source.labels[i]==='QBR') assert.deepEqual(get(snapshot,side,'passing').rows.map(r=>r.values[5]),source.athletes.map(r=>r.stats[i] === "--" || r.stats[i] === "-" ? null : r.stats[i]));
 }
});

test('SYNTHETIC source reordering maps by confirmed keys and labels; unknown fields/categories mark partial',()=>{
 const value=raw(), category=sourceCategory(value,0,'defensive');
 for(const key of ['keys','labels','descriptions','totals']) category[key].reverse();
 category.athletes.forEach(row=>row.stats.reverse());
 assert.deepEqual(get(normalize(value),0,'defensive').rows,get(normalize(raw()),0,'defensive').rows);
 category.keys.push('newFootballStat');category.labels.push('NEW');category.descriptions.push('New stat');category.totals.push('1');category.athletes.forEach(row=>row.stats.push('1'));
 const expanded=normalize(value);assert.equal(expanded.boxscore.partial,true);assert.equal(get(expanded,0,'defensive').partial,true);
 assert.deepEqual(get(expanded,0,'defensive').rows,get(normalize(raw()),0,'defensive').rows);
 value.boxscore.players[0].statistics.push({name:'newCategory',athletes:[]});
 assert.equal(normalize(value).boxscore.partial,true);
});

test('SYNTHETIC missing, duplicate, malformed identity/alignment, invalid formats and absent totals stay explicit',()=>{
 const missing=raw();missing.boxscore.players[0].statistics=missing.boxscore.players[0].statistics.filter(c=>c.name!=='defensive');
 assert.deepEqual(get(normalize(missing),0,'defensive'),{unavailable:'missing'});
 const duplicate=raw();duplicate.boxscore.players[0].statistics.push(sourceCategory(duplicate,0,'defensive'));
 assert.deepEqual(get(normalize(duplicate),0,'defensive'),{unavailable:'malformed'});
 const identity=raw();identity.boxscore.players[0].team.id='999';assert.deepEqual(normalize(identity).boxscore,{unavailable:'identity'});
 const bad=raw();sourceCategory(bad,0,'defensive').athletes[0].athlete.id='invalid';assert.deepEqual(get(normalize(bad),0,'defensive'),{unavailable:'malformed'});
 const align=raw();sourceCategory(align,0,'defensive').labels[0]='WRONG';const a=get(normalize(align),0,'defensive');assert.equal(a.unaligned,true);assert.equal(a.rows[0].values[0],null);assert.equal(a.rows[0].values[2],'1.5');
 const invalid=raw();sourceCategory(invalid,0,'defensive').athletes[0].stats[2]='-1.5';assert.equal(get(normalize(invalid),0,'defensive').rows[0].values[2],null);
 const malformedTotals=raw();sourceCategory(malformedTotals,0,'kicking').totals.pop();const t=get(normalize(malformedTotals),0,'kicking');assert.equal(t.totalsUnaligned,true);assert.ok(t.totals.every(v=>v===null));assert.equal(t.rows[0].values[1],'100.0');
 const empty=raw();sourceCategory(empty,0,'defensive').athletes=[];sourceCategory(empty,0,'defensive').totals=[];assert.deepEqual(get(normalize(empty),0,'defensive'),{rows:[],totals:null});
});

test('SYNTHETIC extension overflow cannot change released Team, Players or Scoring admission',()=>{
 const value={...fixture('espn-summary-final.json'),...fixture('espn-summary-scoring-final.json')};
 const defensive=structuredClone(sourceCategory(raw(),0,'defensive'));
 defensive.athletes=Array.from({length:256},(_,i)=>({athlete:{id:String(100000+i),displayName:'Long participant name '.repeat(2)},stats:['100','100','100.5','100.5','100','100','100']}));
 for(const entry of value.boxscore.players) for(const name of ['defensive','kickReturns','puntReturns','kicking','punting']) entry.statistics.push({...structuredClone(defensive),name});
 const before=old.normalizeGameStats(value,value.header.id,checked), after=normalize(value);
 assert.deepEqual(after.boxscore,{unavailable:'too-large'});
 const projected=stats.gameStatsForClient(after,true,true);assert.deepEqual(projected,old.gameStatsForClient(before,true,true));
 assert.ok(stats.parseGameStats(after));
});

test('public strict canonical schema rejects shifted vectors, bad formats, identities, unknown properties and over-budget payload',()=>{
 const snapshot=normalize(raw());
 for(const mutate of [s=>get(s,0,'defensive').rows[0].values.pop(),s=>get(s,0,'defensive').rows[0].values[2]='-1',s=>s.boxscore.teams[0].teamId='201',s=>s.boxscore.extra='unexpected',s=>get(s,0,'defensive').rows.push(get(s,0,'defensive').rows[0])]){
  const changed=structuredClone(snapshot);mutate(changed);assert.equal(stats.parseGameStats(changed),null);
 }
 const tooLarge=structuredClone(snapshot);for(const team of tooLarge.boxscore.teams) for(const category of box.BOX_CATEGORIES){const data=team.categories[category];const columns=box.BOX_REGISTRY[category].columns;data.rows=Array.from({length:256},(_,i)=>({athleteId:String(100000+i),name:'N'.repeat(64),values:columns.map(()=>null)}));}
 assert.ok(box.boxscoreBytes(tooLarge.boxscore)>box.BOXSCORE_MAX_BYTES);assert.equal(stats.parseGameStats(tooLarge),null);
});

test('independent defense display survives absent team and legacy offense; old Worker and phase/identity guards remain explicit',()=>{
 const snapshot=normalize(raw());snapshot.team={unavailable:'missing'};snapshot.players={unavailable:'missing'};
 assert.equal(box.boxscoreDisplay(snapshot,'final'),'available');
 delete snapshot.boxscore;assert.equal(box.boxscoreDisplay(snapshot,'final'),'limited');
 snapshot.boxscore=normalize(raw()).boxscore;assert.equal(box.boxscoreDisplay(snapshot,'started'),'catching-up');
 snapshot.boxscore.teams[0].teamId='999';assert.equal(box.boxscoreDisplay(snapshot,'final'),'unavailable');
});

test('route negotiates extension with one cached source and rejects invalid flags before source access; new client accepts old Worker',async()=>{
 let calls=0;
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify(raw()),{headers:{'content-type':'application/json'}});};
 try{
  const route=await bundle('app/api/stats/route.ts');
  for(const flags of ['boxscore=2','boxscore=true','boxscore=','boxscore=1&boxscore=0','boxscore=1&boxscore=1']){
   const response=await route.GET(new Request('https://local/api/stats?event=401856887&phase=final&'+flags));assert.equal(response.status,400);
  }
  assert.equal(calls,0);
  for(const scoring of [0,1]) for(const context of [0,1]) for(const extension of [null,0,1]){
   const response=await route.GET(new Request(`https://local/api/stats?event=401856887&phase=final&scoring=${scoring}&playerContext=${context}${extension===null?'':'&boxscore='+extension}`));
   assert.equal(response.status,200);const body=await response.json();assert.ok(stats.parseGameStats(body));
   const oracle=old.normalizeGameStats(raw(),'401856887',body.checkedAt), baseline=old.gameStatsForClient(oracle,!!scoring,!!context);
   if(extension===1){assert.ok(body.boxscore);assert.equal(old.parseGameStats(body),null);delete body.boxscore;}
   else assert.equal('boxscore'in body,false);
   assert.deepEqual(body,baseline);
  }
  assert.equal(calls,1);
  const client=await bundle('lib/stats-client.ts'), urls=[];
  const body=old.gameStatsForClient(old.normalizeGameStats(raw(),'401856887',checked),true,true);
  const out=await client.loadGameStats({eventId:'401856887',teamIds:['145','201'],phase:'final',refresh:false},Date.now()+8000,new AbortController().signal,async url=>{urls.push(url);return new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});});
  assert.equal(out.kind,'ok');assert.equal(out.stats.boxscore,undefined);assert.equal(box.boxscoreDisplay(out.stats,'final'),'limited');assert.equal(urls.length,1);assert.equal(new URL(urls[0],'https://local').searchParams.get('boxscore'),'1');
 }finally{globalThis.fetch=originalFetch;}
});
