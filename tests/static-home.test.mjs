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
    await writeFile(new URL("dist/server/vinext-prerender.json", root), JSON.stringify({ routes: [{ route: "/", status: "rendered", revalidate: false }, ...["/api/health", "/api/scores"].map(route => ({ route, status: "skipped", reason: "api" }))] }));
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
    await packageStaticHome(root, commit);
    assert.equal(await readFile(new URL("dist/client/index.html", root), "utf8"), `<!-- saturday-signal-static 1.4.3 ${commit} -->\n${html}`);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
