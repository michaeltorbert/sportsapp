import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {bundle} from './helpers.mjs';
const {createScoringRankings,SCORING_GAMES_URL}=await bundle('lib/cfbd-scoring-rankings.ts');
const {parseScoringRankings}=await bundle('lib/team-season.ts');
// Genuine Texas/UNC membership and all 24 of their captured regular-season rows (fixtures/cfbd-scoring-provenance.json).
const sample=JSON.parse(readFileSync(new URL('./fixtures/cfbd-scoring-2026-sample.json',import.meta.url)));
const STAMP='2026-11-21T17:00:00.000Z';
// Opponents' FBS IDs and canonical names exactly as in the genuine rows; membership here only lets them join.
const OPPONENTS=[[326,'Texas State'],[194,'Ohio State'],[2636,'UTSA'],[2633,'Tennessee'],[201,'Oklahoma'],[57,'Florida'],[145,'Ole Miss'],[344,'Mississippi State'],[142,'Missouri'],[99,'LSU'],[8,'Arkansas'],[245,'Texas A&M'],[2628,'TCU'],[228,'Clemson'],[87,'Notre Dame'],[221,'Pittsburgh'],[150,'Duke'],[183,'Syracuse'],[2390,'Miami'],[41,'UConn'],[97,'Louisville'],[258,'Virginia'],[152,'NC State']];
let nextId=900000000;
// SYNTHETIC completed game against a SYNTHETIC FCS opponent.
const fcs=(m,own,other)=>({id:nextId++,season:2026,seasonType:'regular',completed:true,homeId:Number(m.id),homeTeam:m.school,homeClassification:'fbs',homePoints:own,awayId:700000+(nextId%100000),awayTeam:'Synthetic FCS',awayClassification:'fcs',awayPoints:other});
function population(){
  const members=sample.identities.map(r=>({id:String(r.id),school:r.school}));
  for(const [id,school] of OPPONENTS)members.push({id:String(id),school});
  for(let i=0;members.length<138;i++)members.push({id:String(10000+i),school:`Synthetic ${i}`});
  const games=structuredClone(sample.games);
  // SYNTHETIC: every non-sample member also plays one completed 24-17 game so national coverage can be complete.
  for(const m of members.slice(2))games.push(fcs(m,24,17));
  return {members,games};
}
const member=(x,school)=>x.members.find(m=>m.school===school);
function replace(x,school,scores){const m=member(x,school);x.games=x.games.filter(g=>!(g.homeTeam===school&&g.awayTeam==='Synthetic FCS'));for(const [a,b] of scores)x.games.push(fcs(m,a,b));}
const derive=x=>createScoringRankings(x.members,x.games,STAMP);
// Independent exact comparison over every eligible member; rounding is never used for order or equality.
function assertCompetitionRanks(result){
  const rows=Object.values(result).filter(Boolean);
  for(const side of ['offense','defense'])for(const r of rows){const m=r[side];
    const better=rows.filter(o=>side==='offense'?o[side].total*m.games>m.total*o[side].games:o[side].total*m.games<m.total*o[side].games).length;
    const equal=rows.filter(o=>o[side].total*m.games===m.total*o[side].games).length;
    assert.equal(m.rank,better+1);assert.equal(m.tied,equal>1);assert.equal(m.coverage,138);assert.equal(m.population,138);}
}

test('fixed national URL is the one documented regular-season FBS games read',()=>{
  assert.equal(SCORING_GAMES_URL,'https://api.collegefootballdata.com/games?year=2026&seasonType=regular&classification=fbs');
});
test('genuine Texas and North Carolina rows: completed-only totals, home/away orientation and the actual FCS opponent',()=>{
  const x=population(),r=derive(x),tex=r['251'],unc=r['153'];
  assert.deepEqual([tex.games,tex.offense.total,tex.defense.total],[10,302,178]);
  assert.deepEqual([unc.games,unc.offense.total,unc.defense.total],[10,258,221]);
  assert.equal((tex.offense.total/tex.games).toFixed(1),'30.2');assert.equal((unc.defense.total/unc.defense.games).toFixed(1),'22.1');
  assert.equal(tex.basis,'regular-completed');assert.equal(tex.checkedAt,STAMP);assert.equal(tex.year,2026);
  // The genuine 35-3 FCS game (401858218) counts for its FBS side; ETSU itself is not a member.
  const without=population();without.games=without.games.filter(g=>g.id!==401858218);const u=derive(without)['153'];
  assert.deepEqual([u.games,u.offense.total,u.defense.total],[9,223,218]);
  assertCompetitionRanks(r);
});
test('SYNTHETIC exact ties across different game counts, unrounded order, skipped places and direction',()=>{
  const x=population();
  replace(x,'Synthetic 0',[[30,17],[30,17],[30,17],[31,17],[30,17]]); // 151/5 exactly equals Texas's 302/10.
  replace(x,'Synthetic 1',Array.from({length:13},(_,i)=>[i<3?31:30,17])); // 393/13 = 30.23…, displays 30.2 like Texas but is better.
  const r=derive(x),tex=r['251'].offense,s0=r[member(x,'Synthetic 0').id].offense,s1=r[member(x,'Synthetic 1').id].offense;
  assert.equal(tex.rank,s0.rank);assert.ok(tex.tied&&s0.tied);
  assert.equal((s1.total/s1.games).toFixed(1),(tex.total/tex.games).toFixed(1));assert.ok(s1.rank<tex.rank);
  const below=Object.values(r).map(t=>t.offense).filter(m=>m.total*tex.games<tex.total*m.games).map(m=>m.rank);
  assert.equal(Math.min(...below),tex.rank+2,'next place after a two-way tie is skipped');
  // Lower allowed ranks first.
  const d=Object.values(r).map(t=>t.defense);const best=d.find(m=>m.rank===1);assert.ok(d.every(m=>best.total*m.games<=m.total*best.games));
  assertCompetitionRanks(r);
});
test('SYNTHETIC genuine zero is counted; uncompleted null scores are ignored, never zero',()=>{
  const x=population();replace(x,'Synthetic 2',[[0,0]]);
  const r=derive(x),z=r[member(x,'Synthetic 2').id];
  assert.deepEqual([z.games,z.offense.total,z.defense.total],[1,0,0]);assert.equal(z.offense.rank,138);assert.equal(z.offense.tied,false);assert.equal(z.defense.rank,1);
  // Texas has 12 rows, 2 uncompleted with null scores.
  assert.equal(sample.games.filter(g=>(g.homeId===251||g.awayId===251)&&!g.completed).length,2);assert.equal(r['251'].games,10);
  assertCompetitionRanks(r);
});
test('SYNTHETIC a member with no completed game withholds every national scoring rank, never promotes others',()=>{
  const x=population(),m=member(x,'Synthetic 3');x.games=x.games.filter(g=>g.homeId!==Number(m.id));
  const r=derive(x);assert.equal(r[m.id],null);
  for(const t of Object.values(r).filter(Boolean))for(const side of ['offense','defense']){assert.equal(t[side].rank,null);assert.equal(t[side].coverage,137);assert.equal(t[side].tied,false);}
  assert.equal(r['251'].offense.total,302,'values remain, ranks do not');
});
test('SYNTHETIC malformed, duplicate, conflicting or unknown-FBS relevant rows stop the derivation (no silent skip)',()=>{
  const tex=g=>g.id===401856667;
  const cases={
    duplicate:x=>x.games.push(structuredClone(x.games[0])),
    otherYear:x=>{x.games.find(tex).season=2025;},
    postseason:x=>{x.games.find(tex).seasonType='postseason';},
    completedText:x=>{x.games.find(tex).completed='true';},
    nullCompleted:x=>{x.games.find(tex).homePoints=null;},
    fraction:x=>{x.games.find(tex).awayPoints=1.5;},
    negative:x=>{x.games.find(tex).awayPoints=-1;},
    stringScore:x=>{x.games.find(tex).homePoints='59';},
    stringId:x=>{x.games.find(tex).homeId='251';},
    sameSides:x=>{const g=x.games.find(tex);g.awayId=251;g.awayTeam='Texas';},
    wrongName:x=>{x.games.find(tex).homeTeam='Texas A&M';},
    nameOtherId:x=>{x.games.find(tex).awayId=999999;}, // 'Texas State' is a member under 326.
    unknownFbs:x=>{const g=x.games.find(tex);g.awayId=999999;g.awayTeam='Unknown';},
    memberNotFbs:x=>{x.games.find(tex).homeClassification='fcs';},
    rowShape:x=>x.games.push(null),
    tooManyTeamGames:x=>replace(x,'Synthetic 4',Array.from({length:21},()=>[1,1])),
  };
  for(const [name,change] of Object.entries(cases)){const x=population();change(x);assert.throws(()=>derive(x),undefined,name);}
  for(const games of [[],{},null])assert.throws(()=>createScoringRankings(population().members,games,STAMP));
  const short=population();short.members.pop();assert.throws(()=>derive(short));
  // An uncompleted row's null or missing scores are not relevant arithmetic.
  const future=population();delete future.games.find(g=>g.id===401856755).homePoints;assert.equal(derive(future)['251'].games,10);
});
test('scoring child parser accepts a derived generation and rejects mismatched metadata/denominators',()=>{
  const r=derive(population()),tex=r['251'];
  assert.deepEqual(parseScoringRankings(structuredClone(tex),STAMP),tex);
  assert.equal(parseScoringRankings(tex,'2026-11-21T17:00:01.000Z'),null,'another generation');
  for(const mutate of [s=>s.basis='season',s=>s.offense.games=9,s=>s.defense.coverage=137,s=>s.offense.rank=139,s=>s.offense.tied='yes',s=>s.offense.total=-1,s=>s.population=137,s=>delete s.defense,s=>s.year=2025])
  {const bad=structuredClone(tex);mutate(bad);assert.equal(parseScoringRankings(bad,STAMP),null);}
});
