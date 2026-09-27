import { readServerState, readUnavailable, serverFailureMessage, unavailableMessage } from "../../scripts/browser-server-diagnostics.mjs";

export default class ServerExitReporter {
  constructor(options = {}) {
    this.signal = options.signal || (() => process.kill(process.pid, "SIGINT"));
    this.pollMs = options.pollMs || 100;
  }

  onBegin(config) {
    this.directory = config.metadata.serverDiagnosticsDir;
    this.runId = config.metadata.browserRunId;
    if (process.env.BROWSER_TEST_STOP_ON_SERVER_EXIT !== "1") return;
    this.timer = setInterval(() => this.check(), this.pollMs);
    this.timer.unref();
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

  onEnd() {
    this.stopping = true;
    clearInterval(this.timer);
    const state = readServerState(this.directory, this.runId);
    const unavailable = readUnavailable(this.directory, this.runId);
    if ((state?.phase === "exited" && state.exit) || unavailable) {
      if (!this.detected) process.stderr.write(`[browser-harness] ${state?.exit ? serverFailureMessage(state) : unavailableMessage(unavailable, this.directory)}\n`);
      return { status: "failed" };
    }
  }
}
