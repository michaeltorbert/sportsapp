import type { LeadersKV } from "./cfbd-season-leaders";
export const COMMON_CFBD_BLOCK = "cfbd:v1:blocked";
export const LEGACY_CFBD_BLOCK = "season-leaders:v1:2026:regular:blocked";
const MAX_BYTES = 8_000_000;
export async function cfbdBlocked(kv: LeadersKV) { return !!(await kv.get(COMMON_CFBD_BLOCK) || await kv.get(LEGACY_CFBD_BLOCK)); }
export async function blockCfbd(kv: LeadersKV, checkedAt: string) { await kv.put(COMMON_CFBD_BLOCK, JSON.stringify({ reason: "source-blocked", checkedAt })); }
export class SourceFailure extends Error { constructor(readonly reason: string, readonly blocked = false) { super(reason); } }
export async function sourceJson(url: string, key: string, fetcher: typeof fetch, signal: AbortSignal) {
  const response = await fetcher(url, { headers: { Accept: "application/json", Authorization: `Bearer ${key}` }, redirect: "manual", signal });
  const contentType = response.headers.get("content-type") ?? "";
  if ([401,403,429].includes(response.status) || (response.status >= 300 && response.status < 400) || response.headers.get("cf-mitigated") === "challenge" || /\bhtml\b/i.test(contentType)) { await response.body?.cancel(); throw new SourceFailure("source-blocked", true); }
  if (!response.ok || !/\bapplication\/(?:[\w.+-]+\+)?json\b/i.test(contentType)) { await response.body?.cancel(); throw new SourceFailure("source-response"); }
  if (Number(response.headers.get("content-length")) > MAX_BYTES) { await response.body?.cancel(); throw new SourceFailure("source-size"); }
  const reader = response.body?.getReader();
  if (!reader) throw new SourceFailure("source-body");
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) { const result = await reader.read(); if (result.done) break; bytes += result.value.byteLength; if (bytes > MAX_BYTES) throw new SourceFailure("source-size"); chunks.push(result.value); }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  const all = new Uint8Array(bytes); let offset = 0;
  for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.byteLength; }
  const body = new TextDecoder().decode(all);
  if (/^\s*</.test(body) || /captcha|cf-chl-|challenge-platform/i.test(body)) throw new SourceFailure("source-blocked", true);
  return JSON.parse(body) as unknown;
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
