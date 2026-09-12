import test from "node:test";
import assert from "node:assert/strict";
import { bundle, game, scoreboard } from "./helpers.mjs";
const { classify, sortGames, retainFinalCategories } = await bundle("lib/football.ts");
const { gamePriority, urgencyStage } = await bundle("lib/watch-priority.ts");
const { gameExpectation, upsetExplanation } = await bundle("lib/upset.ts");
const { viewGames } = await bundle("lib/scoreboard-views.ts");
const { conditions, transitions } = await bundle("services/alerts/rules.ts");

function match(id, { acc = false, bothAcc = false, sec = false, rank = null, otherRank = null, period = 4, clock = 120, score = 21, otherScore = 24, ...rest } = {}) {
  const g = game({ id, period, clock, ...rest });
  Object.assign(g.teams[0], { name: "Favorite", rank, score, conferenceId: acc || bothAcc ? "1" : sec ? "8" : "4" });
  Object.assign(g.teams[1], { name: "Opponent", rank: otherRank, score: otherScore, conferenceId: bothAcc ? "1" : "151" });
  return g;
}

test("confirmed viewing preferences hold for concrete games in either input order", () => {
  const pairs = [
    [match("top10-tie", { rank: 10, score: 24 }), match("acc-tie", { bothAcc: true, score: 24 })],
    [match("ranked-acc-upset", { rank: 15, acc: true }), match("acc-close", { bothAcc: true, score: 24 })],
    [match("major-upset", { rank: 3 }), match("acc-blowout", { acc: true, score: 42, otherScore: 7 })],
    [match("acc-ranked", { rank: 15, acc: true }), match("similar-ranked", { rank: 15 })],
    [match("acc-finish", { bothAcc: true, score: 24 }), match("ranked-acc-early", { rank: 3, acc: true, period: 1, clock: 900, score: 7, otherScore: 0 })],
    [match("major", { rank: 3 }), match("minor", { rank: 24, otherRank: 25 })],
    [match("other-ot", { period: 5, score: 24 }), match("ranked-acc-blowout", { rank: 3, acc: true, score: 7, otherScore: 37 })],
    [match("ranked-early", { rank: 15, acc: true, period: 1, score: 0, otherScore: 0 }), match("other-early", { period: 1, score: 0, otherScore: 0 })],
  ];
  for (const clock of [360, 120]) pairs.push([
    match(`close-${clock}`, { clock, score: 21, otherScore: 28 }),
    match(`down30-${clock}`, { clock, acc: true, rank: 3, otherRank: 20, score: 7, otherScore: 37 }),
  ]);
  for (const period of [1, 2]) pairs.push([
    match(`close-vs-early-${period}`, { clock: 360, score: 21, otherScore: 28 }),
    match(`early-down30-${period}`, { period, acc: true, rank: 3, otherRank: 20, score: 7, otherScore: 37 }),
  ]);
  for (const [higher, lower] of pairs) {
    for (const order of [[higher, lower], [lower, higher]])
      assert.equal(sortGames(order)[0].id, higher.id, `${higher.id} should beat ${lower.id}: ${JSON.stringify([gamePriority(higher), gamePriority(lower)])}`);
  }
  assert.ok(gamePriority(match("early", { period: 1, score: 0, otherScore: 0 })).drama <= 6);
});

test("Florida–ECU can qualify without ranks, while absent or contrary evidence stays honest", () => {
  const g = match("florida-ecu", { sec: true, score: 7, otherScore: 21 });
  g.teams[0].name = "Florida"; g.teams[1].name = "ECU";
  assert.equal(classify(g).top25, false); assert.equal(classify(g).close, false); assert.equal(classify(g).upset, true);
  assert.deepEqual(viewGames(scoreboard([g]), "watch").map(g => g.id), [g.id]);
  assert.match(upsetExplanation(g), /ECU leads Florida · SEC conference watch/);
  g.pregameLine = { favoriteId: "a", spread: 10.5, source: "ESPN" };
  assert.equal(gameExpectation(g).basis, "line"); assert.match(upsetExplanation(g), /pregame favorite/);
  g.teams.forEach(t => { t.rankKnown = false; });
  assert.equal(classify(g).upset, true, "a valid line does not need rankings");
  g.pregameLine.favoriteId = "b";
  assert.equal(classify(g).upset, false, "ECU was favored, so Florida trailing is not an upset");
  g.pregameLine = { favoriteId: null, spread: 0, source: "ESPN" };
  assert.equal(gameExpectation(g), null);
  delete g.pregameLine; g.teams.forEach(t => { t.rankKnown = true; });
  for (const conferenceId of [null, "unknown", "18", "4", "8"]) {
    g.teams[1].conferenceId = conferenceId;
    assert.equal(classify(g).upset, false, `no invented favorite for conference ${conferenceId}`);
  }
});

test("intraconference unranked SEC favorites are supported; unrelated unranked favorites stay out", () => {
  const g = match("sec", { sec: true, score: 7, otherScore: 21, pregameLine: { favoriteId: "a", spread: 3, source: "ESPN" } });
  g.teams[1].conferenceId = "8";
  assert.equal(classify(g).upset, true);
  g.teams[0].conferenceId = "15"; g.teams[1].conferenceId = "17";
  assert.equal(classify(g).upset, false);
  g.teams[0].rank = 20;
  assert.equal(classify(g).upset, true, "ranked teams get credit regardless of conference");
});

test("clock validity, intermissions, ties and finishing bands limit misleading urgency and churn", () => {
  const base = match("g", { rank: 5, score: 24 });
  assert.equal(classify(base).upset, false); assert.ok(gamePriority(base).upset > 0);
  for (const clockKnown of [false, undefined]) assert.equal(urgencyStage({ ...base, clock: 0, clockKnown }), 4);
  assert.equal(urgencyStage({ ...base, clock: 0, clockKnown: true }), 5);
  assert.equal(urgencyStage({ ...base, clock: -1 }), 4);
  assert.equal(urgencyStage({ ...base, intermission: true, clock: 0 }), 4);
  assert.equal(urgencyStage({ ...base, period: 2, intermission: true, clock: 0 }), 2);
  assert.equal(urgencyStage({ ...base, period: 5, clockKnown: false }), 6);
  for (const state of ["upcoming", "final", "delayed", "other"]) assert.equal(urgencyStage({ ...base, state }), 0);
  const a = match("a", { clock: 100 }), b = match("b", { clock: 90 });
  assert.deepEqual(sortGames([b, a]).map(g => g.id), ["a", "b"]);
  assert.deepEqual(sortGames([b, { ...a, clock: 99 }]).map(g => g.id), ["a", "b"]);
  assert.equal(sortGames([{ ...b, clock: 10 }, a])[0].id, "b");
});

test("every filter preserves shared relative order, chronology and immutable inputs", () => {
  const games = [match("acc", { acc: true }), match("top", { rank: 10 }), match("sec", { sec: true }), match("other", { score: 24 }),
    match("earlier", { rank: 25, state: "upcoming", date: "2026-09-06T17:00:00Z" }), match("later", { rank: 1, state: "upcoming", date: "2026-09-06T20:00:00Z" }), match("final", { rank: 1, acc: true, state: "final" })];
  const before = structuredClone(games), ordered = sortGames(games).map(g => g.id);
  assert.deepEqual(sortGames([...games].reverse()).map(g => g.id), ordered); assert.deepEqual(games, before);
  for (const filter of ["acc", "top25", "upset", "close", "watch"]) {
    const filtered = viewGames(scoreboard(games), filter).map(g => g.id);
    assert.deepEqual(filtered, ordered.filter(id => filtered.includes(id)));
  }
  assert.ok(ordered.indexOf("earlier") < ordered.indexOf("later")); assert.equal(ordered.at(-1), "final");
  assert.equal(viewGames(scoreboard(games), "watch", true).some(g => g.state === "final"), false);
});

test("pregame lines survive kickoff and reload, but cannot migrate to a different matchup", () => {
  const pre = match("sec", { sec: true, state: "upcoming", started: false, pregameLine: { favoriteId: "a", spread: 7, source: "ESPN" } });
  const live = match("sec", { sec: true });
  for (const state of ["upcoming", "live", "delayed"]) {
    const transition = { ...live, state, started: false, period: 0 };
    assert.equal(retainFinalCategories(scoreboard([transition]), scoreboard([pre])).games[0].pregameLine.favoriteId, "a");
  }
  let board = retainFinalCategories(scoreboard([live]), scoreboard([pre]));
  assert.equal(board.games[0].pregameLine.favoriteId, "a");
  board = retainFinalCategories(scoreboard([{ ...live, state: "final" }]), JSON.parse(JSON.stringify(board)));
  assert.equal(board.games[0].pregameLine.favoriteId, "a");
  const replacement = structuredClone(live); replacement.teams[0].id = "different";
  assert.equal(retainFinalCategories(scoreboard([replacement]), board).games[0].pregameLine, undefined);
  const comeback = match("sec", { sec: true, state: "final", score: 35, otherScore: 24 });
  const retained = retainFinalCategories(scoreboard([comeback]), board).games[0];
  assert.equal(classify(retained).upset, true); assert.equal(upsetExplanation(retained), null);
  const rescheduled = { ...comeback, date: "2026-09-06T21:00:00Z" };
  const moved = retainFinalCategories(scoreboard([rescheduled]), board).games[0];
  assert.equal(classify(moved).upset, true, "same-event categories survive schedule updates");
  assert.equal(moved.pregameLine, undefined, "a reschedule must not assert the original betting baseline still applies");
  const ranked = match("both-ranked", { rank: 24, otherRank: 25 });
  assert.match(upsetExplanation(ranked), /No\. 25 Opponent leads No\. 24 Favorite/);
});

test("expanded list eligibility does not redefine ranked push triggers or their dedupe IDs", () => {
  const g = match("sec", { sec: true, pregameLine: { favoriteId: "a", spread: 7, source: "ESPN" } });
  for (const period of [4, 5]) {
    g.period = period;
    assert.equal(classify(g).upset, true); assert.equal(conditions(g, Date.now())["ranked-trailing-fourth"], false);
  }
  assert.equal(conditions({ ...g, state: "final" }, Date.now())["upset-final"], false);
  g.teams[0].rank = 5; g.pregameLine.favoriteId = "b";
  assert.equal(classify(g).upset, false); assert.equal(conditions(g, Date.now())["ranked-trailing-fourth"], true);
  assert.ok(transitions(null, g, Date.now()).some(e => e.id === "sec:ranked-trailing-fourth"));
});

test("unranked SEC upset watches remain visible during a delay after kickoff", () => {
  const paused = match("paused-sec", { sec: true, state: "delayed", started: true, score: 7, otherScore: 21 });
  for (const filter of ["watch", "upset"])
    assert.deepEqual(viewGames(scoreboard([paused]), filter).map(g => g.id), [paused.id]);
  assert.equal(gamePriority(paused).stage, 0);
  assert.equal(classify({ ...paused, started: false }).upset, false, "an unstarted delay is not a game in progress");
  const final = match("paused-sec", { sec: true, state: "final", score: 35, otherScore: 21 });
  const stored = JSON.parse(JSON.stringify(scoreboard([paused])));
  const retained = retainFinalCategories(scoreboard([final]), stored);
  assert.equal(classify(retained.games[0]).upset, true, "a saved paused watch survives a comeback final");
  assert.deepEqual(viewGames(retained, "upset").map(g => g.id), [paused.id]);
  assert.equal(upsetExplanation(retained.games[0]), null);
  stored.games[0].started = false;
  assert.equal(retainFinalCategories(scoreboard([final]), stored).games[0].retainedCategories, undefined);
  paused.teams[0].rank = 5;
  assert.equal(conditions(paused, Date.now())["ranked-trailing-fourth"], false);
});

// Historical screenshot states; lines below are explicit test assumptions, not recovered odds.
function screenshotGames() {
  const rows = [
    ["louisville-villanova", "Louisville", "Villanova", "1", "20", 24, 31, 10, 2, 113, false, 21],
    ["missouri-kansas", "Missouri", "Kansas", "8", "4", 23, 0, 0, 1, 441, false, 7],
    ["bc-rutgers", "Boston College", "Rutgers", "1", "5", null, 14, 0, 1, 0, true, 3],
    ["virginia-norfolk", "Virginia", "Norfolk State", "1", "24", 25, 28, 3, 2, 0, true, 21],
  ];
  return rows.map(([id, name, opponent, conference, otherConference, rank, score, otherScore, period, clock, intermission, spread]) => {
    const g = match(id, { rank, score, otherScore, period, clock, clockKnown: true, intermission,
      pregameLine: { favoriteId: "a", spread, source: "fixture assumption" } });
    Object.assign(g.teams[0], { name, conferenceId: conference, rankKnown: true });
    Object.assign(g.teams[1], { name: opponent, conferenceId: otherConference, rank: null, rankKnown: true });
    if (id === "bc-rutgers") Object.assign(g, { possession: "a", downDistance: "2nd & 10 at RUTG 27" });
    return g;
  });
}

test("issue 66 screenshot alternatives precede both comfortable ranked ACC leads", () => {
  const games = screenshotGames();
  for (const input of [games, [...games].reverse(), [games[2], games[0], games[3], games[1]]]) {
    const ordered = viewGames(scoreboard(input), "watch").map(g => g.id);
    for (const higher of ["missouri-kansas", "bc-rutgers"])
      for (const lower of ["louisville-villanova", "virginia-norfolk"])
        assert.ok(ordered.indexOf(higher) < ordered.indexOf(lower), `${higher} above ${lower}`);
    for (const filter of ["acc", "top25", "close", "upset"]) {
      const subset = viewGames(scoreboard(input), filter).map(g => g.id);
      assert.deepEqual(subset, ordered.filter(id => subset.includes(id)));
    }
  }
});

test("favorite leads taper monotonically without the old single-point cliffs", () => {
  for (const period of [1, 2, 3, 4, 5]) {
    for (const clock of [900, 450, 0]) {
      let previous;
      for (let lead = 4; lead <= 42; lead++) {
        const g = match("favorite", { acc: true, rank: 3, period, clock, score: 7 + lead, otherScore: 7,
          pregameLine: { favoriteId: "a", spread: 14, source: "fixture" } });
        const priority = gamePriority(g);
        if (previous) {
          assert.ok(priority.total <= previous.total, `lead ${lead}, period ${period}, clock ${clock}`);
          assert.ok(previous.relevance - priority.relevance <= 2.4, "one point never removes 65% relevance");
          if ([17, 21, 25].includes(lead)) assert.ok(previous.total - priority.total <= 5.4, "old boundary has no scoring cliff");
        }
        previous = priority;
      }
    }
  }
});

test("comfortable leads remain continuous through halftime and Q3 and fade with elapsed time", () => {
  for (const lead of [16, 17, 20, 21, 24, 25]) {
    const base = match("favorite", { acc: true, rank: 24, period: 2, clock: 0, score: lead, otherScore: 0 });
    const halftime = gamePriority({ ...base, intermission: true });
    const third = gamePriority({ ...base, period: 3, clock: 900, intermission: false });
    assert.equal(third.relevance, halftime.relevance);
    assert.ok(Math.abs(third.total - halftime.total) <= 2, "only close-game urgency grows at Q3");
    const before = gamePriority({ ...base, clock: 1 });
    const after = gamePriority({ ...base, period: 3, clock: 899 });
    assert.ok(before.relevance >= halftime.relevance && halftime.relevance >= after.relevance);
    assert.ok(before.relevance - after.relevance < 0.01);
  }
});

test("missing clocks use quarter start, and a known intermission supplies only elapsed-quarter context", () => {
  const base = match("favorite", { acc: true, rank: 24, period: 2, clock: 900, score: 21, otherScore: 0 });
  const start = gamePriority(base).relevance;
  for (const extra of [{ clockKnown: false, clock: 0 }, { clockKnown: undefined, clock: 0 },
    { clock: -1 }, { clock: 901 }, { clock: NaN }, { clock: Infinity }])
    assert.equal(gamePriority({ ...base, ...extra }).relevance, start);
  assert.equal(gamePriority({ ...base, intermission: true, clockKnown: false }).relevance,
    gamePriority({ ...base, clock: 0 }).relevance);
  for (const period of [0, NaN, 2.5]) assert.ok(Number.isFinite(gamePriority({ ...base, period }).total));
  const missing = structuredClone(base); missing.teams[0].score = null;
  assert.equal(gamePriority(missing).relevance, 34);
  assert.equal(gamePriority(missing).drama, 0);
});

test("relevance, late urgency and significant upsets survive comfortable-lead tuning", () => {
  const earlyTie = match("ordinary-tie", { period: 1, score: 0, otherScore: 0 });
  const relevant = match("ranked-acc", { acc: true, rank: 5, period: 1, score: 14, otherScore: 0 });
  assert.ok(gamePriority(relevant).total > gamePriority(earlyTie).total);
  assert.ok(gamePriority({ ...earlyTie, period: 4 }).total > gamePriority(earlyTie).total);
  const winning = match("favorite-winning", { acc: true, rank: 3, period: 2, score: 28, otherScore: 7,
    pregameLine: { favoriteId: "a", spread: 14, source: "fixture" } });
  const losing = structuredClone(winning); losing.id = "major-upset";
  losing.teams[0].score = 7; losing.teams[1].score = 28;
  assert.equal(gamePriority(winning).upset, 0);
  assert.ok(gamePriority(losing).upset > 0);
  assert.equal(sortGames([winning, losing])[0].id, losing.id);
});


test("ordinary one-score fourth quarters beat comfortable lower-ranked ACC wins", () => {
  for (const clock of [900, 600, 301, 300, 120, 0]) {
    const close = match("ordinary-close", { period: 4, clock, score: 14, otherScore: 21 });
    for (let lead = 17; lead <= 24; lead++) {
      const favorite = match("ranked-acc-leading", { acc: true, rank: 24, period: 4, clock,
        score: 7 + lead, otherScore: 7, pregameLine: { favoriteId: "a", spread: 14, source: "fixture" } });
      for (const pair of [[close, favorite], [favorite, close]]) assert.equal(sortGames(pair)[0].id, close.id);
    }
  }
  const close = match("ordinary-close", { period: 4, clock: 900, score: 14, otherScore: 21 });
  const major = match("major-ranked", { acc: true, rank: 3, period: 4, clock: 900, score: 24, otherScore: 7 });
  assert.ok(gamePriority(major).total > gamePriority(close).total,
    "a Top 5 ACC matchup retains enough relevance to lead at Q4 start");
  assert.ok(gamePriority({ ...major, clock: 60 }).total < gamePriority({ ...close, clock: 60 }).total,
    "the ordinary one-score finish overtakes even the Top 5 comfortable win");
});


test("malformed saved scores cannot produce a nonfinite priority", () => {
  for (const score of [null, NaN, undefined, "not a score"]) {
    const saved = match("saved", { acc: true, rank: 24, score, otherScore: 7 });
    // Assign after match as undefined otherwise selects its valid default score.
    saved.teams[0].score = score;
    const priority = gamePriority(saved);
    assert.equal(priority.drama, 0);
    assert.equal(priority.relevance, 34);
    assert.ok(Number.isFinite(priority.total));
    assert.equal(priority.upset, 0);
  }
});


test("ranked upset watch precedes Texas A&M winning in the reported third-quarter state", () => {
  // Scores, ranks and clocks come from the screenshot. Spread magnitude is unknown;
  // exercise rank fallback and several explicit line assumptions independently.
  for (const spread of [null, 3, 7, 14]) {
    const upset = match("oklahoma-michigan", { sec: true, rank: 11, period: 3, clock: 892,
      score: 0, otherScore: 10 });
    const winning = match("tamu-asu", { sec: true, rank: 10, period: 3, clock: 614,
      score: 17, otherScore: 13 });
    if (spread !== null) upset.pregameLine = { favoriteId: "a", spread, source: "fixture assumption" };
    for (const input of [[winning, upset], [upset, winning]]) {
      for (const filter of ["watch", "top25"])
        assert.deepEqual(viewGames(scoreboard(input), filter).map(g => g.id), [upset.id, winning.id]);
    }
    const recovered = structuredClone(upset);
    recovered.teams[0].score = 14;
    assert.equal(gamePriority(recovered).upset, 0, "the trailing bonus disappears after a recovery");
    upset.pregameLine = { favoriteId: "b", spread: 3, source: "contrary fixture assumption" };
    assert.equal(gamePriority(upset).upset, 0, "a ranked betting underdog does not gain upset priority");
  }
});


test("Oregon upset ranks near the top of the seven screenshot games", () => {
  // Visible ranks, scores and clocks only; no betting lines inferred from images.
  const rows = [
    ["wake-purdue", { acc: true, score: 23, otherScore: 20, period: 4, clock: 120 }],
    ["vt-odu", { acc: true, score: 37, otherScore: 13, period: 4, clock: 672 }],
    ["oklahoma-michigan", { sec: true, rank: 11, score: 10, otherScore: 10, period: 4, clock: 709 }],
    ["penn-state-temple", { rank: 16, score: 27, otherScore: 9, period: 4, clock: 112 }],
    ["tamu-asu", { sec: true, rank: 10, score: 38, otherScore: 20, period: 4, clock: 518 }],
    ["georgia-wku", { sec: true, rank: 2, score: 56, otherScore: 6, period: 3, clock: 674 }],
    ["oregon-osu", { rank: 6, score: 14, otherScore: 24, period: 2, clock: 116 }],
  ];
  const games = rows.map(([id, values]) => {
    const g = match(id, values);
    // Unknown is safer than inventing the generic fixture's conference-watch evidence.
    g.teams[1].conferenceId = null;
    if (id === "vt-odu") g.teams[0].id = "259";
    return g;
  });
  for (const input of [games, [...games].reverse()]) {
    const ordered = viewGames(scoreboard(input), "watch").map(g => g.id);
    assert.ok(ordered.indexOf("oregon-osu") <= 3, "ORD-005: upset stays above ordinary comfortable wins; exact position is not a user rule");
    assert.ok(ordered.indexOf("oregon-osu") < ordered.indexOf("tamu-asu"));
    assert.ok(ordered.indexOf("oregon-osu") < ordered.indexOf("georgia-wku"));
    assert.equal(ordered[0], "vt-odu", "ORD-007 supersedes the old Oregon-over-VT inference");
    assert.ok(ordered.indexOf("oregon-osu") < ordered.indexOf("penn-state-temple"));
    assert.ok(viewGames(scoreboard(input), "top25").findIndex(g => g.id === "oregon-osu") <= 1);
  }
});


test("ORD-007 Duke and Virginia Tech lead each state group without crossing groups", () => {
  const states = ["live", "delayed", "upcoming", "other", "final"];
  const games = states.flatMap((state, index) => {
    const ordinary = match(`${state}-ordinary`, { state, rank: 1, period: 5,
      score: 24, otherScore: 27, date: "2026-09-12T12:00:00Z" });
    return [ordinary, ...["150", "259"].map((teamId, side) => {
      const pinned = match(`${state}-${teamId}`, { state, acc: true, score: 56, otherScore: 0,
        period: 1, date: `2026-09-${13 + index}T12:00:00Z` });
      pinned.teams[side].id = teamId;
      return pinned;
    })];
  });
  for (const input of [games, [...games].reverse()]) {
    const sorted = sortGames(input);
    assert.deepEqual(sorted.map(g => g.state), states.flatMap(state => [state, state, state]));
    for (const state of states) {
      const group = sorted.filter(g => g.state === state);
      assert.deepEqual(new Set(group.slice(0, 2).map(g => g.id)), new Set([`${state}-150`, `${state}-259`]));
      assert.equal(group[2].id, `${state}-ordinary`);
    }
    assert.equal(viewGames(scoreboard(input), "watch", true).some(g => g.state === "final"), false);
    assert.equal(viewGames(scoreboard(input), "upset").some(g => g.teams.some(t => ["150", "259"].includes(t.id))), false,
      "pinning does not turn a comfortable favorite win into an upset");
  }
  const earlier = match("earlier", { state: "upcoming", date: "2026-09-12T12:00:00Z" });
  const later = match("later", { state: "upcoming", date: "2026-09-12T20:00:00Z" });
  earlier.teams[0].id = "259"; later.teams[0].id = "150";
  assert.deepEqual(sortGames([later, earlier]).map(g => g.id), ["earlier", "later"],
    "both favorites share a tier; chronology breaks their upcoming tie");
});

test("ORD-006 ranked ties retain interest below comparable ranked upsets", () => {
  for (const period of [1, 2, 3, 4, 5]) {
    const losing = match("losing", { sec: true, rank: 11, period, clock: 120, score: 21, otherScore: 24 });
    const tied = match("tied", { sec: true, rank: 11, period, clock: 120, score: 24, otherScore: 24 });
    assert.ok(gamePriority(tied).upset > 0);
    assert.equal(gamePriority(tied).upset, gamePriority(losing).upset * 0.75);
    for (const pair of [[tied, losing], [losing, tied]]) assert.equal(sortGames(pair)[0].id, "losing");
    assert.equal(classify(tied).upset, false, "interest does not label a tie as an actual upset");
    const recovered = match("recovered", { sec: true, rank: 11, period, clock: 120, score: 25, otherScore: 24 });
    assert.ok(gamePriority(recovered).upset < gamePriority(tied).upset);
    if (period < 4) assert.equal(gamePriority(recovered).upset, 0);
  }
  const lowRanked = match("low-ranked", { rank: 25, period: 3, score: 21, otherScore: 24 });
  const marqueeTie = match("marquee-tie", { rank: 1, otherRank: 2, period: 3, score: 24, otherScore: 24 });
  assert.equal(sortGames([lowRanked, marqueeTie])[0].id, "marquee-tie",
    "retained tie interest avoids making every minor upset beat a top-two tie");
});
