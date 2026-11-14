import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync}from'node:fs';import {bundle}from'./helpers.mjs';
const P=await bundle('lib/player-pack-leaders.ts'),S=await bundle('lib/player-season-server.ts'),L=await bundle('lib/cfbd-season-leaders.ts'),M=await bundle('lib/player-season.ts');
const F=JSON.parse(readFileSync(new URL('./fixtures/player-source.json',import.meta.url),'utf8'));
const NOW=Date.parse('2026-11-14T07:00:00Z'),stamp=new Date(NOW).toISOString();
const identities=[{id:251,school:'Texas',mascot:'Longhorns',classification:'fbs'},{id:153,school:'North Carolina',mascot:'Tar Heels',classification:'fbs'}];
const rows=F.packs['251:2026'].stats;
const categories=all=>['passing','rushing','receiving'].map(c=>all.filter(r=>r.category===c));
const legacy=(all=rows,time=stamp)=>L.createLeadersSnapshot(identities,categories(all),time);
function pack(all=rows){const r=F.packs['251:2026'];return S.createPlayerPack(r.team,r.year,all,r.games,r.boxes,stamp)}
function store(value=pack(),snapshot=legacy(rows,new Date(NOW-37*3600000).toISOString())){const map=new Map(),gets=[],puts=[];map.set(L.SNAPSHOT_KEY,JSON.stringify(snapshot));if(value)map.set('player:v1:pack:251:2026',JSON.stringify(value));return{map,gets,puts,async get(k){gets.push(k);return map.get(k)??null},async put(k,v){puts.push([k,v]);throw Error('reader must never write')}}}
const read=(kv,now=NOW,year=2026,id='251',name='Texas Longhorns',short='Texas')=>P.readPlayerPackLeaders(kv,id,year,name,short,now);

test('raw public season-row projection matches legacy selector for actual Texas/UNC without using box rows',async()=>{
 for(const[id,name]of[['251','Texas'],['153','North Carolina']]){
  const raw=F.packs[id+':2026'];const projected=P.projectPackLeaders(raw.team,2026,raw.stats,stamp);
  const old=L.createLeadersSnapshot(identities,categories(raw.stats),stamp).teams[id].leaders;
  for(const key of ['passingYards','rushingYards','receivingYards'])assert.deepEqual(projected.leaders[key],old[key]);
 }
 const p=pack();assert.equal(p.leaderProjection.leaders.passingYards.yards,2027);assert.equal(p.leaderProjection.leaders.rushingYards.name,'Raleek Brown');assert.equal(p.leaderProjection.leaders.receivingYards.name,'Ryan Wingo');
 const changed=structuredClone(F.packs['251:2026']);changed.boxes[0].teams.forEach(t=>t.categories.forEach(c=>c.types.forEach(ty=>ty.athletes.push({id:'999999',name:'Box Only',stat:'999999'}))));
 const withBox=S.createPlayerPack(changed.team,2026,changed.stats,changed.games,changed.boxes,stamp);assert.deepEqual(withBox.leaderProjection,p.leaderProjection);
});
test('raw malformed maximum cannot disappear in lossy people projection; legacy invalidation, duplicates, ties, zero and negatives match',()=>{
 const row=(id,name,value)=>({season:2026,team:'Texas',category:'passing',statType:'YDS',playerId:id,player:name,position:'QB',stat:value});
 const cases=[[row('20','B','0'),row('10','A','0')],[row('10','Negative','-4')],[row('10','Same','100'),row('10','Same','100')],[row('10','Same','100'),row('10','Same','101')],[row('10','Lower','10'),row('not-an-id','Bad','999')],[row('10','Lower','10'),row('20','Bad','1.5')],[row('10','Lower','10'),row('20','','999')]];
 for(const candidate of cases){const all=[...rows.filter(r=>r.category!=='passing'),...candidate];assert.deepEqual(P.projectPackLeaders({id:'251',name:'Texas'},2026,all,stamp).leaders.passingYards,legacy(all).teams['251'].leaders.passingYards)}
 const all=[...rows,row('broken','Lost Maximum','999999')],p=pack(all);assert.equal(p.people.broken,undefined);assert.equal(p.leaderProjection.leaders.passingYards,null,'invalid row cannot promote surviving Arch');
});
test('fresh bounded current pack reader retains original time, stale12h/expiry36h and canonical catalog identity; zero writes',async()=>{
 const kv=store();const good=await read(kv);assert.equal(good.passingYards.yards,2027);assert.equal(good.checkedAt,stamp);assert.equal(good.stale,false);
 assert.equal((await read(kv,NOW+12*3600000+1)).stale,true);assert.ok(await read(kv,NOW+36*3600000));assert.equal(await read(kv,NOW+36*3600000+1),null);assert.equal(await read(kv,NOW-1),null);
 for(const args of [[NOW,2025],[NOW,2026,'153'],[NOW,2026,'251','Texas Aggies'],[NOW,2026,'251','Texas Longhorns','Wrong']])assert.equal(await read(kv,...args),null);
 assert.deepEqual(kv.puts,[]);assert.ok(kv.gets.every(k=>k===L.SNAPSHOT_KEY||['player:v1:pack:251:2026','player:v1:pack:153:2026'].includes(k)));
});
test('old/malformed/incomplete packs, missing eligibility and disagreement fail closed; no conversion or retimestamp',async()=>{
 const base=pack();for(const mutate of[p=>delete p.leaderProjection,p=>delete p.basis,p=>p.scheduleComplete=false,p=>p.games=[],p=>p.games=[{}],p=>p.leaderProjection.v=2,p=>p.leaderProjection.checkedAt='2026-11-14T07:00:01Z',p=>p.leaderProjection.team.id='153',p=>p.leaderProjection.leaders.passingYards.yards=null,p=>p.leaderProjection.leaders.extra=null,p=>p.year=2025]){
  const p=structuredClone(base);mutate(p);const kv=store(p);assert.equal(await read(kv),null);assert.deepEqual(kv.puts,[]);
 }
 const invalidCatalog=store();const badCatalog=legacy();badCatalog.checkedAt='invalid';invalidCatalog.map.set(L.SNAPSHOT_KEY,JSON.stringify(badCatalog));assert.equal(await read(invalidCatalog),null);
 const no=store(null);assert.equal(await read(no),null);no.map.set('player:v1:pack:251:2026','x'.repeat(4000001));assert.equal(await read(no),null);
});
test('original whole result wins unchanged including partial categories; fallback only on whole-null, no source/block mutation',async(t)=>{
 let sourceCalls=0;t.mock.method(globalThis,'fetch',async()=>{sourceCalls++;throw Error('no source allowed')});
 const fresh=legacy();fresh.teams['251'].leaders.rushingYards=null;fresh.teams['251'].leaders.passingYards.yards=123;
 const kv=store(pack(),fresh);const result=await P.readAvailableSeasonLeaders(kv,'251',2026,'Texas Longhorns','Texas',NOW);assert.equal(result.passingYards.yards,123);assert.equal(result.rushingYards,null);assert.deepEqual(kv.gets,[L.SNAPSHOT_KEY]);
 const expired=store();expired.map.set('cfbd:v1:blocked','existing-block');const fallback=await P.readAvailableSeasonLeaders(expired,'251',2026,'Texas Longhorns','Texas',NOW);assert.equal(fallback.passingYards.yards,2027);assert.equal(expired.map.get('cfbd:v1:blocked'),'existing-block');assert.deepEqual(expired.puts,[]);assert.equal(sourceCalls,0);
});
test('read failures and noncooperative KV deadline remain optional null without writes/source work',async()=>{
 let puts=0;const broken={get:async()=>{throw Error('private storage failure')},put:async()=>{puts++}};assert.equal(await read(broken),null);assert.equal(puts,0);
 const hang={get:()=>new Promise(()=>{}),put:async()=>{puts++}};assert.equal(await P.readPlayerPackLeaders(hang,'251',2026,'Texas Longhorns','Texas',NOW,5),null);assert.equal(puts,0);
});
test('raw leader projection does not waive protected or incomplete schedule aggregate rules',async()=>{
 const raw=F.packs['153:2026'],p=S.createPlayerPack(raw.team,2026,raw.stats,raw.games,raw.boxes,stamp);assert.equal(p.leaderProjection.leaders.passingYards.yards,2126);
 const i=S.createPlayerIdentity(F.identities['4592532'],'4592532','Billy Edwards',raw.team,2026,stamp),season=S.playerFromPack(p,'4592532',i,false,[]);
 const {defaultDukePreferences}=await bundle('lib/duke-visibility.ts');const prefs=defaultDukePreferences();prefs.manual['401858266']=true;assert.equal(M.playerAggregates(season,prefs).shown,false);
 const incomplete=S.createPlayerPack(raw.team,2026,raw.stats,[],[],stamp);assert.equal(incomplete.scheduleComplete,false);
});
