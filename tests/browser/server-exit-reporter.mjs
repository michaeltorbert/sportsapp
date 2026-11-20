import { readServerState, readUnavailable, serverFailureMessage, unavailableMessage } from "../../scripts/browser-server-diagnostics.mjs";
import { COMPLETED_READ_CONTROL_ANNOTATION, COMPLETED_READ_CONTROL_TITLE, COMPLETED_READ_IDENTITY_KEYS, COMPLETED_READ_USAGE_ANNOTATION } from "../../scripts/browser-runtime-errors.mjs";

const parse = description => { try { const value = JSON.parse(description); return value && typeof value === "object" ? value : null; } catch { return null; } };

export default class ServerExitReporter {
  constructor(options = {}) {
    this.signal = options.signal || (() => process.kill(process.pid, "SIGINT"));
    this.pollMs = options.pollMs || 100;
    // #181 completed-read gate: per-test records from the reporter API only (no cross-worker globals).
    this.usages = [];
    this.finalResults = new Map();
  }

  onBegin(config) {
    this.directory = config.metadata.serverDiagnosticsDir;
    this.runId = config.metadata.browserRunId;
    this.metadata = config.metadata;
    if (process.env.BROWSER_TEST_STOP_ON_SERVER_EXIT !== "1") return;
    this.timer = setInterval(() => this.check(), this.pollMs);
    this.timer.unref();
  }

  // Any attempt's label use counts; only the LAST result per test counts as that test's final status.
  onTestEnd(test, result) {
    const annotations = result.annotations || [];
    for (const annotation of annotations) if (annotation.type === COMPLETED_READ_USAGE_ANNOTATION) this.usages.push({ testId: test.id, identity: parse(annotation.description) });
    this.finalResults.set(test.id, { testId: test.id, title: test.title, expectedStatus: test.expectedStatus, status: result.status, annotations });
  }

  check() {
    if (this.stopping || this.detected) return;
    const state = readServerState(this.directory, this.runId);
    const unavailable = readUnavailable(this.directory, this.runId);
    if (state?.phase === "exited" && state.exit) this.detected = serverFailureMessage(state);
    else if (unavailable) this.detected = unavailableMessage(unavailable, this.directory);
    else return;
    process.stderr.write(`[browser-harness] ${this.detected}\n`);
    this.signal();
  }

  // A use of native_completed_read_rsc_diagnostic needs a FINAL-PASS completed-read control whose in-body
  // qualification matches every identity key, on WebKit darwin/arm64, for THIS run's source/run/test-source hash.
  completedReadGate() {
    const metadata = this.metadata || {};
    const valid = identity => !!identity && COMPLETED_READ_IDENTITY_KEYS.every(key => typeof identity[key] === "string" && identity[key].length > 0)
      && identity.browser === "webkit" && identity.hostPlatform === "darwin" && identity.hostArchitecture === "arm64"
      && identity.sourceCommit === metadata.sourceCommit && identity.browserRunId === metadata.browserRunId && identity.browserTestSourcesHash === metadata.browserTestSourcesHash;
    const controls = [];
    for (const record of this.finalResults.values()) {
      if (record.title !== COMPLETED_READ_CONTROL_TITLE || record.status !== "passed" || record.expectedStatus !== "passed") continue;
      for (const annotation of record.annotations) {
        if (annotation.type !== COMPLETED_READ_CONTROL_ANNOTATION) continue;
        const identity = parse(annotation.description);
        if (valid(identity)) controls.push({ testId: record.testId, identity });
      }
    }
    const unmatched = this.usages.filter(usage => !valid(usage.identity) || !controls.some(control => COMPLETED_READ_IDENTITY_KEYS.every(key => control.identity[key] === usage.identity[key])));
    const matching = controls.filter(control => this.usages.some(usage => valid(usage.identity) && COMPLETED_READ_IDENTITY_KEYS.every(key => control.identity[key] === usage.identity[key])));
    const failed = this.usages.length > 0 && unmatched.length > 0;
    const summary = { usages: this.usages.length, unmatched: unmatched.length, matchingControls: matching.map(control => control.testId).sort(), identity: matching[0] ? Object.fromEntries(COMPLETED_READ_IDENTITY_KEYS.map(key => [key, matching[0].identity[key]])) : null, result: failed ? "failed" : "passed" };
    return { failed, summary };
  }

  onEnd() {
    this.stopping = true;
    clearInterval(this.timer);
    const gate = this.completedReadGate();
    process.stderr.write(`[browser-harness] completed-read gate ${JSON.stringify(gate.summary)}\n`);
    const state = readServerState(this.directory, this.runId);
    const unavailable = readUnavailable(this.directory, this.runId);
    if ((state?.phase === "exited" && state.exit) || unavailable) {
      if (!this.detected) process.stderr.write(`[browser-harness] ${state?.exit ? serverFailureMessage(state) : unavailableMessage(unavailable, this.directory)}\n`);
      return { status: "failed" };
    }
    if (gate.failed) {
      process.stderr.write(`[browser-harness] ${gate.summary.unmatched} use(s) of native_completed_read_rsc_diagnostic lack a matching FINAL-PASS same-run completed-read native control (missing, skipped, failed, unqualified or identity mismatch).\n`);
      return { status: "failed" };
    }
  }
}
