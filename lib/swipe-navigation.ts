"use client";
import { useEffect, useLayoutEffect, useRef } from "react";

// Horizontal touch swipes on the Scores results step the displayed day or week (#172). The browser
// keeps vertical scrolling and pinch zoom (CSS `touch-action: pan-y pinch-zoom` on the region), so
// this only judges one primary touch's own pointer events and never captures or cancels them.
export const EDGE = 32; // CSS px at each side left to the browser's own edge navigation.
export const SLOP = 10; // Movement before the direction is judged.
export const COMMIT = 60; // Horizontal travel that commits on release.
export const ZOOMED = 1.01; // Above this visual viewport scale the browser pans freely and swiping is off.
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
const CONTROLS = "a, button, input, label, select, textarea, summary, [contenteditable], [role=button]";
/** Where a swipe may start: a game card's link (returned) or the region itself; never another control. */
export function swipeTarget(target: Element, region: Element): Element | null {
  if (!region.contains(target)) return null;
  const card = target.closest(".game-summary");
  if (card && region.contains(card)) return card;
  const control = target.closest(CONTROLS);
  return control && region.contains(control) ? null : region;
}

/**
 * Attach the returned ref to the results region. `onStep` runs once per committed swipe. A gesture is
 * abandoned by a second contact, pointercancel, a window or visual viewport resize, zoom, a hidden
 * page, an open panel, disabling, or a change of `context` (the displayed period and range).
 * After a commit, only the one compatibility click from that touch, inside the element where it
 * started, is swallowed; keyboard and programmatic activation (detail 0) and the next tap are not.
 * A context change never clears that record, since a commit itself changes the range before its click.
 */
export function useSwipeNavigation<T extends HTMLElement>(enabled: boolean, context: string, onStep: (step: Step) => void) {
  const region = useRef<T | null>(null);
  const latest = useRef(onStep);
  const stop = useRef<(() => void) | null>(null);
  useLayoutEffect(() => { latest.current = onStep; });
  useLayoutEffect(() => { stop.current?.(); }, [context]);
  useEffect(() => {
    const node = region.current;
    if (!node || !enabled) return;
    let gesture: { id: number; x: number; y: number; axis: Axis; target: Element } | null = null;
    let suppress: { target: Element; timer: number } | null = null;
    const scale = () => window.visualViewport?.scale ?? 1;
    const blocked = () => document.hidden || scale() > ZOOMED || !!node.closest("[hidden]") || !!document.querySelector('[role="dialog"][data-state="open"]');
    const abandon = () => { gesture = null; };
    const disarm = () => { if (suppress) window.clearTimeout(suppress.timer); suppress = null; };
    // Zoomed in, the region returns to the browser's default panning (see globals.css).
    const zoom = () => { if (scale() > ZOOMED) { node.dataset.zoomed = ""; abandon(); } else delete node.dataset.zoomed; };
    const down = (event: PointerEvent) => {
      // Any new contact ends the previous swipe's click suppression; a second finger ends a swipe.
      disarm();
      if (gesture) { abandon(); return; }
      const target = event.target instanceof Element ? swipeTarget(event.target, node) : null;
      if (!target || blocked() || !canStart(event, window.innerWidth, scale())) return;
      gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, axis: "pending", target };
    };
    const move = (event: PointerEvent) => {
      if (!gesture || event.pointerId !== gesture.id) return;
      if (blocked()) { abandon(); return; }
      gesture.axis = follow(gesture.axis, event.clientX - gesture.x, event.clientY - gesture.y);
      if (gesture.axis === "abandoned") abandon();
    };
    const up = (event: PointerEvent) => {
      if (!gesture || event.pointerId !== gesture.id) return;
      const { x, y, axis, target } = gesture;
      gesture = null;
      if (blocked()) return;
      const step = release(axis, event.clientX - x, event.clientY - y);
      if (!step) return;
      // The timer only clears a record no click arrived for; it never decides what is swallowed.
      suppress = { target, timer: window.setTimeout(disarm, 1000) };
      latest.current(step);
    };
    const cancel = (event: PointerEvent) => { if (gesture && event.pointerId === gesture.id) abandon(); };
    const click = (event: MouseEvent) => {
      if (!suppress || event.detail === 0 || !(event.target instanceof Node) || !suppress.target.contains(event.target)) return;
      disarm(); event.preventDefault(); event.stopPropagation();
    };
    const hidden = () => { if (document.hidden) abandon(); };
    // Any visual viewport resize interrupts a gesture; its scroll (panning while zoomed) only updates zoom.
    const viewportResize = () => { abandon(); zoom(); };
    zoom();
    stop.current = abandon;
    addEventListener("pointerdown", down, { capture: true, passive: true });
    addEventListener("pointermove", move, { capture: true, passive: true });
    addEventListener("pointerup", up, { capture: true, passive: true });
    addEventListener("pointercancel", cancel, { capture: true, passive: true });
    addEventListener("resize", abandon);
    window.visualViewport?.addEventListener("resize", viewportResize); window.visualViewport?.addEventListener("scroll", zoom);
    document.addEventListener("visibilitychange", hidden);
    node.addEventListener("click", click, { capture: true });
    return () => {
      abandon(); disarm(); delete node.dataset.zoomed;
      if (stop.current === abandon) stop.current = null;
      removeEventListener("pointerdown", down, { capture: true });
      removeEventListener("pointermove", move, { capture: true });
      removeEventListener("pointerup", up, { capture: true });
      removeEventListener("pointercancel", cancel, { capture: true });
      removeEventListener("resize", abandon);
      window.visualViewport?.removeEventListener("resize", viewportResize); window.visualViewport?.removeEventListener("scroll", zoom);
      document.removeEventListener("visibilitychange", hidden);
      node.removeEventListener("click", click, { capture: true });
    };
  }, [enabled]);
  return region;
}
