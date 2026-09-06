import { spawn } from "node:child_process";

const [timeoutText, killAfterText, command, ...args] = process.argv.slice(2);
function milliseconds(value) {
  const match = /^(\d+)(ms|s|m|h)$/.exec(value || "");
  if (!match) throw new Error(`Invalid duration: ${value || "missing"}`);
  return Number(match[1]) * ({ ms: 1, s: 1000, m: 60000, h: 3600000 })[match[2]];
}
if (!command) throw new Error("Missing command");

const timeout = milliseconds(timeoutText);
const killAfter = milliseconds(killAfterText);
const child = spawn(command, args, { stdio: "inherit", detached: process.platform !== "win32" });
let timedOut = false;

function signal(name) {
  if (!child.pid || child.exitCode !== null) return;
  try { process.kill(process.platform === "win32" ? child.pid : -child.pid, name); }
  catch (error) { if (error?.code !== "ESRCH") throw error; }
}

const softTimer = setTimeout(() => {
  timedOut = true;
  console.error(`Build exceeded ${timeoutText}; stopping it.`);
  signal("SIGTERM");
  setTimeout(() => signal("SIGKILL"), killAfter).unref();
}, timeout);

for (const name of ["SIGINT", "SIGTERM"]) process.on(name, () => signal(name));
child.on("error", error => { clearTimeout(softTimer); console.error(error.message); process.exitCode = 69; });
child.on("exit", (code, childSignal) => {
  clearTimeout(softTimer);
  if (timedOut) process.exitCode = 124;
  else if (childSignal) process.exitCode = 128;
  else process.exitCode = code ?? 1;
});
