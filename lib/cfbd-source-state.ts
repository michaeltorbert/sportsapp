import type { LeadersKV } from "./cfbd-season-leaders";
export const COMMON_CFBD_BLOCK = "cfbd:v1:blocked";
export const LEGACY_CFBD_BLOCK = "season-leaders:v1:2026:regular:blocked";
const MAX_BYTES = 8_000_000;
export async function cfbdBlocked(kv: LeadersKV) { return !!(await kv.get(COMMON_CFBD_BLOCK) || await kv.get(LEGACY_CFBD_BLOCK)); }
export async function blockCfbd(kv: LeadersKV, checkedAt: string) { await kv.put(COMMON_CFBD_BLOCK, JSON.stringify({ reason: "source-blocked", checkedAt })); }
export type SourceReason = "source-blocked" | "source-response" | "source-content-type" | "source-size" | "source-body" | "source-read" | "source-json" | "source-transport" | "source-aborted";
export class SourceFailure extends Error {
  readonly httpStatus?: number;
  constructor(readonly reason: SourceReason, readonly blocked = false, status?: number) {
    super(reason);
    if (typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599) this.httpStatus = status;
  }
}
// Cleanup cannot mask a known denial or delay its persistent block indefinitely.
function cancelBody(body: ReadableStream<Uint8Array> | null) { try { void body?.cancel().catch(() => {}); } catch { /* Best effort only. */ } }
export async function sourceJson(url: string, key: string, fetcher: typeof fetch, signal: AbortSignal) {
  let response: Response;
  try { response = await fetcher(url, { headers: { Accept: "application/json", Authorization: `Bearer ${key}` }, redirect: "manual", signal }); }
  catch { throw new SourceFailure(signal.aborted ? "source-aborted" : "source-transport"); }
  const status = response.status, contentType = response.headers.get("content-type") ?? "";
  const reject = (reason: SourceReason, blocked = false): never => { cancelBody(response.body); throw new SourceFailure(reason, blocked, status); };
  if ([401,403,429].includes(status) || (status >= 300 && status < 400) || response.headers.get("cf-mitigated") === "challenge" || /\bhtml\b/i.test(contentType)) reject("source-blocked", true);
  if (!response.ok) reject("source-response");
  if (!/\bapplication\/(?:[\w.+-]+\+)?json\b/i.test(contentType)) reject("source-content-type");
  if (Number(response.headers.get("content-length")) > MAX_BYTES) reject("source-size");
  const reader = response.body?.getReader();
  if (!reader) throw new SourceFailure("source-body", false, status);
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) { const result = await reader.read(); if (result.done) break; bytes += result.value.byteLength; if (bytes > MAX_BYTES) throw new SourceFailure("source-size", false, status); chunks.push(result.value); }
  } catch (error) {
    try { void reader.cancel().catch(() => {}); } catch { /* Best effort only. */ }
    throw error instanceof SourceFailure ? error : new SourceFailure(signal.aborted ? "source-aborted" : "source-read", false, status);
  }
  const all = new Uint8Array(bytes); let offset = 0;
  for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.byteLength; }
  const body = new TextDecoder().decode(all);
  if (/^\s*</.test(body) || /captcha|cf-chl-|challenge-platform/i.test(body)) throw new SourceFailure("source-blocked", true, status);
  try { return JSON.parse(body) as unknown; }
  catch { throw new SourceFailure("source-json", false, status); }
}
// Transport-empty POSTs may expose a non-null stream. Check bytes, never buffer a body.
export async function emptyRefreshBody(request: Request): Promise<boolean> {
  if (!request.body) return true;
  const reader = request.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 1000); });
  try {
    // A finite chunk allowance also bounds adversarial streams of empty chunks.
    for (let chunks = 0; chunks < 8; chunks++) {
      const result = await Promise.race([reader.read(), timeout]);
      if (!result) return false;
      if (result.done) return true;
      if (result.value.byteLength !== 0) return false;
    }
    return false;
  } catch { return false; }
  finally {
    if (timer !== undefined) clearTimeout(timer);
    // Cancel is best-effort: an uncooperative stream cannot hold the answer open.
    void reader.cancel().catch(() => {});
  }
}
