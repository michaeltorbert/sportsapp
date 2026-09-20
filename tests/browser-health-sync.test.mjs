import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { consumeHealthAfter } from "./browser/health-sync.mjs";

test("health waiter rejection after a failed action preserves the original error", async () => {
  let rejectResponse;
  const response = new Promise((_, reject) => { rejectResponse = reject; });
  const page = { evaluate: async () => 0, waitForResponse: () => response };
  const original = new Error("original action failure");
  await assert.rejects(consumeHealthAfter(page, async () => { throw original; }), error => error === original);
  rejectResponse(new Error("page closed during teardown"));
  // node:test rejects unhandled rejections, including ones after the test body.
  await setImmediate();
});

test("health waiter failure during an action is observed and still propagated", async () => {
  let rejectResponse;
  const response = new Promise((_, reject) => { rejectResponse = reject; });
  const page = { evaluate: async () => 0, waitForResponse: () => response };
  const failure = new Error("health response unavailable");
  await assert.rejects(consumeHealthAfter(page, async () => {
    rejectResponse(failure);
    await setImmediate();
  }), error => error === failure);
});
