"use client";
import { useCallback, useEffect, useRef, useState, type PointerEvent, type ComponentProps, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { X } from "lucide-react";
import { SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "./ui/sheet";
import { cn } from "@/lib/utils";

type AppPanelProps = Omit<ComponentProps<typeof SheetContent>, "side" | "showCloseButton" | "title"> & {
  title: ReactNode; description: ReactNode; bodyLabel: string; bodyClassName?: string;
};
// Radix's modal scroll lock cancels a touchmove that bubbles to its document listener at a scroll
// region's edge, so the browser's own edge overscroll never starts there. While this panel is the open,
// visible layer and the region actually overflows, a passive listener keeps a one-finger move from
// reaching that listener; overscroll-behavior: contain keeps it from chaining to the page. It never
// cancels, scrolls or moves anything. Short content, two fingers, a panel under a nested modal and
// browsers without containment stay with the lock; touchstart and wheel are untouched.
function leaveEdgeTouchToBrowser(node: HTMLElement) {
  const onTouchMove = (event: TouchEvent) => {
    if (event.touches.length !== 1 || node.scrollHeight <= node.clientHeight + 1 || !CSS.supports("overscroll-behavior", "contain")) return;
    if (node.closest('[role="dialog"]')?.getAttribute("data-state") !== "open" || node.closest('[aria-hidden="true"], [inert]')) return;
    event.stopPropagation();
  };
  node.addEventListener("touchmove", onTouchMove, { passive: true });
  return () => node.removeEventListener("touchmove", onTouchMove);
}
// Settings, Alerts and Help share one fixed-height bottom sheet (#116): a pinned header whose one
// labeled Close opens focused, and a named body that scrolls on its own only when content overflows.
// Opt-in, so the generic Sheet and the Guide's contextual bottom sheet are unchanged.
// Close's explicit tabIndex keeps it a Tab stop where WebKit otherwise skips native buttons.
// On close, focus returns to this sheet's own trigger without scrolling the page: Radix's default
// trigger focus scrolls an off-screen trigger into view.
export function AppPanelContent({ title, description, bodyLabel, bodyClassName, className, children, onOpenAutoFocus, onCloseAutoFocus, ...props }: AppPanelProps) {
  const close = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);
  const body = useRef<HTMLElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; offset: number; height: number; viewportWidth: number; viewportHeight: number } | null>(null);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const resetDrag = useCallback(() => { drag.current = null; setDragging(false); setOffset(0); }, []);
  useEffect(() => {
    // Rotation or a changing visible viewport cancels a gesture, never dismisses the panel.
    const cancelActiveDrag = () => { if (drag.current) resetDrag(); };
    addEventListener("resize", cancelActiveDrag); visualViewport?.addEventListener("resize", cancelActiveDrag);
    return () => { removeEventListener("resize", cancelActiveDrag); visualViewport?.removeEventListener("resize", cancelActiveDrag); };
  }, [resetDrag]);
  // Every opening starts with both scroll regions at their tops and Close focused.
  const focusFromTop = useCallback(() => {
    body.current?.scrollTo(0, 0); panel.current?.querySelector(".app-panel-heading")?.scrollTo(0, 0); close.current?.focus();
  }, []);
  // Reopened before its closing slide ends, Radix keeps this same node and its focus scope does not
  // mount again, so onOpenAutoFocus never runs. A closed-to-open data-state change on the node marks
  // that opening. The observer's microtask runs after Radix's commit and before the next paint, and
  // flushSync commits the reset then. Closing is left alone, so a committed pull slides out from where
  // it was let go; an ordinary mount starts open, records nothing, and keeps onOpenAutoFocus's path.
  // Once the closing slide ends, Radix removes the node while this component stays mounted, so a
  // pull's offset is cleared then; left for the next mount, it would paint and transition back to 0.
  // React runs this cleanup before removing the node, and also when it re-attaches the same node
  // (StrictMode, or a changed composed ref), so the reset waits until the node has actually left and
  // never touches a sheet that is still open or still sliding out.
  const panelRef = useCallback((node: HTMLDivElement | null) => {
    panel.current = node; if (!node) return;
    const observer = new MutationObserver(records => {
      if (node.dataset.state !== "open" || !records.some(record => record.oldValue === "closed")) return;
      flushSync(resetDrag); focusFromTop();
    });
    observer.observe(node, { attributes: true, attributeFilter: ["data-state"], attributeOldValue: true });
    return () => { observer.disconnect(); panel.current = null; queueMicrotask(() => { if (!node.isConnected) resetDrag(); }); };
  }, [resetDrag, focusFromTop]);
  // The body keeps its ref for focusFromTop; cleanup clears it only while it still names this node.
  const bodyRef = useCallback((node: HTMLElement | null) => {
    body.current = node; if (!node) return;
    const release = leaveEdgeTouchToBrowser(node);
    return () => { release(); if (body.current === node) body.current = null; };
  }, []);
  function startDrag(event: PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary) { resetDrag(); return; }
    if (event.button !== 0 || drag.current) return;
    // Controls and an overflowing heading keep their normal click/scroll behavior.
    if ((event.target as Element).closest('button, a, input, select, textarea, [role="region"]')) return;
    if (panel.current?.getAnimations().some(a => a.playState === "running")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, offset: 0, height: panel.current?.clientHeight ?? 0, viewportWidth: innerWidth, viewportHeight: innerHeight };
    setDragging(true); event.preventDefault();
  }
  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current; if (!current || current.id !== event.pointerId) return;
    if (current.viewportWidth !== innerWidth || current.viewportHeight !== innerHeight) { resetDrag(); return; }
    const dy = event.clientY - current.y;
    if (Math.abs(event.clientX - current.x) > Math.abs(dy) + 8) { resetDrag(); return; }
    current.offset = Math.max(0, Math.min(dy, current.height));
    setOffset(current.offset); event.preventDefault();
  }
  function endDrag(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current; if (!current || current.id !== event.pointerId) return;
    if (current.viewportWidth !== innerWidth || current.viewportHeight !== innerHeight) { resetDrag(); return; }
    // Short pulls always return; deliberate distance closes through Radix's normal path.
    const threshold = Math.min(120, Math.max(64, current.height * .18));
    drag.current = null; setDragging(false);
    if (current.offset >= threshold) close.current?.click();
    else setOffset(0);
  }
  const [headingScrolls, setHeadingScrolls] = useState(false);
  // A heading taller than its cap (very large text) scrolls on its own. Only then is it a named,
  // focusable region, so the keyboard can reach and scroll it. Rechecked whenever the heading or
  // its title and description resize: rotation, viewport changes, text size or content.
  const heading = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const observer = new ResizeObserver(() => setHeadingScrolls(node.scrollHeight > node.clientHeight + 1));
    observer.observe(node); for (const child of node.children) observer.observe(child);
    const release = leaveEdgeTouchToBrowser(node);
    return () => { observer.disconnect(); release(); };
  }, []);
  return <SheetContent {...props} ref={panelRef} data-dragging={dragging || undefined} style={{ ...props.style, translate: `0 ${offset}px` }} side="bottom" showCloseButton={false} className={cn("app-panel", className)} onOpenAutoFocus={event => {
    // Record this opening's trigger: the one control whose aria-controls names this dialog, which
    // Radix sets only while open. Never the active element, which a tap can leave on another control.
    const id = close.current?.closest('[role="dialog"]')?.id;
    const triggers = id ? [...document.querySelectorAll<HTMLElement>(`[aria-controls="${CSS.escape(id)}"]`)] : [];
    opener.current = triggers.length === 1 ? triggers[0] : null;
    onOpenAutoFocus?.(event); if (event.defaultPrevented) return;
    event.preventDefault(); resetDrag(); focusFromTop();
  }} onCloseAutoFocus={event => {
    onCloseAutoFocus?.(event);
    const target = opener.current; opener.current = null;
    if (event.defaultPrevented || !target?.isConnected) return;
    // Take over only when the trigger actually accepts focus; otherwise Radix's own return applies.
    target.focus({ preventScroll: true });
    if (document.activeElement === target) event.preventDefault();
  }}>
    <SheetHeader className="app-panel-header" data-heading-scrolls={headingScrolls || undefined} onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={resetDrag} onLostPointerCapture={() => { if (drag.current) resetDrag(); }}><div className="app-panel-grip" aria-hidden="true"><span /></div><div ref={heading} className="app-panel-heading" {...headingScrolls ? { role: "region", "aria-label": "Title and description", tabIndex: 0 } : {}}><SheetTitle>{title}</SheetTitle><SheetDescription>{description}</SheetDescription></div><SheetClose ref={close} tabIndex={0} className="app-panel-close" aria-label="Close"><X size={20} aria-hidden="true" /></SheetClose></SheetHeader>
    <section ref={bodyRef} className={cn("app-panel-body", bodyClassName)} aria-label={bodyLabel} tabIndex={0}>{children}</section>
  </SheetContent>;
}
