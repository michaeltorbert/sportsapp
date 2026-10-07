"use client";
import { useCallback, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { X } from "lucide-react";
import { SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "./ui/sheet";
import { cn } from "@/lib/utils";

type AppPanelProps = Omit<ComponentProps<typeof SheetContent>, "side" | "showCloseButton" | "title"> & {
  title: ReactNode; description: ReactNode; bodyLabel: string; bodyClassName?: string;
};
// Settings, Alerts and Help share one full-height trailing panel (#116): a pinned header whose one
// labeled Close opens focused, and a named body that scrolls on its own only when content overflows.
// Opt-in, so the generic Sheet and the Guide's contextual bottom sheet are unchanged.
// Close's explicit tabIndex keeps it a Tab stop where WebKit otherwise skips native buttons.
export function AppPanelContent({ title, description, bodyLabel, bodyClassName, className, children, onOpenAutoFocus, ...props }: AppPanelProps) {
  const close = useRef<HTMLButtonElement>(null);
  const [headingScrolls, setHeadingScrolls] = useState(false);
  // A heading taller than its cap (very large text) scrolls on its own. Only then is it a named,
  // focusable region, so the keyboard can reach and scroll it. Rechecked whenever the heading or
  // its title and description resize: rotation, viewport changes, text size or content.
  const heading = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const observer = new ResizeObserver(() => setHeadingScrolls(node.scrollHeight > node.clientHeight + 1));
    observer.observe(node); for (const child of node.children) observer.observe(child);
    return () => observer.disconnect();
  }, []);
  return <SheetContent {...props} side="right" showCloseButton={false} className={cn("app-panel", className)} onOpenAutoFocus={event => {
    onOpenAutoFocus?.(event); if (event.defaultPrevented) return;
    event.preventDefault(); close.current?.focus();
  }}>
    <SheetHeader className="app-panel-header"><div ref={heading} className="app-panel-heading" {...headingScrolls ? { role: "region", "aria-label": "Title and description", tabIndex: 0 } : {}}><SheetTitle>{title}</SheetTitle><SheetDescription>{description}</SheetDescription></div><SheetClose ref={close} tabIndex={0} className="app-panel-close"><X size={20} aria-hidden="true" />Close</SheetClose></SheetHeader>
    <section className={cn("app-panel-body", bodyClassName)} aria-label={bodyLabel} tabIndex={0}>{children}</section>
  </SheetContent>;
}
