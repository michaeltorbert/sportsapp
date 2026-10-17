// Forwards one browser request to a local Worker. Exactly one outcome is recorded,
// first cause first and before the paired side is torn down:
// - complete: the downstream response finished.
// - cancelled: the browser left (e.g. navigation); the paired upstream is aborted. Not a fault.
// - refused: the upstream failed before headers; the existing 502 is sent while still writable.
// - truncated: the upstream failed after headers; the stream is destroyed without new headers.
import { request } from "node:http";

export function forward(req, res, port, { onOutcome = () => {} } = {}) {
  let outcome = null, response = null;
  const settle = (kind, error) => {
    if (outcome) return false;
    outcome = error ? { kind, code: error.code ?? "unknown" } : { kind };
    onOutcome(outcome);
    return true;
  };
  const teardown = () => { upstream.destroy(); response?.destroy(); };
  const upstreamFailed = error => {
    if (!settle(res.headersSent ? "truncated" : "refused", error)) return;
    if (outcome.kind === "truncated") res.destroy();
    else if (res.writable && !res.destroyed) { res.writeHead(502); res.end(); }
    teardown();
  };
  const upstream = request({ hostname: "127.0.0.1", port, path: req.url, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${port}` } }, incoming => {
    response = incoming;
    incoming.on("error", upstreamFailed);
    incoming.on("close", () => { if (!incoming.complete) upstreamFailed(Object.assign(new Error("Upstream response closed before completion"), { code: "ERR_INCOMPLETE" })); });
    if (outcome) { incoming.destroy(); return; }
    res.writeHead(incoming.statusCode, incoming.headers);
    incoming.pipe(res);
  });
  upstream.on("error", upstreamFailed);
  res.on("close", () => {
    if (res.writableFinished) settle("complete");
    else if (settle("cancelled")) teardown();
  });
  // Downstream request errors end in the response close above.
  req.on("error", () => {});
  req.pipe(upstream);
}
