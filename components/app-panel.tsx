"use client";
import { useRef, type ComponentProps, type ReactNode } from "react";
import { X } from "lucide-react";
import { SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "./ui/sheet";
import { cn } from "@/lib/utils";

type AppPanelProps = Omit<ComponentProps<typeof SheetContent>, "side" | "showCloseButton" | "title"> & {
  title: ReactNode; description: ReactNode; bodyLabel: string; bodyClassName?: string;
};
// Settings, Alerts and Help share one full-height trailing panel (#116): a pinned header whose one
// labeled Close opens focused, and a named body that scrolls on its own only when content overflows.
// Opt-in, so the generic Sheet and the Guide's contextual bottom sheet are unchanged.
export function AppPanelContent({ title, description, bodyLabel, bodyClassName, className, children, onOpenAutoFocus, ...props }: AppPanelProps) {
  const close = useRef<HTMLButtonElement>(null);
  return <SheetContent {...props} side="right" showCloseButton={false} className={cn("app-panel", className)} onOpenAutoFocus={event => {
    onOpenAutoFocus?.(event); if (event.defaultPrevented) return;
    event.preventDefault(); close.current?.focus();
  }}>
    <SheetHeader className="app-panel-header"><div className="app-panel-heading"><SheetTitle>{title}</SheetTitle><SheetDescription>{description}</SheetDescription></div><SheetClose ref={close} className="app-panel-close"><X size={20} aria-hidden="true" />Close</SheetClose></SheetHeader>
    <section className={cn("app-panel-body", bodyClassName)} aria-label={bodyLabel} tabIndex={0}>{children}</section>
  </SheetContent>;
}
