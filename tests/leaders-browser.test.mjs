import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bundle } from './helpers.mjs';
const M = await bundle('lib/leaders-browser.ts'), S = await bundle('lib/leaders-browser-server.ts'), P = await bundle('lib/leaders-browser-privacy.ts');
const F = year => JSON.parse(readFileSync(new URL(`./fixtures/leaders-browser-${year}.json`,import.meta.url),'utf8'));
const stamp = '2026-09-06T03:59:00Z', now = Date.parse(stamp);
const q = (change={}) => ({year:2026,category:'passing',team:'all',conference:'all',page:1,...change});
test('actual excerpts bind all category values and selected-year affiliation, no current-year substitution', () => {
  for (const year of [2025,2026]) {
    const f = F(year), s = S.createBrowserSnapshot(f.identities,f.categories,year,stamp);
    assert.ok(M.parseLeadersSnapshot(s,year,now)); assert.equal(M.parseLeadersSnapshot(s,year === 2025 ? 2026 : 2025,now),null);
    const texas = M.selectLeaders(s,q({year,team:'251'}),new Set()); assert.equal(texas.rows[0].name,'Arch Manning'); assert.equal(texas.rows[0].yards,year === 2025 ? 2942 : 2201);
    const state = s.members.find(t => t.school === 'Texas State'); assert.equal(state.conference,year === 2025 ? 'Sun Belt' : 'Pac-12');
    assert.equal(M.selectLeaders(s,q({year,team:state.id,conference:year === 2025 ? 'Pac-12' : 'Sun Belt'}),new Set()).count,0);
    assert.equal(M.selectLeaders(s,q({year,team:'251',conference:'ACC'}),new Set()).count,0);
    const mestemaker = s.tables.passing.find(r => r.id === '5219834'); assert.equal(mestemaker.yards,year === 2025 ? 4119 : 3239); assert.equal(s.members.find(t => t.id === mestemaker.team).school,year === 2025 ? 'North Texas' : 'Oklahoma State');
  }
});
test('strict URL parsing preserves unsupported explicit scopes, rejects ambiguous queries, and safely bounds return origin', () => {
  const selected=q({year:2025,team:'326',conference:'Sun Belt',page:2}); const href=M.leadersHref(selected);
  assert.deepEqual(M.parseLeadersQuery(new URLSearchParams(href.split('?')[1])),selected); assert.equal(M.leadersReturn(href),href);
  assert.equal(M.parseLeadersQuery(new URLSearchParams('season=2024')).year,2024,'explicit unsupported year is not defaulted');
  for(const raw of ['season=2025&season=2026','category=efficiency','page=0','page=-1','team=','force=1','conference=']) assert.equal(M.parseLeadersQuery(new URLSearchParams(raw)),null);
  for(const value of ['https://evil.invalid/leaders?season=2025','//evil.invalid','/leaders?season=2024','/leaders?season=2025#x']) assert.equal(M.leadersReturn(value),null);
});
test('signed yard totals, competition ties and filter-before-page use only the visible population', () => {
  const s=structuredClone(F(2026).snapshot); s.tables.passing=Array.from({length:35},(_,i)=>({id:String(100+i),name:`Person ${i}`,team:i<30?'251':'153',yards:i===0?100:i===1?100:100-i})); s.tables.passing.push({id:'999',name:'Negative',team:'153',yards:-3});
  let r=M.selectLeaders(s,q(),new Set()); assert.deepEqual(r.rows.slice(0,3).map(x=>x.rank),[1,1,3]); assert.equal(r.count,36); assert.equal(r.rows.length,25);
  r=M.selectLeaders(s,q({team:'153'}),new Set()); assert.equal(r.count,6); assert.equal(r.rows[0].rank,1); assert.equal(r.rows.at(-1).yards,-3);
  r=M.selectLeaders(s,q(),new Set(['251'])); const stable=JSON.stringify(r); s.tables.passing.filter(x=>x.team==='251').forEach(x=>{x.yards=999999;}); assert.equal(JSON.stringify(M.selectLeaders(s,q(),new Set(['251']))),stable,'hidden values cannot influence ranks, counts or page boundaries');
});
test('malformed possible leaders/conflicting duplicates invalidate the whole source generation, no runner-up certification', () => {
  const f=F(2025);for(const mutate of [rows=>rows[0].push({...rows[0][0],stat:'999999'}),rows=>{rows[0][0].stat='not a number';},rows=>{rows[0][0].season=2026;}]) {const rows=structuredClone(f.categories);mutate(rows);assert.throws(()=>S.createBrowserSnapshot(f.identities,rows,2025,stamp));}
  const rows=structuredClone(f.categories); rows[0].push({...rows[0][0],playerId:-1,player:'Team',stat:'99999'}); const s=S.createBrowserSnapshot(f.identities,rows,2025,stamp); assert.equal(s.tables.passing.some(r=>r.id==='-1'),false);
});
test('actual selected-year schedule uses known-started guard; both teams protected; unknown never upcoming; no preference writes', () => {
  const s=structuredClone(F(2026).snapshot), prefs={version:2,rules:[{from:0,mode:'away'}],manual:{},remembered:{},waiting:{}};
  assert.equal(P.leadersPrivacy(s,null).ready,false); assert.equal(P.leadersPrivacy({...s,privacy:null},prefs).ready,false);
  const final=s.privacy.games.find(g=>g.state==='final'), upcoming=s.privacy.games.find(g=>g.state==='upcoming');
  prefs.manual[final.id]=true; prefs.manual[upcoming.id]=true; const before=JSON.stringify(prefs); const result=P.leadersPrivacy(s,prefs); assert.equal(result.ready,true);
  for(const t of final.teams) assert.ok(result.excluded.has(t.id));
  const upcomingOther=upcoming.teams.find(t=>t.id!=='150'); if(!final.teams.some(t=>t.id===upcomingOther.id)) assert.equal(result.excluded.has(upcomingOther.id),false);
  assert.equal(JSON.stringify(prefs),before,'historical source evaluation never records observations');
  final.state='unknown'; final.started=null; prefs.manual={}; for(const t of final.teams)assert.ok(P.leadersPrivacy(s,prefs).excluded.has(t.id));
});
