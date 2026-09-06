import test from "node:test";
import assert from "node:assert/strict";
import { bundle, game, scoreboard } from "./helpers.mjs";
const { viewGames, matchingBoard, expiredBoardKey } = await bundle("lib/scoreboard-views.ts");

test("daily badges and weekly ACC counts use their own boards and honor Hide finals", () => {
  const live = game();
  live.teams[0].rank = 5;
  const final = game({ id: "final", state: "final" });
  const acc = game({ id: "acc" });
  acc.teams[0].conferenceId = "1";
  const daily = scoreboard([live, final]);
  const weekly = scoreboard([acc], "2026-09-03", { endDate: "2026-09-07" });
  for (const active of ["watch", "acc", "top25", "close", "upset", "acc", "watch"]) {
    const counts = Object.fromEntries(["watch", "acc", "top25", "close", "upset"].map(f => [f, viewGames(f === "acc" ? weekly : daily, f).length]));
    assert.deepEqual(counts, { watch: 2, acc: 1, top25: 2, close: 2, upset: 1 }, active);
  }
  assert.equal(viewGames(daily, "close", true).length, 1);
  assert.equal(viewGames(weekly, "acc", true).length, 1);
  assert.equal(viewGames(null, "watch").length, 0);
});

test("a changed day or ACC week cannot display counts from the previous scope", () => {
  const daily = scoreboard([game()]);
  assert.equal(matchingBoard(daily, "2026-09-05"), daily);
  assert.equal(matchingBoard(daily, "2026-09-06"), null);
  const weekly = scoreboard([game()], "2026-09-03", { endDate: "2026-09-07" });
  assert.equal(matchingBoard(weekly, "2026-09-03", "2026-09-07"), weekly);
  assert.equal(matchingBoard(weekly, "2026-09-10", "2026-09-14"), null);
  assert.equal(matchingBoard(weekly, "2026-09-03"), null);
});

test("storage cleanup retains ACC history through the weekend and expires completed ranges", () => {
  const weekly = "ss:board:2026-09-03:2026-09-07";
  for (const cutoff of ["2026-09-04", "2026-09-05", "2026-09-06", "2026-09-07"]) {
    assert.equal(expiredBoardKey(weekly, cutoff), false);
  }
  assert.equal(expiredBoardKey(weekly, "2026-09-08"), true);
  assert.equal(expiredBoardKey("ss:board:2026-09-04:2026-09-04", "2026-09-05"), true);
  assert.equal(expiredBoardKey("ss:board:2026-09-05:2026-09-05", "2026-09-05"), false);
  assert.equal(expiredBoardKey("ss:hide-finals", "2026-09-05"), false);
});
