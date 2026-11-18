"use client";
import { useEffect, useRef, useState } from "react";
import { clearDiagnostics, diagnosticsSnapshot } from "@/lib/schedule-diagnostics";

export function ScheduleDiagnostics() {
  const [open, setOpen] = useState(false), [snapshot, setSnapshot] = useState<ReturnType<typeof diagnosticsSnapshot> | null>(null), [feedback, setFeedback] = useState("");
  const text = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!open) return;
    const update = () => setSnapshot(diagnosticsSnapshot());
    update(); window.addEventListener("schedule-diagnostics", update);
    return () => window.removeEventListener("schedule-diagnostics", update);
  }, [open]);
  const select = () => { text.current?.focus(); text.current?.select(); setFeedback("Diagnostics selected. Use your device’s Copy command."); };
  const copy = async () => {
    const latest = diagnosticsSnapshot(); setSnapshot(latest);
    try { await navigator.clipboard.writeText(latest.text); setFeedback("Diagnostics copied. Nothing was sent."); }
    catch { setFeedback("Copy was unavailable. Choose Select diagnostics, then use your device’s Copy command."); }
  };
  return <details className="display-details schedule-diagnostics" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Schedule diagnostics</summary>
    <p>Recent schedule-loading problems are saved on this device for up to seven days. Nothing is sent automatically. Reports exclude scores, preferences and account details.</p>
    {snapshot && <>
      <p>{snapshot.persistent ? "Saved on this device." : "Saving is unavailable. Reports will be lost when this page closes."} {snapshot.count ? `${snapshot.count} saved reports.` : "No saved reports."}</p>
      <div className="schedule-diagnostic-actions"><button type="button" onClick={copy}>Copy diagnostics</button><button type="button" onClick={select}>Select diagnostics</button><button type="button" onClick={() => { const next = clearDiagnostics(); setSnapshot(next); setFeedback(next.persistent ? "Schedule diagnostics cleared." : "Page reports cleared. Browser storage could not be cleared."); }}>Clear diagnostics</button></div>
      <label>Diagnostic report<textarea ref={text} readOnly value={snapshot.text} spellCheck={false} rows={7} /></label>
      <p role="status">{feedback}</p>
    </>}
  </details>;
}
