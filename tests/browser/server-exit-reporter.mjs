import { readServerState, serverFailureMessage } from "../../scripts/browser-server-diagnostics.mjs";

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
    if (state?.phase !== "exited" || !state.exit) return;
    this.detected = serverFailureMessage(state);
    process.stderr.write(`[browser-harness] ${this.detected}\n`);
    this.signal();
  }

  onEnd() {
    this.stopping = true;
    clearInterval(this.timer);
    const state = readServerState(this.directory, this.runId);
    if (state?.phase === "exited" && state.exit) {
      if (!this.detected) process.stderr.write(`[browser-harness] ${serverFailureMessage(state)}\n`);
      return { status: "failed" };
    }
  }
}
