"use client";
import { useEffect, useLayoutEffect, useRef } from "react";

// Horizontal touch swipes on the Scores results step the displayed day or week (#172). The browser
// keeps vertical scrolling and pinch zoom (CSS `touch-action: pan-y pinch-zoom` on the region). This
// judges one primary touch's own pointer events and never captures them. Only once a touch is judged
// horizontal are its touchmoves consumed, so the browser generates no scroll or fling gesture for a
// touch the page owns (in Linux CI Chromium, the next tap after such a swipe otherwise made no click).
//
// With `motion`, the results follow a horizontal drag while the finger is down: the region's
// `.pager-track` child moves 1:1 with it, and the page renders the revealed neighbor beside the results
// (`reveal`). The date and address still change only once, at the existing release boundary. A
// committed step's new results then settle from where the neighbor was, beside an inert view of the
// range being left; a short, reversed or abandoned drag slides back. Settling is cosmetic: a contact on
// the moving results stops it where it is painted, so a tap lands on the game under the finger.
export const EDGE = 32; // CSS px at each side left to the browser's own edge navigation.
export const SLOP = 10; // Movement before the direction is judged.
export const COMMIT = 60; // Horizontal travel that commits on release.
export const ZOOMED = 1.01; // Above this visual viewport scale the browser pans freely and swiping is off.
export const GAP = 40; // CSS px between the results and a neighbor beside them (`--pager-gap` in globals.css).
export const SETTLE_MS = 260; // A committed step's settle, or a slide back.
// After a tap that stopped a settle, its click (if any) runs before the settle resumes.
export const TAP_WAIT = 300;
export type Axis = "pending" | "horizontal" | "abandoned";
export type Step = 1 | -1;
type Contact = { pointerType: string; isPrimary: boolean; button: number; clientX: number };

/** A swipe starts only from one primary touch, away from both screen edges, at normal scale. */
export function canStart(contact: Contact, viewportWidth: number, scale: number) {
  return contact.pointerType === "touch" && contact.isPrimary && contact.button === 0
    && contact.clientX >= EDGE && contact.clientX <= viewportWidth - EDGE && !(scale > ZOOMED);
}
/** Judges movement so far. Vertical or diagonal intent abandons the gesture for good. */
export function follow(axis: Axis, dx: number, dy: number): Axis {
  if (axis === "abandoned") return axis;
  const x = Math.abs(dx), y = Math.abs(dy);
  if (axis === "pending") return Math.max(x, y) < SLOP ? "pending" : x >= 2 * y ? "horizontal" : "abandoned";
  return 2 * y > x ? "abandoned" : "horizontal";
}
/** The step a released gesture commits: a left swipe goes forward (+1), a right swipe back (−1), else none. */
// Only a gesture already seen moving horizontally can commit; a release never judges intent by itself.
export function release(axis: Axis, dx: number, dy: number): Step | 0 {
  return axis === "horizontal" && follow(axis, dx, dy) === "horizontal" && Math.abs(dx) >= COMMIT ? (dx < 0 ? 1 : -1) : 0;
}
/** The neighbor a held offset reveals: results moved left show the next range (1), moved right the previous (−1). */
export function revealed(offset: number): Step | 0 { return offset < 0 ? 1 : offset > 0 ? -1 : 0; }
/** Held travel stays within one neighbor's width (`pitch`, the results' width plus the gap) either way. */
export function bounded(offset: number, pitch: number) { return Math.max(-pitch, Math.min(pitch, offset)); }
/** Where a committed step's new results start settling: exactly where its neighbor was painted. */
export function settleStart(offset: number, step: Step, pitch: number) { return offset + step * pitch; }
const CONTROLS = "a, button, input, label, select, textarea, summary, [contenteditable], [role=button]";
/** Where a swipe may start: a game card's link (returned) or the region itself; never another control. */
export function swipeTarget(target: Element, region: Element): Element | null {
  if (!region.contains(target)) return null;
  const card = target.closest(".game-summary");
  if (card && region.contains(card)) return card;
  const control = target.closest(CONTROLS);
  return control && region.contains(control) ? null : region;
}

export type SwipeMotion = {
  /** The neighbor shown beside the results during held drag number `gesture`; 0 when none is. */
  reveal(side: Step | 0, gesture: number): void;
  /** A committed step's settle has ended or was cut short, so the view being left can go. */
  settled(): void;
};
const translate = (x: number) => `translate3d(${x}px, 0, 0)`;

/**
 * Attach the returned ref to the results region. `onStep` runs once per committed swipe; it returns
 * false when it moved nowhere, which slides the results back. A gesture is abandoned by a second
 * contact, pointercancel, a window or visual viewport resize, zoom, a hidden page, an open panel,
 * disabling, or a change of `context` (the displayed period, range and filters).
 * After a horizontal drag, committed or not, only the one compatibility click from that touch, inside
 * the element where it started, is swallowed; keyboard and programmatic activation (detail 0) and the
 * next tap are not. A context change never clears that record, since a commit itself changes the
 * range before its click.
 */
export function useSwipeNavigation<T extends HTMLElement>(enabled: boolean, context: string, onStep: (step: Step) => boolean | void, motion?: SwipeMotion) {
  const region = useRef<T | null>(null);
  const latest = useRef(onStep), latestMotion = useRef(motion);
  const changed = useRef<(() => void) | null>(null);
  useLayoutEffect(() => { latest.current = onStep; latestMotion.current = motion; });
  useLayoutEffect(() => { changed.current?.(); }, [context]);
  useEffect(() => {
    const node = region.current;
    if (!node || !enabled) return;
    let gesture: { id: number; x: number; y: number; axis: Axis; target: Element; base: number } | null = null;
    let suppress: { target: Element; timer: number } | null = null;
    // A released swipe commits only once its touch sequence has ended. Committing inside pointerup let
    // the re-render remove the touched node before the same touch's touchend, which was then dispatched
    // to a detached node, never reaching window.
    // touchend or touchcancel commits; pointer-only input (no touch events) commits on the next task.
    let pending: { step: Step; timer: number } | null = null;
    // Motion. `phase`: idle; drag (held, horizontal); settle (moving by itself to rest); frozen (a
    // contact stopped a settle). `offset` is the track's displayed translation; `side` the neighbor
    // shown; `leaving` whether the page shows the view being left. `armed` is a committed step waiting
    // for its own range change, which starts the settle.
    let phase: "idle" | "drag" | "settle" | "frozen" = "idle", offset = 0, side: Step | 0 = 0, leaving = false, drags = 0;
    let armed: { step: Step; from: number; timer: number } | null = null;
    let frame = 0, settleTimer = 0, resumeTimer = 0, contact: number | null = null;
    const track = () => latestMotion.current ? node.querySelector<HTMLElement>(":scope > .pager-track") : null;
    const reduced = () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const pitch = () => (track()?.offsetWidth ?? node.offsetWidth) + GAP;
    const ended = (event: TransitionEvent) => { if (event.target === event.currentTarget && event.propertyName === "transform") finish(); };
    // Everything motion did is undone at once: no transform, held height or neighbor remains.
    const finish = () => {
      window.cancelAnimationFrame?.(frame); frame = 0;
      window.clearTimeout(settleTimer); window.clearTimeout(resumeTimer);
      if (armed) { window.clearTimeout(armed.timer); armed = null; }
      phase = "idle"; offset = 0; contact = null;
      if (!latestMotion.current) return;
      const moving = track();
      if (moving) { moving.removeEventListener("transitionend", ended); moving.style.transition = ""; moving.style.transform = ""; }
      node.style.height = ""; node.style.removeProperty("--pager-cue"); delete node.dataset.pager;
      if (side) { side = 0; latestMotion.current?.reveal(0, drags); }
      if (leaving) { leaving = false; latestMotion.current?.settled(); }
    };
    // Moves by itself from `from` to rest, then finishes. With reduced motion it finishes at once;
    // the end never depends on transitionend, which reduced motion's CSS never fires.
    const glide = (from: number) => {
      const moving = track();
      if (!moving || reduced()) { finish(); return; }
      window.cancelAnimationFrame?.(frame); frame = 0;
      window.clearTimeout(settleTimer); window.clearTimeout(resumeTimer);
      phase = "settle"; offset = 0; node.dataset.pager = "settle";
      moving.style.transition = "none"; moving.style.transform = translate(from);
      void moving.offsetWidth; // Starts from `from` as painted, not from an earlier style.
      moving.style.transition = `transform ${SETTLE_MS}ms cubic-bezier(.22, .8, .3, 1)`;
      moving.style.transform = translate(0);
      moving.addEventListener("transitionend", ended);
      settleTimer = window.setTimeout(finish, SETTLE_MS + 80);
    };
    // A contact on the moving results stops them where they are painted, before any further paint, so
    // the game under the finger stays there for the whole tap. The node and its content are kept.
    const freeze = () => {
      const moving = track();
      if (!moving) return;
      window.clearTimeout(settleTimer); window.clearTimeout(resumeTimer);
      moving.removeEventListener("transitionend", ended);
      const transform = getComputedStyle(moving).transform;
      offset = transform && transform !== "none" ? new DOMMatrixReadOnly(transform).m41 : 0;
      moving.style.transition = "none"; moving.style.transform = translate(offset);
      phase = "frozen";
    };
    // A stopping contact that did not become a new drag: settling continues after its activation
    // opportunity (its click, or a short wait without one). Opening a game ends it instead.
    const resume = () => { window.clearTimeout(resumeTimer); if (phase === "frozen" && !gesture && contact === null) glide(offset); };
    const resumeLater = () => { window.clearTimeout(resumeTimer); resumeTimer = window.setTimeout(resume, TAP_WAIT); };
    // The region keeps its height while held, so neighbors share the results' natural top and the page
    // never jumps; the date cue sits at the top of the visible part of the results.
    const hold = () => {
      const box = node.getBoundingClientRect();
      node.style.height = `${box.height}px`;
      node.style.setProperty("--pager-cue", `${Math.max(0, Math.min(12 - box.top, box.height - 160))}px`);
      node.dataset.pager = "drag";
    };
    const lock = () => {
      drags++; contact = null;
      window.clearTimeout(resumeTimer); window.clearTimeout(settleTimer);
      track()?.removeEventListener("transitionend", ended);
      // A drag from a stopped settle continues from the painted place; the view being left gives way
      // to the ordinary neighbors.
      if (leaving) { leaving = false; latestMotion.current?.settled(); }
      if (side) { side = 0; latestMotion.current?.reveal(0, drags); }
      hold(); phase = "drag";
    };
    const drag = (x: number) => {
      offset = bounded(x, pitch());
      const next = revealed(offset);
      if (next && next !== side) { side = next; latestMotion.current?.reveal(next, drags); }
      if (!frame) frame = window.requestAnimationFrame(() => {
        frame = 0;
        const moving = track();
        if (phase === "drag" && moving) { moving.style.transition = "none"; moving.style.transform = translate(offset); }
      });
    };
    // A committed step's own range change: its new results start where the neighbor was painted, and
    // the region takes their natural height, so the document clamps normally if they are shorter.
    const settle = () => {
      const { step, from, timer } = armed!;
      window.clearTimeout(timer); armed = null;
      side = 0; node.style.height = "";
      if (gesture) { finish(); return; } // Pointer-only input: the next contact already started.
      glide(settleStart(from, step, pitch()));
    };
    const commit = () => {
      if (!pending) return;
      const { step, timer } = pending;
      pending = null; window.clearTimeout(timer);
      if (phase !== "drag" || !latestMotion.current) { latest.current(step); return; }
      // Released past the threshold; a step that moved nowhere slides back. A range change that never
      // renders (not expected) is dropped after a second.
      // From here the page shows the view being left, until `settled`.
      armed = { step, from: offset, timer: window.setTimeout(finish, 1000) }; leaving = true;
      window.cancelAnimationFrame?.(frame); frame = 0;
      if (latest.current(step) === false) { window.clearTimeout(armed.timer); armed = null; glide(offset); }
    };
    const scale = () => window.visualViewport?.scale ?? 1;
    const blocked = () => document.hidden || scale() > ZOOMED || !!node.closest("[hidden]") || !!document.querySelector('[role="dialog"][data-state="open"]');
    // An interrupted drag returns at once; a released, committing one is left to its commit.
    const abandon = () => { gesture = null; if (phase === "drag" && !pending && !armed) finish(); };
    // Context changes, resizes and hiding also end any settle at once.
    const interrupt = () => { abandon(); if (!pending && !armed && phase !== "idle") finish(); };
    const disarm = () => { if (suppress) window.clearTimeout(suppress.timer); suppress = null; };
    // Zoomed in, the region returns to the browser's default panning (see globals.css).
    const zoom = () => { if (scale() > ZOOMED) { node.dataset.zoomed = ""; interrupt(); } else delete node.dataset.zoomed; };
    const down = (event: PointerEvent) => {
      // Any new contact ends the previous swipe's click suppression; a second finger ends a swipe.
      commit(); disarm();
      // Pointer-only input committed just now: there is no settle under a new contact.
      if (armed) finish();
      if (gesture) { if (phase === "drag") { gesture = null; glide(offset); } else abandon(); return; }
      const inside = event.target instanceof Node && node.contains(event.target);
      if (phase === "settle" || phase === "frozen") {
        if (inside) { if (phase === "settle") freeze(); window.clearTimeout(resumeTimer); contact = event.pointerId; }
        else finish();
      }
      const target = event.target instanceof Element ? swipeTarget(event.target, node) : null;
      if (!target || blocked() || !canStart(event, window.innerWidth, scale())) return;
      gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, axis: "pending", target, base: phase === "frozen" ? offset : 0 };
    };
    const move = (event: PointerEvent) => {
      if (!gesture || event.pointerId !== gesture.id) return;
      if (blocked()) { abandon(); return; }
      const dx = event.clientX - gesture.x, was = gesture.axis;
      gesture.axis = follow(was, dx, event.clientY - gesture.y);
      if (gesture.axis === "abandoned") {
        // Turning vertical mid-drag slides the results back.
        if (was === "horizontal" && phase === "drag") { gesture = null; glide(offset); } else abandon();
        return;
      }
      if (gesture.axis !== "horizontal" || !latestMotion.current) return;
      if (was !== "horizontal") lock();
      drag(gesture.base + dx);
    };
    const up = (event: PointerEvent) => {
      if (event.pointerId === contact) { contact = null; resumeLater(); }
      if (!gesture || event.pointerId !== gesture.id) return;
      const { x, y, axis, target } = gesture;
      gesture = null;
      if (blocked()) { interrupt(); return; }
      const step = release(axis, event.clientX - x, event.clientY - y);
      // The timer only clears a record no click arrived for; it never decides what is swallowed.
      if (axis === "horizontal") suppress = { target, timer: window.setTimeout(disarm, 1000) };
      if (!step) { if (phase === "drag") glide(offset); return; }
      pending = { step, timer: window.setTimeout(commit, 0) };
    };
    const cancel = (event: PointerEvent) => {
      if (event.pointerId === contact) { contact = null; resume(); }
      if (gesture && event.pointerId === gesture.id) abandon();
    };
    // The touchmove follows its pointermove, so the move that locks horizontal intent is itself consumed.
    // Pending, vertical, abandoned, multi-finger and zoomed touches are never consumed, so scrolling and
    // pinch zoom stay with the browser.
    const touchMove = (event: TouchEvent) => {
      if (gesture?.axis === "horizontal" && event.touches.length === 1 && event.cancelable) event.preventDefault();
    };
    const click = (event: MouseEvent) => {
      // A tap that stopped a settle has had its activation; the settle continues once its handlers ran.
      if (phase === "frozen" && contact === null) { window.clearTimeout(resumeTimer); resumeTimer = window.setTimeout(resume, 0); }
      if (!suppress || event.detail === 0 || !(event.target instanceof Node) || !suppress.target.contains(event.target)) return;
      disarm(); event.preventDefault(); event.stopPropagation();
    };
    const hidden = () => { if (document.hidden) interrupt(); };
    // Any visual viewport resize interrupts a gesture; its scroll (panning while zoomed) only updates zoom.
    const viewportResize = () => { interrupt(); zoom(); };
    // The commit's own range change settles; any other ends the gesture and motion at once.
    const contextChange = () => { if (armed) settle(); else interrupt(); };
    zoom();
    changed.current = contextChange;
    addEventListener("pointerdown", down, { capture: true, passive: true });
    addEventListener("pointermove", move, { capture: true, passive: true });
    addEventListener("pointerup", up, { capture: true, passive: true });
    addEventListener("pointercancel", cancel, { capture: true, passive: true });
    addEventListener("touchend", commit, { capture: true, passive: true });
    addEventListener("touchcancel", commit, { capture: true, passive: true });
    addEventListener("resize", interrupt);
    window.visualViewport?.addEventListener("resize", viewportResize); window.visualViewport?.addEventListener("scroll", zoom);
    document.addEventListener("visibilitychange", hidden);
    node.addEventListener("click", click, { capture: true });
    // Non-passive on the results region only, never on the window or document.
    node.addEventListener("touchmove", touchMove, { passive: false });
    return () => {
      node.removeEventListener("touchmove", touchMove);
      gesture = null; disarm(); delete node.dataset.zoomed;
      if (pending) { window.clearTimeout(pending.timer); pending = null; }
      if (latestMotion.current) finish();
      if (changed.current === contextChange) changed.current = null;
      removeEventListener("pointerdown", down, { capture: true });
      removeEventListener("pointermove", move, { capture: true });
      removeEventListener("pointerup", up, { capture: true });
      removeEventListener("pointercancel", cancel, { capture: true });
      removeEventListener("touchend", commit, { capture: true });
      removeEventListener("touchcancel", commit, { capture: true });
      removeEventListener("resize", interrupt);
      window.visualViewport?.removeEventListener("resize", viewportResize); window.visualViewport?.removeEventListener("scroll", zoom);
      document.removeEventListener("visibilitychange", hidden);
      node.removeEventListener("click", click, { capture: true });
    };
  }, [enabled]);
  return region;
}
