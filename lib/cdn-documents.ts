import { isCdnDocument } from "./espn-cdn";

type Fetcher = typeof fetch;
type Entry = { readonly text: string; readonly acquiredAt: number };

/**
 * Completed browser CDN documents shared within one hook refresh. Holds only fully read
 * text keyed by exact URL, never promises, primary, hosted or summary data, or boards.
 */
export type CdnDocuments = { owner?: { parent: AbortSignal; fetcher: Fetcher }; readonly entries: Map<string, Entry> };
export const createCdnDocuments = (): CdnDocuments => ({ entries: new Map() });

/** One consumer's CDN branch. Documents bind to the first parent signal and fetcher; any other pair bypasses them. */
export function cdnConsumer(documents: CdnDocuments, parent: AbortSignal, fetcher: Fetcher) {
  documents.owner ||= { parent, fetcher };
  if (documents.owner.parent !== parent || documents.owner.fetcher !== fetcher) return null;
  const { entries } = documents, consumed: [string, Entry][] = [], acquired: number[] = [];
  return {
    /** Wraps this consumer's own direct-phase upstream; every use parses its own copy. */
    fetch(upstream: Fetcher, signal: AbortSignal): Fetcher {
      return async (url, options) => {
        if (signal.aborted) throw new DOMException("Direct score deadline expired", "AbortError");
        const key = String(url), stored = entries.get(key);
        if (stored) { consumed.push([key, stored]); acquired.push(stored.acquiredAt); return copy(stored.text); }
        const response = await upstream(url, options);
        if (!response.ok) return response;
        // Acquisition is full-body completion; a later hit never restamps it.
        const text = await response.text(), acquiredAt = Date.now();
        acquired.push(acquiredAt);
        // A canceled or late body is never shared, and the first stored document is never overwritten.
        if (!signal.aborted && !entries.has(key) && admissible(text)) {
          const entry = { text, acquiredAt };
          entries.set(key, entry); consumed.push([key, entry]);
        }
        // Concurrent misses keep their own bytes even when another consumer stored first.
        return copy(text);
      };
    },
    /** Earliest acquisition among the documents this consumer actually used, including calendar discovery. */
    fetchedAt: () => acquired.length ? new Date(Math.min(...acquired)).toISOString() : null,
    /** Removes only the exact records this consumer used, never a different concurrent winner. */
    invalidate() { for (const [key, entry] of consumed) if (entries.get(key) === entry) entries.delete(key); },
  };
}
function admissible(text: string) { try { return isCdnDocument(JSON.parse(text)); } catch { return false; } }
function copy(text: string) { return new Response(text, { status: 200, headers: { "content-type": "application/json" } }); }
