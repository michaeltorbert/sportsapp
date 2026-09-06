import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Keep this gate dependency-free: the release workflow runs it before npm ci.
export function checkRelease(tag, cwd = process.cwd()) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag || "")) throw new Error("Choose a stable release tag such as v1.2.0.");
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const head = git("rev-parse", "HEAD");
  if (git("rev-parse", `refs/tags/${tag}^{commit}`) !== head) throw new Error("Checkout does not match the release tag.");
  git("merge-base", "--is-ancestor", head, "refs/remotes/origin/main");
  if (git("status", "--porcelain", "--untracked-files=normal")) throw new Error("Release source must be clean.");
  const version = tag.slice(1);
  const pkg = JSON.parse(readFileSync(resolve(cwd, "package.json"), "utf8"));
  const lock = JSON.parse(readFileSync(resolve(cwd, "package-lock.json"), "utf8"));
  const releases = readFileSync(resolve(cwd, "lib/releases.ts"), "utf8");
  if (pkg.version !== version || lock.version !== version || lock.packages?.[""]?.version !== version ||
      !releases.includes(`export const VERSION = "${version}";`)) throw new Error("Release tag and source versions disagree.");
  if (!readFileSync(resolve(cwd, "CHANGELOG.md"), "utf8").includes(`## ${version} ·`)) throw new Error("Release changelog entry is missing.");
  return { tag, version, commit: head };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(JSON.stringify(checkRelease(process.env.RELEASE_TAG)));
}
