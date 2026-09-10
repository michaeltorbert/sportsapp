import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { packageStaticHome } from "../scripts/package-static-home.mjs";

test("static packaging rejects missing or incomplete output and clears stale homepage", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "static-package-test-"));
  const root = pathToFileURL(directory + "/");
  const commit = "a".repeat(40);
  try {
    await mkdir(new URL("dist/client/", root), { recursive: true });
    await mkdir(new URL("dist/server/prerendered-routes/", root), { recursive: true });
    await writeFile(new URL("package.json", root), JSON.stringify({ version: "1.4.3", type: "module" }));
    await writeFile(new URL("dist/server/vinext-prerender.json", root), JSON.stringify({ routes: [{ route: "/", status: "rendered", revalidate: false }, { route: "/guide", status: "rendered", revalidate: false }, ...["/api/health", "/api/scores"].map(route => ({ route, status: "skipped", reason: "api" }))] }));
    for (const [html, failure] of [[null, { code: "ENOENT" }], ["<html>Your watchlist Connecting to ESPN</html>", /__VINEXT_RSC_DONE__/]]) {
      await writeFile(new URL("dist/client/index.html", root), "stale");
      if (html) await writeFile(new URL("dist/server/prerendered-routes/index.html", root), html);
      await assert.rejects(packageStaticHome(root, commit), failure);
      await assert.rejects(readFile(new URL("dist/client/index.html", root)), { code: "ENOENT" });
    }
    await assert.rejects(packageStaticHome(root, "short"), /exact source commit/);
    const html = '<html><script>__VINEXT_RSC_CHUNKS__=[];__VINEXT_RSC_DONE__=true</script><script src="/assets/app.js"></script>Your watchlist Connecting to ESPN</html>';
    await writeFile(new URL("dist/server/prerendered-routes/index.html", root), html);
    await writeFile(new URL("dist/server/index.js", root), `export default { fetch() { return Response.json({ version: "1.4.3", commit: "${commit}" }); } };`);
    await mkdir(new URL("dist/client/assets/", root));
    await writeFile(new URL("dist/client/assets/app.js", root), "/* fixture */");
    await writeFile(new URL("dist/server/prerendered-routes/guide.html", root), html.replace("Your watchlist", "All games All times Eastern"));
    await packageStaticHome(root, commit);
    assert.equal(await readFile(new URL("dist/client/index.html", root), "utf8"), `<!-- saturday-signal-static 1.4.3 ${commit} -->\n${html}`);
    const guideHtml = html.replace("Your watchlist", "All games All times Eastern");
    assert.equal(await readFile(new URL("dist/client/guide.html", root), "utf8"), `<!-- saturday-signal-static 1.4.3 ${commit} -->\n${guideHtml}`);
    for (const brokenGuide of [guideHtml.replace("__VINEXT_RSC_DONE__", "missing_completion"), guideHtml.replace("/assets/app.js", "/assets/missing.js")]) {
      await writeFile(new URL("dist/client/guide.html", root), "stale");
      await writeFile(new URL("dist/server/prerendered-routes/guide.html", root), brokenGuide);
      await assert.rejects(packageStaticHome(root, commit));
      await assert.rejects(readFile(new URL("dist/client/guide.html", root)), { code: "ENOENT" });
      await assert.rejects(readFile(new URL("dist/client/index.html", root)), { code: "ENOENT" });
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

for (const failure of ["version", "commit", "asset"]) {
  test(`static packaging rejects mismatched ${failure} and clears stale homepage`, async () => {
    // Separate roots keep Node's compiled-module import cache out of each case.
    const directory = await mkdtemp(path.join(tmpdir(), "static-package-invalid-"));
    const root = pathToFileURL(directory + "/");
    const commit = "a".repeat(40);
    try {
      await mkdir(new URL("dist/client/assets/", root), { recursive: true });
      await mkdir(new URL("dist/server/prerendered-routes/", root), { recursive: true });
      await writeFile(new URL("package.json", root), JSON.stringify({ version: "1.4.3", type: "module" }));
      await writeFile(new URL("dist/server/vinext-prerender.json", root), JSON.stringify({ routes: [{ route: "/", status: "rendered", revalidate: false }, { route: "/guide", status: "rendered", revalidate: false }, ...["/api/health", "/api/scores"].map(route => ({ route, status: "skipped", reason: "api" }))] }));
      await writeFile(new URL("dist/server/prerendered-routes/index.html", root), '<html><script>__VINEXT_RSC_CHUNKS__=[];__VINEXT_RSC_DONE__=true</script><script src="/assets/app.js"></script>Your watchlist Connecting to ESPN</html>');
      const health = { version: failure === "version" ? "wrong" : "1.4.3", commit: failure === "commit" ? "b".repeat(40) : commit };
      await writeFile(new URL("dist/server/index.js", root), `export default { fetch() { return Response.json(${JSON.stringify(health)}); } };`);
      if (failure !== "asset") await writeFile(new URL("dist/client/assets/app.js", root), "/* fixture */");
      await writeFile(new URL("dist/client/index.html", root), "stale");
      await assert.rejects(packageStaticHome(root, commit), failure === "asset" ? { code: "ENOENT" } : error => error.code === "ERR_ASSERTION" && error.actual[failure] === health[failure]);
      await assert.rejects(readFile(new URL("dist/client/index.html", root)), { code: "ENOENT" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}
