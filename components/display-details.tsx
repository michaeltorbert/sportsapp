"use client";
import { useEffect, useRef, useState } from "react";

type Snapshot = { mode: string; insets: { top: number; right: number; bottom: number; left: number }; window: string; visual: string };
const modes = ["fullscreen", "standalone", "minimal-ui", "browser"];
// Read-only support values for #116. They describe this screen only: no identifiers, storage or network.
function measure(probe: HTMLElement): Snapshot {
  // The probe's margins are the raw env() insets as this browser resolves them, not the app's --safe-top.
  const style = getComputedStyle(probe), px = (value: string) => Math.round(parseFloat(value) || 0);
  const mode = modes.find(value => matchMedia(`(display-mode: ${value})`).matches) ?? "unknown";
  const homeScreen = (navigator as Navigator & { standalone?: boolean }).standalone;
  const viewport = window.visualViewport;
  return {
    mode: `${mode}${homeScreen === true ? " (Home Screen app)" : homeScreen === false ? " (Safari)" : ""}`,
    insets: { top: px(style.marginTop), right: px(style.marginRight), bottom: px(style.marginBottom), left: px(style.marginLeft) },
    window: `${innerWidth} × ${innerHeight}`,
    visual: viewport ? `${Math.round(viewport.width)} × ${Math.round(viewport.height)}, offset ${Math.round(viewport.offsetTop)}` : "Not available",
  };
}
export function DisplayDetails() {
  const [open, setOpen] = useState(false), [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const probe = useRef<HTMLSpanElement>(null);
  // Measure on expansion and again after rotation or a viewport resize while expanded.
  useEffect(() => {
    if (!open) return;
    let frame = 0;
    const update = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { if (probe.current) setSnapshot(measure(probe.current)); }); };
    update();
    window.addEventListener("resize", update); window.addEventListener("orientationchange", update); window.visualViewport?.addEventListener("resize", update);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("resize", update); window.removeEventListener("orientationchange", update); window.visualViewport?.removeEventListener("resize", update); };
  }, [open]);
  const insets = snapshot?.insets;
  return <details className="display-details" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Display details</summary>
    <span className="display-probe" ref={probe} aria-hidden="true" />
    <p>For support only. These describe how this screen reports its layout; they are not saved or sent anywhere.</p>
    {snapshot && insets ? <dl>
      <div><dt>Display mode</dt><dd>{snapshot.mode}</dd></div>
      <div><dt>Safe-area insets</dt><dd>Top {insets.top}px, right {insets.right}px, bottom {insets.bottom}px, left {insets.left}px</dd></div>
      <div><dt>Window size</dt><dd>{snapshot.window}</dd></div>
      <div><dt>Visible area</dt><dd>{snapshot.visual}</dd></div>
    </dl> : <p>Measuring…</p>}
  </details>;
}
