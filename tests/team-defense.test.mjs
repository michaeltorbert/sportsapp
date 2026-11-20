// #181 defensive leaders: production-path checks over GENUINE Nov 20 CFBD rows
// (tests/fixtures/team-defense-source.json; provenance alongside). Synthetic mutations are labeled inline.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {build} from 'esbuild';
import {bundle} from './helpers.mjs';
const D=await bundle('lib/team-defense.ts'),S=await bundle('lib/player-season-server.ts'),M=await bundle('lib/player-season.ts'),L=await bundle('lib/player-pack-leaders.ts');
const {defaultDukePreferences}=await bundle('lib/duke-visibility.ts');
const F=JSON.parse(readFileSync(new URL('./fixtures/team-defense-source.json',import.meta.url),'utf8'));
const NOW=Date.parse('2026-11-20T18:00:00Z'),stamp=new Date(NOW).toISOString(),DAY=86400000;
const VT={id:'259',name:'Virginia Tech'},GT={id:'59',name:'Georgia Tech'};
const ids=f=>f.leaders.map(l=>l.id);
const json=v=>new Response(JSON.stringify(v),{headers:{'content-type':'application/json'}});

test('genuine Nov20 leaders: VT 59/7.5/three-way 1, GT 63/two-way 3/three-way 1; solo only for the sole tackles leader',()=>{
 const vt=D.projectTeamDefense('Virginia Tech',2026,F.stats['259']).families,gt=D.projectTeamDefense('Georgia Tech',2026,F.stats['59']).families;
 assert.deepEqual(vt.tackles,{state:'leaders',value:59,leaders:[{id:'4832831',name:'Keon Wylie',solo:31}]});
 assert.deepEqual(vt.sacks,{state:'leaders',value:7.5,leaders:[{id:'4920136',name:'Aycen Stevens'}]},'source 7.5 kept as reported (school 8.5; DQ-181-DEF-01)');
 assert.equal(vt.interceptions.value,1);assert.deepEqual(ids(vt.interceptions),['5239158','5146425','4921118']);
 assert.deepEqual(gt.tackles,{state:'leaders',value:63,leaders:[{id:'5147934',name:'Tae Harris',solo:35}]});
 assert.equal(gt.sacks.value,3);assert.deepEqual(ids(gt.sacks),['5139096','5105677'],'both tied, ordered by name');
 assert.deepEqual(ids(gt.interceptions),['5222695','5276991','5276054']);
 assert.ok(D.validDefenseProjection({v:1,families:vt})&&D.validDefenseProjection({v:1,families:gt}));
});
test('value grammar: half sacks/TFL from 1, 1.0, 0.5; counts integral; explicit 0 vs not supplied vs none-positive',()=>{
 for(const[s,v]of[['1',1],['1.0',1],['0.5',0.5],['7.5',7.5],['10.0',10],[3,3]])assert.equal(D.defenseValue('SACKS',s),v);
 for(const s of['0.25','-1','1e2','',' 1',null,'7.5x'])assert.equal(D.defenseValue('SACKS',s),null);
 assert.equal(D.defenseValue('TOT','0.5'),null);assert.equal(D.defenseValue('INT','1.0'),1);
 // SYNTHETIC: every supplied value a known 0, and a team with no interceptions rows.
 const zero=F.stats['259'].filter(r=>r.statType==='SACKS'&&r.stat==='0');
 const p=D.projectTeamDefense('Virginia Tech',2026,zero).families;
 assert.deepEqual(p.sacks,{state:'none-positive'});assert.deepEqual(p.interceptions,{state:'not-supplied'});assert.deepEqual(p.tackles,{state:'not-supplied'});
});
test('malformed/conflicting possible maxima invalidate the family; identical duplicates collapse; team rows skipped; no cap',()=>{
 const rows=F.stats['59'],base=rows.find(r=>r.playerId==='5147934'&&r.statType==='TOT');
 const fam=extra=>D.projectTeamDefense('Georgia Tech',2026,[...rows,...extra]).families;
 assert.equal(fam([{...base}]).tackles.value,63,'SYNTHETIC identical duplicate collapses');
 assert.deepEqual(fam([{...base,stat:'64'}]).tackles,{state:'invalid'},'SYNTHETIC conflicting duplicate');
 assert.deepEqual(fam([{...base,player:'Other Name'}]).tackles,{state:'invalid'},'SYNTHETIC conflicting identity');
 assert.deepEqual(fam([{...base,playerId:'5000001',stat:'n/a'}]).tackles,{state:'invalid'},'SYNTHETIC malformed value is a possible maximum');
 assert.deepEqual(fam([{...base,playerId:'abc',stat:'1'}]).tackles,{state:'invalid'},'SYNTHETIC invalid person ID cannot leave a false lower winner');
 assert.equal(fam([{...base,playerId:'-7026',player:' Team',stat:'665'}]).tackles.value,63,'negative team aggregate is not a person');
 // SYNTHETIC: five-way tie, all kept (the schema bound is a size safety limit, not a display cap).
 const tie=['5000001','5000002','5000003','5000004','5000005'].map((id,i)=>({...base,playerId:id,player:`Synthetic Tie ${i}`,stat:'70'}));
 const t=fam(tie).tackles;assert.equal(t.leaders.length,5);assert.ok(t.leaders.every(l=>l.solo===undefined));
 // SYNTHETIC: offense never confuses families (passing INT thrown, interception return YDS).
 const off=fam([{...base,playerId:'5000009',player:'Synthetic QB',category:'passing',statType:'INT',stat:'9'},{...base,playerId:'5000010',player:'Synthetic Returner',category:'interceptions',statType:'YDS',stat:'99'}]);
 assert.equal(off.interceptions.value,1);assert.equal(off.interceptions.leaders.length,3);
});
test('pack: defense-only people, exact fields, no PD/QB HUR/defensive TD/AVG, half-unit logs, yard projection unchanged',()=>{
 const p=S.createPlayerPack(GT,2026,F.stats['59'],F.games['59'],F.boxes['59'],stamp);
 assert.equal(p.defense,1);assert.deepEqual(p.defenseProjection,D.projectTeamDefense('Georgia Tech',2026,F.stats['59']));
 assert.deepEqual(p.leaderProjection,L.projectPackLeaders(GT,2026,F.stats['59'],stamp),'original yard projection is unchanged');
 assert.deepEqual(p.people['5222695'].stats,{defensive:{TOT:5,SOLO:2},interceptions:{INT:1,YDS:1,TD:0}},'defense-only person; AVG dropped');
 assert.deepEqual(p.people['5105677'].stats.defensive,{TOT:59,SOLO:26,SACKS:3,TFL:6});
 const g=p.games.find(x=>x.game.id==='401858228');assert.equal(g.boxSupplied,true);
 assert.deepEqual(g.players['5105677'],{defensive:{TOT:4,SOLO:2,SACKS:1,TFL:2}},'box PD/QB HUR/defensive TD dropped');
 assert.deepEqual(g.players['5222695'].interceptions,{INT:1,YDS:1,TD:0});
 assert.equal(p.games.filter(x=>x.boxSupplied).length,1,'no box is not zero: other games stay unsupplied');
 const vt=S.createPlayerPack(VT,2026,F.stats['259'],[],[],stamp);
 assert.deepEqual(vt.people['4920136'].stats.defensive,{TOT:25,SOLO:16,SACKS:7.5,TFL:10});assert.equal(vt.people['4832831'].stats.defensive.SACKS,1);
 assert.equal(vt.people['4832831'].stats.defensive.PD,undefined);assert.equal(vt.people['4920136'].stats.defensive['QB HUR'],undefined);
 const s=S.playerFromPack(p,'5222695',null,false,[]);assert.equal(s.defense,'available');assert.ok(M.parsePlayerSeason(s,{id:'5222695',year:2026,team:'59',anchorYear:2026}));
 // SYNTHETIC malformed season half unit becomes unavailable, never rounded.
 const bad=S.createPlayerPack(VT,2026,[...F.stats['259'].filter(r=>r.playerId!=='4920136'||r.statType!=='SACKS'),{...F.stats['259'].find(r=>r.playerId==='4920136'&&r.statType==='SACKS'),stat:'7.3'}],[],[],stamp);
 assert.equal(bad.people['4920136'].stats.defensive.SACKS,null);assert.deepEqual(bad.defenseProjection.families.sacks,{state:'invalid'});
});

function setup({fetchOverride,legacy,ageDays=0,budget}={}){
 const map=new Map(),calls=[];let clock=0;
 map.set('season-leaders:v1:2026:regular',JSON.stringify({v:1,year:2026,teams:F.catalog}));
 if(budget)map.set('player:v1:budget',JSON.stringify(budget));
 if(legacy){ // SYNTHETIC legacy v1 pack (pre-#181): no marker/projection and no defense-only people.
  const p=S.createPlayerPack(GT,2026,F.stats['59'],F.games['59'],F.boxes['59'],new Date(NOW-ageDays*DAY).toISOString());
  delete p.defense;delete p.defenseProjection;for(const pid of Object.keys(p.people))delete p.people[pid];
  p.people['9000001']={name:'Synthetic Legacy Passer',position:'QB',stats:{passing:{YDS:100}}};
  map.set('player:v1:pack:59:2026',JSON.stringify(p));
 }
 const kv={async get(k){return map.get(k)??null},async put(k,v){map.set(k,v)}};
 const fetcher=async url=>{calls.push(url);if(fetchOverride)return fetchOverride(url);const u=new URL(url);
  if(u.pathname==='/player/search')return json([]);
  const t=u.searchParams.get('team')==='Georgia Tech'?'59':'259';
  return json({'/stats/player/season':F.stats[t],'/games':F.games[t]??[],'/games/players':F.boxes[t]??[]}[u.pathname]);};
 return {map,calls,service:S.createPlayerSeasonService({SEASON_LEADERS_KV:kv,CFBD_API_KEY:'synthetic-source-key'},fetcher,()=>NOW,{monotonic:()=>clock,wait:async ms=>{clock+=ms}})};
}
test('cold team-first discovery: canonical catalog team, one 3-read pack, no identity prefetch; profiles lazy and coalesced',async()=>{
 const t=setup();const [d,kealan]=await Promise.all([t.service.teamDefense('59',2026),t.service.get({id:'5276991',year:2026,team:'59',anchorYear:2026})]);
 assert.equal(d.status,200);assert.equal(d.defense.capability,'available');assert.equal(d.defense.team.name,'Georgia Tech');
 assert.equal(t.calls.filter(u=>!u.includes('/player/search')).length,3,'team and profile share one admitted pack');
 assert.equal(t.calls.filter(u=>u.includes('/player/search')).length,1,'only the actually opened profile reads identity');
 assert.equal(kealan.status,200);assert.deepEqual(kealan.season.totals.interceptions,{INT:1,YDS:0,TD:0},'defense-only profile, no 404');
 assert.equal(D.parseTeamDefense(JSON.parse(JSON.stringify(d.defense)),'59',2026)?.games.length,12);
 const again=await t.service.teamDefense('59',2026);assert.equal(again.status,200);assert.equal(t.calls.length,4,'fresh pack reused, no egress');
 const budget=JSON.parse(t.map.get('player:v1:budget')).days[0].calls;assert.equal(budget,4,'17-call cold bound per environment = 2 packs x 3 + 11 lazy profiles');
});
test('legacy fresh pack: honest pending, no egress, no false 404; expiry refreshes normally; failed refresh stays stale',async()=>{
 const t=setup({legacy:true});const d=await t.service.teamDefense('59',2026);
 assert.equal(d.defense.capability,'pending');assert.equal(d.defense.families,null);assert.equal(t.calls.length,0);
 const miss=await t.service.get({id:'5276991',year:2026,team:'59',anchorYear:2026});assert.deepEqual(miss,{status:503,error:'defense-pending'});assert.equal(t.calls.length,0);
 const old=await t.service.get({id:'9000001',year:2026,team:'59',anchorYear:2026});assert.equal(old.status,200);assert.equal(old.season.totals.passing.YDS,100,'offense preserved');assert.equal(old.season.defense,'pending');
 const expired=setup({legacy:true,ageDays:2});const e=await expired.service.teamDefense('59',2026);assert.equal(e.defense.capability,'available');assert.equal(expired.calls.length,3);
 const failing=setup({legacy:true,ageDays:2,fetchOverride:async()=>new Response('{}',{status:500,headers:{'content-type':'application/json'}})});
 const f=await failing.service.teamDefense('59',2026);assert.equal(f.defense.capability,'pending');assert.equal(f.defense.stale,true);assert.equal(failing.calls.length,1);
});
test('denial, budget and invalid input stop before or at the first source read; old public readers untouched',async()=>{
 const blocked=setup({fetchOverride:async()=>new Response('denied',{status:403,headers:{'content-type':'text/html'}})});
 assert.equal((await blocked.service.teamDefense('59',2026)).status,503);assert.equal(blocked.calls.length,1);assert.ok(blocked.map.has('cfbd:v1:blocked'));
 assert.equal((await blocked.service.teamDefense('259',2026)).status,503);assert.equal(blocked.calls.length,1,'common denial block');
 const full=setup({budget:{days:[{day:Math.floor(NOW/DAY),calls:24}]}});assert.equal((await full.service.teamDefense('59',2026)).status,503);assert.equal(full.calls.length,0);
 const t=setup();assert.equal((await t.service.teamDefense('999',2026)).status,404);assert.equal((await t.service.teamDefense('59',2025)).status,400);assert.equal((await t.service.teamDefense('059',2026)).status,400);assert.equal(t.calls.length,0);
 for(const q of['team=59&year=2026&x=1','team=59&team=59&year=2026','team=59','team=-1&year=2026','team=59&year=2025','team=59&year=26'])assert.equal(D.parseTeamDefenseQuery(new URLSearchParams(q)),null,q);
 assert.deepEqual(D.parseTeamDefenseQuery(new URLSearchParams('year=2026&team=59')),{team:'59',year:2026});
 const src=readFileSync(new URL('../app/api/team-defense/route.ts',import.meta.url),'utf8');assert.ok(src.indexOf('parseTeamDefenseQuery')<src.indexOf('cloudflare:workers'),'parameters rejected before env/source');
});
test('response guard: exact team/year, capability/families agreement, unique ties and games',async()=>{
 const t=setup();const d=JSON.parse(JSON.stringify((await t.service.teamDefense('59',2026)).defense));
 assert.ok(D.parseTeamDefense(d,'59',2026));assert.equal(D.parseTeamDefense(d,'259',2026),null);assert.equal(D.parseTeamDefense({...d,year:2025},'59',2025),null);
 assert.equal(D.parseTeamDefense({...d,families:null},'59',2026),null);assert.equal(D.parseTeamDefense({...d,capability:'pending'},'59',2026),null);
 const dup=structuredClone(d);dup.families.sacks.leaders.push(dup.families.sacks.leaders[0]);assert.equal(D.parseTeamDefense(dup,'59',2026),null);
 const extra=structuredClone(d);extra.games.push(extra.games[0]);assert.equal(D.parseTeamDefense(extra,'59',2026),null);
 assert.ok(D.parseTeamDefense({...d,extra:true},'59',2026),'unknown additive keys are stripped');
});

// --- Both privacy gates, through the real TeamScreen ---
const shared={name:'shared-react',setup(b){b.onResolve({filter:/^(?:react(?:\/jsx-runtime)?|lucide-react)$/},args=>({path:import.meta.resolve(args.path),external:true}))}};
const out=await build({stdin:{contents:"export { TeamScreen } from './components/team-screen.tsx'; export { scheduleSection, seasonStats } from './lib/team-season-server.ts';",resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'ts'},absWorkingDir:fileURLToPath(new URL('..',import.meta.url)),bundle:true,platform:'node',format:'esm',jsx:'automatic',write:false,plugins:[shared]});
const ui=await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
const UNC=JSON.parse(readFileSync(new URL('./fixtures/espn-team-season-unc-2026.json',import.meta.url),'utf8'));
const CHECKED='2026-10-19T05:04:44.000Z',SHARED='401858266';
const base=(drop=false)=>{const regular=ui.scheduleSection(UNC.schedule,'153',2026,2,CHECKED);if(drop)regular.entries=regular.entries.filter(e=>e.game.id!==SHARED);
 return {v:1,team:{id:'153',name:'North Carolina Tar Heels',shortName:'North Carolina',abbreviation:'UNC',logo:null},season:{year:2026},record:'4-6',stats:ui.seasonStats(UNC.stats,'153',2026),regular,postseason:{status:'complete',entries:[]},checkedAt:CHECKED};};
// SYNTHETIC: genuine GT leaders relabeled onto team 153 so the real shared UNC/Duke game exercises the gates.
const fams=D.projectTeamDefense('Georgia Tech',2026,F.stats['59']).families;
const defense=(games,changes={})=>({value:{v:1,team:{id:'153',name:'North Carolina'},year:2026,basis:'regular',checkedAt:stamp,stale:false,capability:'available',families:fams,games,scheduleComplete:true,...changes},pending:false,failed:false,onRetry(){}});
const allGames=base().regular.entries.map(e=>e.game),safeGames=allGames.filter(g=>g.id!==SHARED);
const render=(season,def,p=defaultDukePreferences())=>renderToStaticMarkup(createElement(ui.TeamScreen,{teamId:'153',season,pending:false,failed:false,online:true,prefs:p,defense:def,
 playerLink:(id,year)=>({href:`/?player=${id}&year=${year}&team=153`,open(){}}),back:{title:'Scores',detail:'Today',label:'Back'},onBack(){},onRetry(){},gameHref:id=>`/?event=${id}`,onOpenGame(){}}));
const NAMES=['Tae Harris','Taje Mccoy','Noah Carter','Kealan Jones','Trae Stevenson Jr.','C.J. Gamble'];
// Names, tie counts, values' units, times and IDs that only the defense block could contribute.
const leak=html=>NAMES.some(n=>html.includes(n))||/Tied ·|total tackles|interceptions? made|Defense checked|5147934|5105677|5222695/.test(html);
test('shown only when BOTH gates pass: every tied name links to its profile; source cue present',()=>{
 const html=render(base(true),defense(safeGames));
 assert.match(html,/Defensive leaders/);for(const n of NAMES)assert.ok(html.includes(n),n);
 assert.match(html,/Tied · 2 players/);assert.match(html,/Tied · 3 players/);assert.match(html,/35 solo/);
 for(const id of['5147934','5105677','5139096','5276991','5276054','5222695'])assert.ok(html.includes(`href="/?player=${id}&amp;year=2026&amp;team=153"`),id);
 assert.ok(html.includes(M.DEFENSE_SOURCE_CUE));
 assert.ok(html.indexOf('Season leaders')<html.indexOf('Defensive leaders')&&html.indexOf('Defensive leaders')<html.indexOf('Season averages'),'placed after the yard leaders');
});
test('pack contribution hidden while the older base looks safe; base hidden while pack safe; unknown prefs; incomplete; leaks nothing',()=>{
 const hide={...defaultDukePreferences(),manual:{[SHARED]:true}};
 const packHidden=render(base(true),defense(allGames),hide);assert.match(packHidden,/Season averages/,'base aggregates still shown');assert.match(packHidden,/Defensive leaders are hidden/);assert.ok(!leak(packHidden));
 const baseHidden=render(base(),defense(safeGames),hide);assert.ok(!baseHidden.includes('Defensive leaders'));assert.ok(!leak(baseHidden));
 const unknown=render(base(true),defense(safeGames),null);assert.ok(!leak(unknown));
 const incomplete=render(base(true),defense(safeGames,{scheduleComplete:false}));assert.match(incomplete,/aren’t shown yet/);assert.ok(!leak(incomplete));
 const empty=render(base(true),defense([]));assert.ok(!leak(empty));
 const pending=render(base(true),defense(safeGames,{capability:'pending',families:null}));assert.match(pending,/aren’t loaded yet/);assert.ok(!leak(pending));
 const loading=render(base(true),{value:null,pending:true,failed:false,onRetry(){}});assert.match(loading,/Loading defensive leaders/);assert.ok(!leak(loading));
 const wrong=render(base(true),{...defense(safeGames),value:{...defense(safeGames).value,team:{id:'59',name:'Georgia Tech'}}});assert.ok(!leak(wrong),'another team’s response never renders');
});
test('real GT Duke game 401858255 drives the pack gate (manual hide withholds, manual show displays)',()=>{
 const p=S.createPlayerPack(GT,2026,F.stats['59'],F.games['59'],F.boxes['59'],stamp),d=S.teamDefenseFromPack(p,false);
 const hide={...defaultDukePreferences(),manual:{'401858255':true}},show={...defaultDukePreferences(),manual:{'401858255':false}};
 assert.deepEqual(D.teamDefenseShown(d,hide),{shown:false,reason:'hidden'});assert.deepEqual(D.teamDefenseShown(d,show),{shown:true});
 assert.deepEqual(D.teamDefenseShown(d,null),{shown:false,reason:'checking'});
});
test('PV1-01 a reassuring board copy never erases the raw own-pack hidden decision (real GT/Duke identity, SYNTHETIC state)',()=>{
 const p=S.createPlayerPack(GT,2026,F.stats['59'],F.games['59'],F.boxes['59'],stamp),d=S.teamDefenseFromPack(p,false),prefs=defaultDukePreferences();
 // SYNTHETIC: the raw pack copy of 401858255 is source-unknown (possibly underway); the board says upcoming.
 const games=d.games.map(g=>g.id==='401858255'?{...g,state:'other',status:M.PLAYER_UNKNOWN_GAME_STATUS,started:false}:g),raw={...d,games};
 const board=[{...games.find(g=>g.id==='401858255'),state:'upcoming',status:'Scheduled',started:false}];
 assert.deepEqual(D.teamDefenseShown(raw,prefs),{shown:false,reason:'hidden'},'raw own-pack gate protects the unknown away-Duke game');
 assert.equal(D.teamDefenseShown({...raw,games:raw.games.map(g=>g.id==='401858255'?board[0]:g)},prefs).shown,true,'substitution alone would have shown leaders');
 assert.deepEqual(D.teamDefenseGate(raw,prefs,board),{shown:false,reason:'hidden'});
 assert.deepEqual(D.teamDefenseGate(raw,prefs),{shown:false,reason:'hidden'});
 // A board copy can add protection the raw copy lacks.
 const safe={...d,games:d.games.map(g=>g.id==='401858255'?{...g,state:'final'}:g)},hide={...prefs,manual:{'401858255':true}};
 assert.equal(D.teamDefenseGate(safe,hide,[]).shown,false);
 const html=render(base(true),{...defense(raw.games.filter(g=>g.teams.some(t=>t.id==='59')).map(g=>({...g,teams:g.teams.map(t=>t.id==='59'?{...t,id:'153'}:t)}))),board:board.map(g=>({...g,teams:g.teams.map(t=>t.id==='59'?{...t,id:'153'}:t)}))},prefs);
 assert.ok(!leak(html),'page wiring: TeamScreen applies the raw gate with board context present');assert.match(html,/Defensive leaders are hidden/);
});
test('PV1-03 identical defensive/interception duplicates keep matching team and profile values; conflicts fail closed; offense unchanged',()=>{
 const rows=F.stats['59'],tot=rows.find(r=>r.playerId==='5147934'&&r.statType==='TOT'),int=rows.find(r=>r.playerId==='5222695'&&r.statType==='INT');
 const same=S.createPlayerPack(GT,2026,[...rows,{...tot},{...int}],F.games['59'],F.boxes['59'],stamp); // SYNTHETIC identical repeats
 assert.equal(same.people['5147934'].stats.defensive.TOT,63);assert.equal(same.defenseProjection.families.tackles.value,63);
 assert.equal(same.people['5222695'].stats.interceptions.INT,1);assert.equal(same.defenseProjection.families.interceptions.leaders.length,3);
 const conflict=S.createPlayerPack(GT,2026,[...rows,{...tot,stat:'64'}],F.games['59'],F.boxes['59'],stamp); // SYNTHETIC conflict
 assert.equal(conflict.people['5147934'].stats.defensive.TOT,null);assert.deepEqual(conflict.defenseProjection.families.tackles,{state:'invalid'});
 const pass={season:2026,playerId:'9000002',player:'Synthetic Passer',team:'Georgia Tech',position:'QB',conference:'ACC',category:'passing',statType:'YDS',stat:'100'};
 assert.equal(S.createPlayerPack(GT,2026,[...rows,pass,{...pass}],[],[],stamp).people['9000002'].stats.passing.YDS,null,'legacy offense repeat semantics unchanged');
});
test('PV1-04 a failed revisit keeps the gated retained values, says Refresh delayed and offers Retry',()=>{
 const html=render(base(true),{...defense(safeGames),failed:true});
 for(const n of NAMES)assert.ok(html.includes(n),n);
 assert.match(html,/Refresh delayed/);assert.match(html,/Couldn’t refresh defensive leaders/);assert.match(html,/data-focus-key="defense-retry"/);
 const hidden=render(base(true),{...defense(allGames),failed:true},{...defaultDukePreferences(),manual:{[SHARED]:true}});assert.ok(!leak(hidden),'failure never bypasses the gate');
});
