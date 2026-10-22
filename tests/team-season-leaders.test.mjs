import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bundle } from "./helpers.mjs";
const { selectSeasonLeaders, seasonLeaderAthlete, loadSeasonLeaders, teamLeadersUrl, seasonAthleteUrl } = await bundle("lib/team-season-leaders-server.ts");
const { createTeamSeasonService, teamScheduleUrl, teamStatsUrl } = await bundle("lib/team-season-server.ts");
const { parseTeamSeason, seasonTtl, TEAM_SEASON_LIVE_TTL_MS } = await bundle("lib/team-season.ts");
const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
const TEXAS = fixture("espn-season-leaders-texas-2026"), UNC = fixture("espn-season-leaders-unc-2026"), DUKE = fixture("espn-team-season-duke-2026");
const json = body => new Response(JSON.stringify(body));
const signal = () => new AbortController().signal;
function upstream(data = TEXAS, team = "251", change = () => undefined) {
  const calls = [];
  return { calls, fetcher: async (url, init) => {
    calls.push(url); assert.equal(init.redirect, "manual"); assert.equal(init.headers.Accept, "application/json");
    const override = change(url, init); if (override !== undefined) return override;
    if (url === teamLeadersUrl(team, 2026)) return json(data.leaders);
    for (const [id, a] of Object.entries(data.athletes)) if (url === seasonAthleteUrl(id, 2026)) return json(a);
    throw new Error(`unexpected constructed URL ${url}`);
  } };
}

test("minimized actual two-team captures prove full-name, year/team/regular-season integer-yard mapping", async () => {
  for (const [data, team] of [[TEXAS, "251"], [UNC, "153"]]) {
    const { calls, fetcher } = upstream(data, team), result = await loadSeasonLeaders(fetcher, team, 2026, signal(), 1000);
    assert.equal(result.year, 2026); assert.equal(result.seasonType, 2); assert.equal(calls.length, 4);
    const selected = selectSeasonLeaders(data.leaders, team, 2026);
    for (const key of ["passingYards", "rushingYards", "receivingYards"]) {
      assert.deepEqual(result[key], { ...selected[key], name: data.athletes[selected[key].athleteId].fullName });
      assert.ok(Number.isInteger(result[key].yards));
    }
    if (team === "251") assert.deepEqual([result.passingYards.name, result.passingYards.yards, result.rushingYards.name, result.rushingYards.yards, result.receivingYards.name, result.receivingYards.yards], ["Arch Manning",1295,"Hollywood Smothers",289,"Ryan Wingo",345]);
  }
});
test("SYNTHETIC malformed first/category/identity/value never promotes a runner-up or substitutes a season", () => {
  const good = TEXAS.leaders;
  for (const mutate of [
    b => b.type = "event", b => b.$ref = b.$ref.replace("2026", "2025"), b => b.$ref = b.$ref.replace("teams/251", "teams/153"),
    b => b.categories.push(structuredClone(b.categories[0])),
    b => b.categories[0].leaders[0].value = 12.5, b => b.categories[0].leaders[0].value = 1_000_000,
    b => b.categories[0].leaders[0].rel = [],
    b => b.categories[0].leaders[0].team.$ref = b.categories[0].leaders[0].team.$ref.replace("251", "153"),
    b => b.categories[0].leaders[0].statistics.$ref = b.categories[0].leaders[0].statistics.$ref.replace("types/2", "types/3"),
    b => { b.categories[0].leaders.unshift({ value: 50 }); },
  ]) { const b = structuredClone(good); mutate(b); assert.equal(selectSeasonLeaders(b, "251", 2026).passingYards, null); }
  for (const raw of ["https://evil.test/x", good.$ref.replace("sports.core.api.espn.com", "sports.core.api.espn.com.evil.test"), good.$ref.replace("http://", "http://user@"), good.$ref + "#x", good.$ref + "&other=x", good.$ref + "&lang=en", good.$ref.replace(".com/", ".com:8080/")]) {
    const b = { ...good, $ref: raw }; assert.equal(selectSeasonLeaders(b,"251",2026).passingYards,null,raw);
  }
  for (const value of [0,-10]) { const b=structuredClone(good); b.categories[0].leaders[0].value=value; assert.equal(selectSeasonLeaders(b,"251",2026).passingYards.yards,value); }
  const chosen=selectSeasonLeaders(good,"251",2026).passingYards;
  for (const mutate of [a=>a.id="1",a=>a.fullName="",a=>a.fullName="A\nB",a=>a.team.$ref=a.team.$ref.replace("251","153"),a=>a.statistics.$ref=a.statistics.$ref.replace("types/2","types/3"),a=>a.$ref=a.$ref.replace("2026","2025")]) {
    const a=structuredClone(TEXAS.athletes[chosen.athleteId]);mutate(a);assert.equal(seasonLeaderAthlete(a,chosen,"251",2026),null);
  }
});
test("compound Leader categories cannot satisfy canonical yard metrics (SYNTHETIC source)", () => {
  const body=structuredClone(TEXAS.leaders);
  const compound=["passingLeader","rushingLeader","receivingLeader"];
  body.categories.forEach((c,i)=>c.name=compound[i]);
  assert.deepEqual(selectSeasonLeaders(body,"251",2026), { passingYards:null,rushingYards:null,receivingYards:null });
});
test("two completed athlete rows survive a third timeout, and late completion cannot mutate returned snapshot", async () => {
  let release;
  const hung=new Promise(resolve=>{release=resolve;});
  const source=upstream(TEXAS,"251",url=>url===seasonAthleteUrl("4871053",2026)?hung:undefined);
  const result=await loadSeasonLeaders(source.fetcher,"251",2026,signal(),50);
  assert.equal(result.passingYards.name,"Arch Manning");assert.equal(result.receivingYards.name,"Ryan Wingo");assert.equal(result.rushingYards,null);
  const frozen=JSON.stringify(result);
  release(json(TEXAS.athletes["4871053"]));
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(JSON.stringify(result),frozen,"late response cannot change already returned/cached rows");
});
test("athlete failure is partial; invalid source refs cannot trigger foreign requests; repeated athlete is deduplicated", async () => {
  const partial=upstream(TEXAS,"251",url=>url===seasonAthleteUrl("4871053",2026)?new Response("{}",{status:503}):undefined);
  const result=await loadSeasonLeaders(partial.fetcher,"251",2026,signal(),1000);
  assert.equal(result.rushingYards,null);assert.equal(result.passingYards.name,"Arch Manning");assert.equal(result.receivingYards.name,"Ryan Wingo");
  const data=structuredClone(TEXAS), pass=data.leaders.categories[0].leaders[0];
  data.leaders.categories[1].leaders=[{...structuredClone(pass),value:108}];
  const duplicate=upstream(data), dedup=await loadSeasonLeaders(duplicate.fetcher,"251",2026,signal(),1000);
  assert.equal(duplicate.calls.length,3);assert.equal(dedup.rushingYards.name,"Arch Manning");assert.equal(dedup.rushingYards.yards,108);
  data.leaders.categories[0].leaders[0].athlete.$ref="https://evil.test/steal";
  const bad=upstream(data);await loadSeasonLeaders(bad.fetcher,"251",2026,signal(),1000);assert.ok(bad.calls.every(u=>u.startsWith("https://sports.core.api.espn.com/")));
});
test("optional deadline settles abort-ignoring fetch and body and cancels readers; zero budget starts no reads", async () => {
  let aborted=false;
  const start=performance.now();
  assert.equal(await loadSeasonLeaders((url,init)=>{init.signal.addEventListener("abort",()=>aborted=true);return new Promise(()=>{});},"251",2026,signal(),25),null);
  assert.ok(performance.now()-start<500);assert.equal(aborted,true);
  let canceled=false;
  const body = new ReadableStream({ pull(){return new Promise(()=>{});},cancel(){canceled=true;} });
  assert.equal(await loadSeasonLeaders(async()=>new Response(body),"251",2026,signal(),25),null);assert.equal(canceled,true);
  assert.equal(await loadSeasonLeaders(()=>{throw new Error("must skip");},"251",2026,signal(),0),null);
  const controller=new AbortController();const pending=loadSeasonLeaders(()=>new Promise(()=>{}),"251",2026,controller.signal,1000);controller.abort();assert.equal(await pending,null);
});
test("stream byte cap works without Content-Length; redirects/status/malformed JSON are optional unavailable", async () => {
  let canceled=false;
  const oversized = new ReadableStream({start(c){c.enqueue(new Uint8Array(128001));c.enqueue(new Uint8Array(128001));},cancel(){canceled=true;}});
  assert.equal(await loadSeasonLeaders(async()=>new Response(oversized),"251",2026,signal(),1000),null);assert.equal(canceled,true);
  for (const response of [new Response("{}",{status:302}),new Response("not json"),new Response("{}",{headers:{"content-length":"256001"}})]) assert.equal(await loadSeasonLeaders(async()=>response,"251",2026,signal(),1000),null);
});
test("legacy v1 and malformed optional rows preserve good base; incomplete leaders use short cadence", async () => {
  const baseFetch=async url=>url===teamScheduleUrl("150")?json(DUKE.default):url===teamStatsUrl("150",2026)?json(DUKE.stats):url===teamScheduleUrl("150",{year:2026,type:3})?json(DUKE.postseason):new Response("{}",{status:503});
  const result=await createTeamSeasonService(baseFetch).get("150"); assert.equal(result.status,200);
  const old=structuredClone(result.season);delete old.leaders;assert.ok(parseTeamSeason(old,"150"));
  const rows=await loadSeasonLeaders(upstream().fetcher,"251",2026,signal(),1000);
  const value={...old,leaders:rows};assert.equal(parseTeamSeason(value,"150").leaders.passingYards.name,"Arch Manning");
  const malformed={...value,leaders:{...rows,rushingYards:{...rows.rushingYards,yards:"289"}}};const parsed=parseTeamSeason(malformed,"150");assert.ok(parsed.stats);assert.equal(parsed.leaders.rushingYards,null);assert.equal(parsed.leaders.passingYards.name,"Arch Manning");assert.equal(seasonTtl(parsed),TEAM_SEASON_LIVE_TTL_MS);
  for (const leaders of [{...rows,year:2025},{...rows,seasonType:3},"bad"]) {const p=parseTeamSeason({...value,leaders},"150");assert.ok(p.stats);assert.equal(p.leaders,null);}
});
test("service preserves good base and releases admission when optional fetch ignores abort (real 3s cutoff)", async () => {
  const fetcher=async url=>url===teamScheduleUrl("150")?json(DUKE.default):url===teamStatsUrl("150",2026)?json(DUKE.stats):url===teamScheduleUrl("150",{year:2026,type:3})?json(DUKE.postseason):new Promise(()=>{});
  const service=createTeamSeasonService(fetcher),start=performance.now();
  const result=await service.get("150");assert.ok(performance.now()-start<4000);assert.equal(result.status,200);assert.ok(result.season.stats);assert.equal(result.season.regular.entries.length,12);assert.equal(result.season.leaders,null);
  assert.equal((await service.get("150")).status,200,"cache is available after optional timeout");
});
test("late discovery leaves only remaining root budget minus return margin for optional work", async t => {
  let elapsed=0;
  t.mock.method(performance,"now",()=>elapsed);
  let optionalCalls=0;
  const fetcher=async url=>{
    if(url===teamScheduleUrl("150")){elapsed=8850;return json(DUKE.default);}
    if(url===teamStatsUrl("150",2026))return json(DUKE.stats);
    if(url===teamScheduleUrl("150",{year:2026,type:3}))return json(DUKE.postseason);
    optionalCalls++;return new Promise(()=>{});
  };
  const start=Date.now(),service=createTeamSeasonService(fetcher);
  const result=await service.get("150");
  assert.ok(Date.now()-start<500,"remaining 50ms allowance, not a new 3-second budget");assert.equal(result.status,200);assert.equal(optionalCalls,1);assert.equal(result.season.leaders,null);assert.equal(result.season.regular.entries.length,12);
});
