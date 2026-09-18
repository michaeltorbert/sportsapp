import test from "node:test";
import assert from "node:assert/strict";
import { bundle } from "./helpers.mjs";

test("CL-3 zero-leaf teardown and boundaries keep a safe first remount snapshot", async t => {
  const at = Date.parse("2026-09-06T04:01:00Z");
  t.mock.timers.enable({ apis: ["Date", "setInterval"], now: at });
  const saved = Object.fromEntries(["document", "window", "navigator"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const document = Object.assign(new EventTarget(), { hidden: false });
  Object.defineProperty(globalThis, "document", { configurable: true, value: document });
  Object.defineProperty(globalThis, "window", { configurable: true, value: new EventTarget() });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: true } });
  let stopEnvironment, stop;
  try {
    const clock = await bundle("lib/halftime-clock.ts");
    stopEnvironment = clock.retainHalftimeEnvironment();
    stop = clock.subscribeHalftimeClock(() => {});
    assert.equal(clock.halftimeClockSnapshot().now, at);
    stop(); stop = undefined;
    t.mock.timers.tick(20000);
    assert.equal(clock.halftimeClockSnapshot(), clock.halftimeServerSnapshot(), "render before subscribing cannot reuse an old number");
    document.hidden = true; document.dispatchEvent(new Event("visibilitychange"));
    document.hidden = false; document.dispatchEvent(new Event("visibilitychange"));
    assert.equal(clock.halftimeClockSnapshot(), clock.halftimeServerSnapshot(), "environment events with no leaves keep safe fallback");
    stop = clock.subscribeHalftimeClock(() => {});
    assert.equal(clock.halftimeClockSnapshot().now, at + 20000, "subscribe recomputes absolute current time");
  } finally {
    stop?.(); stopEnvironment?.();
    for (const [key, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
});
