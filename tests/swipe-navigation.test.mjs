import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

// The real module with React replaced by a minimal controlled runtime; no browser or DOM library.
const root = fileURLToPath(new URL("..", import.meta.url));
const output = await build({
  entryPoints: ["lib/swipe-navigation.ts"], absWorkingDir: root, bundle: true, platform: "node", format: "esm", write: false,
  plugins: [{ name: "swipe-test-runtime", setup(build) {
    build.onResolve({ filter: /^react$/ }, args => ({ path: args.path, namespace: "test" }));
    build.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: "export const useRef=(...a)=>globalThis.swipeTest.useRef(...a), useEffect=(...a)=>globalThis.swipeTest.useEffect(...a), useLayoutEffect=(...a)=>globalThis.swipeTest.useLayoutEffect(...a);" }));
  } }],
});
const { EDGE, COMMIT, SLOP, canStart, follow, release, swipeTarget, useSwipeNavigation } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`);

// A tiny element tree: tag, classes, parent, and the selectors the module uses.
class FakeElement extends EventTarget {
  constructor(tag = "div", classes = [], parent = null) { super(); Object.assign(this, { tag, classes, parent, dataset: {}, hidden: false }); }
  contains(other) { return !!other && (other === this || this.contains(other.parent)); }
  matches(selector) { return selector.split(",").map(s => s.trim()).some(s => s.startsWith(".") ? this.classes.includes(s.slice(1)) : s === "[hidden]" ? this.hidden : s === this.tag); }
  closest(selector) { return this.matches(selector) ? this : this.parent?.closest(selector) ?? null; }
}
const touch = { pointerType: "touch", isPrimary: true, button: 0 };

test("a swipe starts only from one primary touch away from both 32 px edges at normal scale", () => {
  assert.equal(EDGE, 32);
  assert.equal(canStart({ ...touch, clientX: 32 }, 390, 1), true);
  assert.equal(canStart({ ...touch, clientX: 31 }, 390, 1), false);
  assert.equal(canStart({ ...touch, clientX: 358 }, 390, 1), true);
  assert.equal(canStart({ ...touch, clientX: 359 }, 390, 1), false);
  assert.equal(canStart({ ...touch, clientX: 200, pointerType: "mouse" }, 390, 1), false, "mouse drags never swipe");
  assert.equal(canStart({ ...touch, clientX: 200, pointerType: "pen" }, 390, 1), false);
  assert.equal(canStart({ ...touch, clientX: 200, isPrimary: false }, 390, 1), false, "a second finger never starts one");
  assert.equal(canStart({ ...touch, clientX: 200 }, 390, 1.01), true);
  assert.equal(canStart({ ...touch, clientX: 200 }, 390, 1.02), false, "zoomed in, the browser pans");
});

test("direction is judged once past the slop; vertical or diagonal intent abandons permanently", () => {
  assert.equal(follow("pending", SLOP - 1, 0), "pending");
  assert.equal(follow("pending", -SLOP, 0), "horizontal");
  assert.equal(follow("pending", 20, 10), "horizontal");
  assert.equal(follow("pending", 0, SLOP), "abandoned", "vertical scroll");
  assert.equal(follow("pending", 20, 11), "abandoned", "diagonal");
  assert.equal(follow("abandoned", -200, 0), "abandoned", "never resumes");
  assert.equal(follow("horizontal", -80, 30), "horizontal");
  assert.equal(follow("horizontal", -80, 41), "abandoned", "turning vertical ends it");
});

test("release commits one step only for a deliberate horizontal travel: left is forward, right is back", () => {
  assert.equal(release("horizontal", -COMMIT, 0), 1);
  assert.equal(release("horizontal", COMMIT, 5), -1);
  assert.equal(release("horizontal", -(COMMIT - 1), 0), 0);
  assert.equal(release("pending", -200, 0), 0, "never judged horizontal while moving");
  assert.equal(release("pending", COMMIT * 3, 0), 0, "a release alone is not observed intent");
  assert.equal(release("abandoned", -200, 0), 0);
  assert.equal(release("horizontal", -100, 60), 0, "ends diagonal");
});

test("swipes start on a game card's link or the region itself, never on another control or outside", () => {
  const outside = new FakeElement("main"), region = new FakeElement("section", ["score-content"], outside);
  const card = new FakeElement("a", ["game-summary"], new FakeElement("article", ["game-card"], region));
  const inner = new FakeElement("span", ["team-label"], card), button = new FakeElement("button", [], region), text = new FakeElement("p", [], region);
  assert.equal(swipeTarget(inner, region), card);
  assert.equal(swipeTarget(card, region), card);
  assert.equal(swipeTarget(text, region), region);
  assert.equal(swipeTarget(region, region), region);
  assert.equal(swipeTarget(button, region), null);
  assert.equal(swipeTarget(new FakeElement("span", [], button), region), null);
  assert.equal(swipeTarget(new FakeElement("a", [], region), region), null, "an ordinary link");
  assert.equal(swipeTarget(outside, region), null);
});

// Mounts the real hook against fake window, document and visual viewport objects.
function mount(t, { enabled = true } = {}) {
  const win = new EventTarget(), doc = new EventTarget(), viewport = new EventTarget();
  Object.assign(viewport, { scale: 1 });
  Object.assign(doc, { hidden: false, dialog: false, querySelector: () => doc.dialog ? {} : null });
  const region = new FakeElement("section", ["score-content"]);
  const card = new FakeElement("a", ["game-summary"], new FakeElement("article", ["game-card"], region));
  const other = new FakeElement("a", ["game-summary"], new FakeElement("article", ["game-card"], region));
  const control = new FakeElement("button", [], region);
  const steps = [], refs = [], effects = [], layouts = [];
  let cursor = 0, layoutCursor = 0;
  const saved = new Map();
  const replace = (name, value) => { saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { configurable: true, writable: true, value }); };
  const changed = (a, b) => !a || !b || a.length !== b.length || a.some((d, i) => d !== b[i]);
  replace("swipeTest", {
    useRef: initial => (refs[cursor] ||= { current: initial }, refs[cursor++]),
    useEffect: (fn, deps) => { effects.push({ fn, deps }); },
    // Layout effects run during the render here, with React's dependency rule.
    useLayoutEffect: (fn, deps) => { const i = layoutCursor++; if (!deps || changed(layouts[i], deps)) { layouts[i] = deps; fn(); } },
  });
  replace("window", { innerWidth: 390, visualViewport: viewport, setTimeout, clearTimeout });
  replace("document", doc);
  replace("Element", FakeElement); replace("Node", FakeElement);
  replace("addEventListener", win.addEventListener.bind(win)); replace("removeEventListener", win.removeEventListener.bind(win));
  let cleanup = null, lastDeps = null, context = "day:2026-09-05", on = enabled;
  // A named component, as the page uses the hook; the controlled runtime above supplies React.
  function Harness({ on, context }) { return useSwipeNavigation(on, context, step => steps.push(step)); }
  const render = (next = on, nextContext = context) => {
    on = next; context = nextContext; cursor = 0; layoutCursor = 0; effects.length = 0;
    const ref = Harness({ on, context });
    ref.current = region;
    const effect = effects[0];
    if (changed(lastDeps, effect.deps)) { cleanup?.(); cleanup = effect.fn() ?? null; lastDeps = effect.deps; }
  };
  render(enabled);
  t.after(() => { cleanup?.(); for (const [name, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } });
  const pointer = (type, target, x, y, { id = 1, pointerType = "touch", isPrimary = true } = {}) => {
    const event = new Event(type);
    Object.defineProperties(event, { target: { value: target }, pointerId: { value: id }, pointerType: { value: pointerType }, isPrimary: { value: isPrimary }, button: { value: type === "pointermove" ? -1 : 0 }, clientX: { value: x }, clientY: { value: y } });
    win.dispatchEvent(event);
  };
  // The touch event browsers dispatch right after a touch's pointerup or pointercancel.
  const touchend = (type = "touchend") => win.dispatchEvent(new Event(type));
  // A finger travels in small moves, as a real drag reports them, and ends with its touchend
  // (`touchEvents: false` is pointer-only input, such as WebKit's synthetic test events).
  const swipe = (target, dx, dy = 0, { x = 200, y = 300, id = 1, end = "pointerup", touchEvents = true, ...rest } = {}) => {
    pointer("pointerdown", target, x, y, { id, ...rest });
    for (let i = 1; i <= 8; i++) pointer("pointermove", target, x + dx * i / 8, y + dy * i / 8, { id, ...rest });
    pointer(end, target, x + dx, y + dy, { id, ...rest });
    if (touchEvents && (rest.pointerType ?? "touch") === "touch") touchend(end === "pointercancel" ? "touchcancel" : "touchend");
  };
  const click = (target, detail = 1) => {
    const event = new Event("click", { cancelable: true });
    let stopped = false;
    Object.defineProperties(event, { target: { value: target }, detail: { value: detail } });
    const stop = event.stopPropagation.bind(event);
    event.stopPropagation = () => { stopped = true; stop(); };
    region.dispatchEvent(event);
    return { prevented: event.defaultPrevented, stopped };
  };
  // A touchmove on the region, as browsers dispatch it after the same move's pointermove.
  const touchmove = (touches = 1, cancelable = true) => {
    const event = new Event("touchmove", { cancelable });
    Object.defineProperty(event, "touches", { value: { length: touches } });
    region.dispatchEvent(event);
    return event.defaultPrevented;
  };
  return { region, card, other, control, viewport, doc, win, steps, pointer, swipe, touchend, touchmove, click, render };
}

test("one deliberate horizontal swipe commits exactly one step in each direction", t => {
  const h = mount(t);
  h.swipe(h.card, -120); assert.deepEqual(h.steps, [1]);
  h.swipe(h.region, 120); assert.deepEqual(h.steps, [1, -1]);
  // Moves and releases after a commit belong to no gesture.
  h.pointer("pointermove", h.card, 20, 300); h.pointer("pointerup", h.card, 10, 300);
  assert.deepEqual(h.steps, [1, -1]);
  h.swipe(h.card, -(COMMIT - 5)); assert.deepEqual(h.steps, [1, -1], "a short pull does nothing");
});

test("vertical scrolling, diagonal drags, controls, edges, mouse drags and taps never step", t => {
  const h = mount(t);
  h.swipe(h.card, 0, -300); h.swipe(h.card, 90, -80);
  // Vertical first, then sideways: abandonment is permanent for that contact.
  h.pointer("pointerdown", h.card, 200, 300); h.pointer("pointermove", h.card, 200, 280); h.pointer("pointermove", h.card, 60, 280); h.pointer("pointerup", h.card, 60, 280);
  h.swipe(h.control, -150);
  h.swipe(h.region, 150, 0, { x: 20 }); h.swipe(h.region, -150, 0, { x: 375 });
  h.swipe(h.card, -150, 0, { pointerType: "mouse" });
  h.pointer("pointerdown", h.card, 200, 300); h.pointer("pointerup", h.card, 201, 300);
  assert.deepEqual(h.steps, []);
});

test("a second finger, pointercancel, resize, a hidden page or an opening panel abandons the gesture", t => {
  const h = mount(t);
  const partial = (id = 1) => { h.pointer("pointerdown", h.card, 200, 300, { id }); for (let x = 190; x >= 120; x -= 10) h.pointer("pointermove", h.card, x, 300, { id }); };
  partial(); h.pointer("pointerdown", h.region, 300, 300, { id: 2, isPrimary: false }); h.pointer("pointerup", h.card, 60, 300);
  partial(); h.pointer("pointercancel", h.card, 100, 300); h.pointer("pointerup", h.card, 60, 300);
  partial(); h.win.dispatchEvent(new Event("resize")); h.pointer("pointerup", h.card, 60, 300);
  partial(); h.doc.hidden = true; h.doc.dispatchEvent(new Event("visibilitychange")); h.doc.hidden = false; h.pointer("pointerup", h.card, 60, 300);
  partial(); h.doc.dialog = true; h.pointer("pointermove", h.card, 80, 300); h.doc.dialog = false; h.pointer("pointerup", h.card, 60, 300);
  // Another pointer's events never commit or move this gesture.
  partial(); h.pointer("pointerup", h.card, 60, 300, { id: 9 }); h.pointer("pointercancel", h.card, 60, 300);
  assert.deepEqual(h.steps, []);
  h.doc.dialog = true; h.swipe(h.card, -150); h.doc.dialog = false;
  h.region.hidden = true; h.swipe(h.card, -150); h.region.hidden = false;
  assert.deepEqual(h.steps, [], "nothing starts under an open panel or on the hidden scoreboard");
  h.swipe(h.card, -150); assert.deepEqual(h.steps, [1], "recognition resumes afterwards");
});

test("zooming in marks the region for default panning and stops swipes; normal scale restores both", t => {
  const h = mount(t);
  h.viewport.scale = 2; h.viewport.dispatchEvent(new Event("resize"));
  assert.equal("zoomed" in h.region.dataset, true);
  h.swipe(h.card, -150); assert.deepEqual(h.steps, []);
  h.viewport.scale = 1; h.viewport.dispatchEvent(new Event("scroll"));
  assert.equal("zoomed" in h.region.dataset, false);
  h.swipe(h.card, -150); assert.deepEqual(h.steps, [1]);
  // Zooming during a gesture abandons it.
  h.pointer("pointerdown", h.card, 200, 300); h.pointer("pointermove", h.card, 150, 300);
  h.viewport.scale = 1.5; h.viewport.dispatchEvent(new Event("resize"));
  h.viewport.scale = 1; h.pointer("pointerup", h.card, 60, 300);
  assert.deepEqual(h.steps, [1]);
});

test("a visual viewport resize at normal scale, or a change of displayed period or range, abandons the gesture", t => {
  const h = mount(t);
  const partial = () => { h.pointer("pointerdown", h.card, 200, 300); for (let x = 190; x >= 120; x -= 10) h.pointer("pointermove", h.card, x, 300); };
  partial(); h.viewport.dispatchEvent(new Event("resize")); h.pointer("pointerup", h.card, 60, 300);
  assert.equal("zoomed" in h.region.dataset, false);
  partial(); h.render(true, "day:2026-09-06"); h.pointer("pointerup", h.card, 60, 300);
  partial(); h.render(true, "week:2026-09-03"); h.pointer("pointerup", h.card, 60, 300);
  assert.deepEqual(h.steps, []);
  // An unchanged context re-render keeps the gesture.
  partial(); h.render(true, "week:2026-09-03"); h.pointer("pointerup", h.card, 60, 300); h.touchend();
  assert.deepEqual(h.steps, [1]);
});

test("a released swipe steps only after its touch sequence ends, so the touched node is still attached for touchend", t => {
  const h = mount(t);
  h.pointer("pointerdown", h.card, 200, 300);
  for (let x = 190; x >= 60; x -= 10) h.pointer("pointermove", h.card, x, 300);
  h.pointer("pointerup", h.card, 60, 300);
  assert.deepEqual(h.steps, [], "no step, so no re-render, between pointerup and the same touch's touchend");
  h.touchend();
  assert.deepEqual(h.steps, [1], "the touchend reaching window completes the step");
  h.touchend(); assert.deepEqual(h.steps, [1], "one step per swipe");
  // A touchcancel after release ends the sequence too.
  h.swipe(h.card, 150, 0, { touchEvents: false }); h.touchend("touchcancel");
  assert.deepEqual(h.steps, [1, -1]);
  // The suppression record armed at release still swallows that touch's compatibility click.
  assert.deepEqual(h.click(h.card), { prevented: true, stopped: true });
});

test("only a touch judged horizontal has its touchmoves consumed; scrolling, pending, multi-finger, zoomed and finished touches stay with the browser", t => {
  const h = mount(t);
  h.pointer("pointerdown", h.card, 200, 300);
  h.pointer("pointermove", h.card, 196, 300);
  assert.equal(h.touchmove(), false, "pending within the slop");
  h.pointer("pointermove", h.card, 180, 302);
  assert.equal(h.touchmove(), true, "the move that locks horizontal intent is consumed");
  h.pointer("pointermove", h.card, 140, 305);
  assert.equal(h.touchmove(), true);
  assert.equal(h.touchmove(2), false, "a second finger is never consumed");
  assert.equal(h.touchmove(1, false), false, "an uncancelable move is left alone");
  h.pointer("pointerup", h.card, 120, 305); h.touchend();
  assert.deepEqual(h.steps, [1]);
  assert.equal(h.touchmove(), false, "nothing after the touch ends");
  // Vertical scrolling: abandoned for good, never consumed, even if it later turns sideways.
  h.pointer("pointerdown", h.card, 200, 300);
  h.pointer("pointermove", h.card, 200, 280);
  assert.equal(h.touchmove(), false);
  h.pointer("pointermove", h.card, 100, 280);
  assert.equal(h.touchmove(), false);
  h.pointer("pointercancel", h.card, 100, 280); h.touchend("touchcancel");
  // A horizontal swipe that turns vertical stops being consumed at once.
  h.pointer("pointerdown", h.card, 200, 300);
  h.pointer("pointermove", h.card, 170, 300);
  assert.equal(h.touchmove(), true);
  h.pointer("pointermove", h.card, 160, 330);
  assert.equal(h.touchmove(), false);
  h.pointer("pointerup", h.card, 160, 330); h.touchend();
  // Edge starts, controls and zoomed pages are never tracked, so never consumed.
  h.pointer("pointerdown", h.region, 20, 300); h.pointer("pointermove", h.region, 60, 300);
  assert.equal(h.touchmove(), false); h.pointer("pointerup", h.region, 60, 300); h.touchend();
  h.pointer("pointerdown", h.control, 200, 300); h.pointer("pointermove", h.control, 150, 300);
  assert.equal(h.touchmove(), false); h.pointer("pointerup", h.control, 150, 300); h.touchend();
  h.viewport.scale = 2; h.viewport.dispatchEvent(new Event("resize"));
  h.pointer("pointerdown", h.card, 200, 300); h.pointer("pointermove", h.card, 150, 300);
  assert.equal(h.touchmove(), false); h.pointer("pointerup", h.card, 150, 300); h.touchend();
  assert.deepEqual(h.steps, [1]);
});

test("disabling removes the touchmove consumer", t => {
  const h = mount(t);
  h.pointer("pointerdown", h.card, 200, 300); h.pointer("pointermove", h.card, 170, 300);
  h.render(false);
  assert.equal(h.touchmove(), false);
});

test("pointer-only input without touch events steps on the next task, and a new contact first completes a pending step", async t => {
  const h = mount(t);
  h.swipe(h.card, -150, 0, { touchEvents: false });
  assert.deepEqual(h.steps, []);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(h.steps, [1]);
  h.swipe(h.card, 150, 0, { touchEvents: false });
  h.pointer("pointerdown", h.card, 200, 300);
  assert.deepEqual(h.steps, [1, -1], "the pending step lands before the next touch is judged");
  h.pointer("pointerup", h.card, 200, 300);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(h.steps, [1, -1]);
});

test("disabling between release and touchend drops the pending step", async t => {
  const h = mount(t);
  h.swipe(h.card, -150, 0, { touchEvents: false });
  h.render(false);
  h.touchend();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(h.steps, []);
});

test("the range change a commit causes keeps that swipe's compatibility-click record", t => {
  const h = mount(t);
  h.swipe(h.card, -150);
  h.render(true, "day:2026-09-06");
  assert.deepEqual(h.click(h.card), { prevented: true, stopped: true });
  assert.deepEqual(h.steps, [1]);
});

test("disabling (a game or team screen opens) ends the gesture and removes every listener", t => {
  const h = mount(t);
  h.pointer("pointerdown", h.card, 200, 300); h.pointer("pointermove", h.card, 150, 300);
  h.render(false);
  h.pointer("pointermove", h.card, 100, 300); h.pointer("pointerup", h.card, 60, 300);
  h.swipe(h.card, -150);
  assert.deepEqual(h.steps, []);
  h.render(true); h.swipe(h.card, -150); assert.deepEqual(h.steps, [1]);
});

test("only the committed touch's own compatibility click is swallowed; keyboard, other targets and the next tap pass", t => {
  const h = mount(t);
  h.swipe(h.card, -150);
  assert.deepEqual(h.click(h.card, 0), { prevented: false, stopped: false }, "keyboard or programmatic activation");
  assert.deepEqual(h.click(h.other), { prevented: false, stopped: false }, "a click elsewhere");
  assert.deepEqual(h.click(h.card), { prevented: true, stopped: true }, "the swipe's own click");
  assert.deepEqual(h.click(h.card), { prevented: false, stopped: false }, "only one");
  // A new contact clears the record before its own click.
  h.swipe(h.card, -150);
  h.pointer("pointerdown", h.card, 200, 300); h.pointer("pointerup", h.card, 200, 300);
  assert.deepEqual(h.click(h.card), { prevented: false, stopped: false }, "an immediate ordinary tap opens the game");
  // A swipe on the region's own space swallows a click there, never one on a card it did not start on.
  h.swipe(h.region, 150);
  assert.deepEqual(h.click(h.card), { prevented: true, stopped: true }, "the card is inside the region the swipe started on");
  assert.deepEqual(h.steps, [1, 1, -1]);
  // Nothing is armed without a commit.
  h.swipe(h.card, 0, -200);
  assert.deepEqual(h.click(h.card), { prevented: false, stopped: false });
});
