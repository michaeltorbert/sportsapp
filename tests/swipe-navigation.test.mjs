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
const { EDGE, COMMIT, SLOP, GAP, TAP_WAIT, canStart, follow, release, revealed, bounded, settleStart, swipeTarget, useSwipeNavigation } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`);

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

test("issue 172 motion geometry: the held offset reveals its side, stays within one pane, and a commit starts where the neighbor was", () => {
  assert.equal(revealed(-1), 1, "results moved left show the next range");
  assert.equal(revealed(1), -1);
  assert.equal(revealed(0), 0);
  assert.equal(bounded(-900, 430), -430); assert.equal(bounded(900, 430), 430); assert.equal(bounded(-120, 430), -120);
  // The neighbor sits one pitch beside the results, so the new results start exactly where it was painted.
  assert.equal(settleStart(-120, 1, 390 + GAP), 310);
  assert.equal(settleStart(95, -1, 390 + GAP), -335);
});

// Mounts the real hook against fake window, document and visual viewport objects. With `motion`, the
// region has a fake `.pager-track` whose style changes are recorded, and frames run when flushed.
function mount(t, { enabled = true, motion = false, reduced = false, moved = true } = {}) {
  const win = new EventTarget(), doc = new EventTarget(), viewport = new EventTarget();
  Object.assign(viewport, { scale: 1 });
  // `covers`: the bottoms of elements pinned over the results (the sticky category row).
  const covers = [];
  Object.assign(doc, { hidden: false, dialog: false, querySelector: () => doc.dialog ? {} : null, querySelectorAll: selector => selector === "[data-pager-cover]" ? covers.map(bottom => ({ getBoundingClientRect: () => ({ bottom }) })) : [] });
  const region = new FakeElement("section", ["score-content"]);
  const card = new FakeElement("a", ["game-summary"], new FakeElement("article", ["game-card"], region));
  const other = new FakeElement("a", ["game-summary"], new FakeElement("article", ["game-card"], region));
  const control = new FakeElement("button", [], region);
  const transforms = [], frames = [], reveals = [], settled = [];
  const track = new FakeElement("div", ["pager-track"], region);
  // `painted` is what getComputedStyle reports: a settle's current, mid-transition position.
  Object.assign(track, { offsetWidth: 390, painted: "none", style: { transition: "", current: "", get transform() { return this.current; }, set transform(value) { this.current = value; transforms.push(value); } } });
  if (motion) Object.assign(region, {
    querySelector: selector => selector === ":scope > .pager-track" ? track : null,
    getBoundingClientRect: () => ({ top: 100, height: 400 }),
    style: { height: "", setProperty(name, value) { this[name] = value; }, removeProperty(name) { delete this[name]; } },
  });
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
  replace("window", { innerWidth: 390, visualViewport: viewport, setTimeout, clearTimeout,
    ...(motion ? { requestAnimationFrame: fn => frames.push(fn), cancelAnimationFrame() {}, matchMedia: () => ({ matches: reduced }) } : {}) });
  replace("document", doc);
  replace("Element", FakeElement); replace("Node", FakeElement);
  replace("addEventListener", win.addEventListener.bind(win)); replace("removeEventListener", win.removeEventListener.bind(win));
  if (motion) {
    replace("getComputedStyle", element => ({ transform: element.painted }));
    replace("DOMMatrixReadOnly", class { constructor(value) { this.m41 = Number(/^matrix\(1, 0, 0, 1, (-?[\d.]+), 0\)$/.exec(value)[1]); } });
  }
  let cleanup = null, lastDeps = null, context = "day:2026-09-05", on = enabled;
  const pager = motion ? { reveal: (side, gesture) => reveals.push([side, gesture]), settled: () => settled.push(true) } : undefined;
  // A named component, as the page uses the hook; the controlled runtime above supplies React.
  function Harness({ on, context }) { return useSwipeNavigation(on, context, step => { steps.push(step); return moved; }, pager); }
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
  const flush = () => { while (frames.length) frames.shift()(); };
  const transitionend = () => { const event = new Event("transitionend"); Object.defineProperty(event, "propertyName", { value: "transform" }); track.dispatchEvent(event); };
  return { region, card, other, control, viewport, doc, win, steps, pointer, swipe, touchend, touchmove, click, render, track, transforms, reveals, settled, flush, transitionend, covers };
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
  // Nothing is armed without a horizontal drag.
  h.swipe(h.card, 0, -200);
  assert.deepEqual(h.click(h.card), { prevented: false, stopped: false });
  // A short horizontal pull that slides back arms its own click record too, and the next tap still passes.
  h.swipe(h.card, -(COMMIT - 10));
  assert.deepEqual(h.click(h.card), { prevented: true, stopped: true });
  h.pointer("pointerdown", h.card, 200, 300); h.pointer("pointerup", h.card, 200, 300);
  assert.deepEqual(h.click(h.card), { prevented: false, stopped: false });
  assert.deepEqual(h.steps, [1, 1, -1]);
});

// Issue 172 motion. A drag `from` x 200 to `to`, one move per 10 px, then release (and touchend).
function hold(h, to, { target = h.card, from = 200 } = {}) {
  h.pointer("pointerdown", target, from, 300);
  for (let x = from; x !== to;) { x += Math.sign(to - x) * Math.min(10, Math.abs(to - x)); h.pointer("pointermove", target, x, 300); }
}
// A committed forward swipe and the range change it causes, which starts its settle.
function commitForward(h, context = "day:2026-09-06") {
  hold(h, 80); h.flush(); h.pointer("pointerup", h.card, 80, 300); h.touchend();
  h.render(true, context);
}

test("issue 172 held drag: the track follows the finger 1:1, reveals the uncovered side, and a short release slides back without a step", t => {
  const h = mount(t, { motion: true });
  h.pointer("pointerdown", h.card, 200, 300); h.pointer("pointermove", h.card, 195, 300); h.flush();
  assert.deepEqual(h.transforms, [], "nothing moves within the slop");
  h.pointer("pointermove", h.card, 180, 300); h.flush();
  assert.equal(h.track.style.transform, "translate3d(-20px, 0, 0)");
  assert.equal(h.region.dataset.pager, "drag"); assert.equal(h.region.style.height, "400px", "the region keeps its height while held");
  assert.equal(h.region.style["--pager-cue"], "0px", "the results' top is on screen, so the date cue sits there");
  for (const x of [170, 160, 150]) h.pointer("pointermove", h.card, x, 300);
  assert.equal(h.track.style.transform, "translate3d(-20px, 0, 0)", "moves wait for the next frame");
  h.flush(); assert.equal(h.track.style.transform, "translate3d(-50px, 0, 0)", "one paint per frame, at the latest offset");
  h.pointer("pointermove", h.card, 230, 300); h.flush();
  assert.equal(h.track.style.transform, "translate3d(30px, 0, 0)");
  assert.deepEqual(h.reveals, [[1, 1], [-1, 1]], "next, then previous after reversing, both in drag 1");
  h.pointer("pointerup", h.card, 230, 300); h.touchend();
  assert.deepEqual(h.steps, [], "30 px commits nothing");
  assert.equal(h.region.dataset.pager, "settle");
  assert.deepEqual(h.transforms.slice(-2), ["translate3d(30px, 0, 0)", "translate3d(0px, 0, 0)"], "the slide back starts where the results were");
  h.transitionend();
  assert.equal(h.track.style.transform, ""); assert.equal(h.region.style.height, ""); assert.equal("pager" in h.region.dataset, false);
  assert.deepEqual(h.reveals.at(-1), [0, 1], "the neighbor goes once at rest");
  assert.deepEqual(h.settled, [], "nothing was left");
  assert.deepEqual(h.click(h.card), { prevented: true, stopped: true }, "the slide back still swallows that touch's own click");
  // Turning vertical mid-drag slides back too; nothing steps.
  hold(h, 150); h.pointer("pointermove", h.card, 150, 340); h.flush();
  assert.equal(h.region.dataset.pager, "settle"); h.transitionend();
  h.pointer("pointerup", h.card, 150, 340); h.touchend();
  assert.deepEqual(h.steps, []);
});

test("issue 172 the date cue sits below the screen top and the pinned category row, and stays inside the held results", t => {
  const h = mount(t, { motion: true });
  // The results' top (100) is below the category row's bottom (60): the cue is at the results' top.
  h.covers.push(60); hold(h, 150);
  assert.equal(h.region.style["--pager-cue"], "0px");
  h.pointer("pointerup", h.card, 150, 300); h.touchend(); h.transitionend();
  // Scrolled: the row is pinned at 0–60 and the results started 300 px above the screen.
  h.region.getBoundingClientRect = () => ({ top: -300, height: 2000 });
  hold(h, 150);
  assert.equal(h.region.style["--pager-cue"], `${60 + 8 + 300}px`, "just below the pinned row");
  h.pointer("pointerup", h.card, 150, 300); h.touchend(); h.transitionend();
  // Never below the held results' last 48 px.
  h.region.getBoundingClientRect = () => ({ top: -300, height: 360 });
  hold(h, 150);
  assert.equal(h.region.style["--pager-cue"], "312px");
});

test("issue 172 commit: the step lands at touchend, and its own range change settles the new results from the neighbor's place", t => {
  const h = mount(t, { motion: true });
  hold(h, 80); h.flush(); h.pointer("pointerup", h.card, 80, 300);
  assert.deepEqual(h.steps, []); assert.equal(h.track.style.transform, "translate3d(-120px, 0, 0)", "held in place until the touch ends");
  h.touchend(); assert.deepEqual(h.steps, [1]);
  assert.equal(h.region.dataset.pager, "drag", "nothing settles before the new range renders");
  h.render(true, "day:2026-09-06");
  assert.deepEqual(h.transforms.slice(-2), [`translate3d(${-120 + 390 + GAP}px, 0, 0)`, "translate3d(0px, 0, 0)"]);
  assert.equal(h.region.style.height, "", "the new results take their own height");
  assert.equal(h.region.dataset.pager, "settle"); assert.deepEqual(h.settled, []);
  h.transitionend();
  assert.deepEqual(h.settled, [true], "the view being left goes once settled"); assert.equal(h.track.style.transform, "");
  assert.deepEqual(h.reveals, [[1, 1]]);
  assert.deepEqual(h.click(h.card), { prevented: true, stopped: true });
  // A range change the swipe did not cause ends a held drag at once, with no step.
  hold(h, 150); h.flush();
  h.render(true, "day:2026-09-09");
  assert.equal(h.track.style.transform, ""); assert.equal(h.region.style.height, ""); assert.deepEqual(h.reveals.at(-1), [0, 2]);
  h.pointer("pointerup", h.card, 60, 300); h.touchend();
  assert.deepEqual(h.steps, [1]);
});

test("issue 172 a step that moves nowhere slides back and drops the view being left", t => {
  const nowhere = mount(t, { motion: true, moved: false });
  hold(nowhere, 80); nowhere.flush(); nowhere.pointer("pointerup", nowhere.card, 80, 300); nowhere.touchend();
  assert.deepEqual(nowhere.steps, [1]); assert.equal(nowhere.region.dataset.pager, "settle");
  nowhere.transitionend(); assert.deepEqual(nowhere.settled, [true]); assert.equal(nowhere.track.style.transform, "");
});

test("issue 172 reduced motion: the drag still follows the finger; release, commit and slide back need no transition", t => {
  const h = mount(t, { motion: true, reduced: true });
  hold(h, 170); h.flush();
  assert.equal(h.track.style.transform, "translate3d(-30px, 0, 0)", "direct manipulation is kept");
  h.pointer("pointerup", h.card, 170, 300); h.touchend();
  assert.equal(h.track.style.transform, ""); assert.deepEqual(h.reveals.at(-1), [0, 1]);
  commitForward(h);
  assert.deepEqual(h.steps, [1]); assert.equal(h.track.style.transform, ""); assert.deepEqual(h.settled, [true]);
  assert.equal("pager" in h.region.dataset, false);
});

test("issue 172 a contact on settling results stops them where painted; its tap keeps its click and the settle then resumes", async t => {
  const h = mount(t, { motion: true });
  commitForward(h);
  h.track.painted = "matrix(1, 0, 0, 1, 155, 0)";
  h.pointer("pointerdown", h.other, 200, 300);
  assert.equal(h.track.style.transform, "translate3d(155px, 0, 0)"); assert.equal(h.track.style.transition, "none");
  h.transitionend(); assert.equal(h.track.style.transform, "translate3d(155px, 0, 0)", "the stopped settle's end does not move it");
  h.pointer("pointerup", h.other, 201, 300); h.touchend();
  assert.deepEqual(h.click(h.other), { prevented: false, stopped: false }, "the tap's own click reaches the game under the finger");
  assert.equal(h.track.style.transform, "translate3d(155px, 0, 0)", "still in place while its click runs");
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(h.transforms.slice(-2), ["translate3d(155px, 0, 0)", "translate3d(0px, 0, 0)"], "then it resumes from there");
  h.transitionend(); assert.deepEqual(h.settled, [true]); assert.deepEqual(h.steps, [1], "no deferred navigation");
});

test("issue 172 a stopped settle resumes after a tap without a click, or at once when the browser takes the touch to scroll", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = mount(t, { motion: true });
  commitForward(h);
  h.track.painted = "matrix(1, 0, 0, 1, 90, 0)";
  h.pointer("pointerdown", h.region, 200, 300); h.pointer("pointerup", h.region, 200, 300); h.touchend();
  t.mock.timers.tick(TAP_WAIT - 1); assert.equal(h.track.style.transform, "translate3d(90px, 0, 0)");
  t.mock.timers.tick(1); assert.equal(h.track.style.transform, "translate3d(0px, 0, 0)");
  h.track.painted = "matrix(1, 0, 0, 1, 40, 0)";
  h.pointer("pointerdown", h.card, 200, 300); h.pointer("pointermove", h.card, 200, 260);
  assert.equal(h.track.style.transform, "translate3d(40px, 0, 0)");
  h.pointer("pointercancel", h.card, 200, 260);
  assert.equal(h.track.style.transform, "translate3d(0px, 0, 0)", "a vertical scroll resumes it at once");
  h.transitionend(); assert.deepEqual(h.settled, [true]);
  // A contact outside the results ends a settle immediately; its control works as usual.
  commitForward(h, "day:2026-09-07");
  assert.equal(h.region.dataset.pager, "settle");
  h.pointer("pointerdown", new FakeElement("button"), 200, 100);
  assert.equal(h.track.style.transform, ""); assert.deepEqual(h.settled, [true, true]);
  assert.deepEqual(h.steps, [1, 1]);
});

test("issue 172 a new drag from a stopped settle continues from the painted place and gives the view being left way to neighbors", t => {
  const h = mount(t, { motion: true });
  commitForward(h);
  h.track.painted = "matrix(1, 0, 0, 1, 155, 0)";
  hold(h, 160); h.flush();
  assert.deepEqual(h.settled, [true], "the leaving view goes when the new drag locks");
  assert.equal(h.track.style.transform, "translate3d(115px, 0, 0)", "the frozen offset plus the new travel");
  assert.deepEqual(h.reveals, [[1, 1], [-1, 2]], "the side its offset uncovers, in drag 2");
  h.pointer("pointerup", h.card, 160, 300); h.touchend();
  assert.deepEqual(h.steps, [1], "40 px of new travel commits nothing");
  h.transitionend(); assert.equal(h.track.style.transform, "");
});
