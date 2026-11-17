import { leadersSearch, parseLeadersSnapshot, type LeadersQuery } from "./leaders-browser";
export async function loadLeaders(query: LeadersQuery, signal: AbortSignal, fetcher: typeof fetch = fetch) {
  const controller = new AbortController(), cancel = () => controller.abort(); signal.addEventListener("abort",cancel,{once:true});
  if (signal.aborted) controller.abort();
  const timer = setTimeout(cancel,15000);
  try {
    const response = await fetcher(`/api/leaders?${leadersSearch(query)}`,{signal:controller.signal,cache:"no-store",mode:"same-origin",credentials:"same-origin"});
    if (!response.ok) throw Error("unavailable"); const reader = response.body?.getReader(); if (!reader) throw Error("unavailable");
    const chunks: Uint8Array[] = []; let count = 0;
    try { for (;;) { const {done,value} = await reader.read(); if (done) break; count += value.byteLength; if (count > 1500000) throw Error("invalid"); chunks.push(value); } } finally { void reader.cancel().catch(() => {}); }
    const all = new Uint8Array(count); let offset = 0; for (const c of chunks) { all.set(c,offset); offset += c.length; }
    const value = JSON.parse(new TextDecoder().decode(all));
    if (JSON.stringify(value.query) !== JSON.stringify(query)) throw Error("invalid");
    const snapshot = parseLeadersSnapshot(value.snapshot,query.year); if (!snapshot) throw Error("unavailable"); return snapshot;
  } finally { clearTimeout(timer); signal.removeEventListener("abort",cancel); }
}
