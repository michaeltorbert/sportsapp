import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare } from "miniflare";

// Exercise workerd's actual fetch rather than injecting a JavaScript fetch stub.
// All outbound requests terminate in the local handler; keys are ephemeral.
test("workerd sends push once and does not follow a provider redirect", async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const config = JSON.parse(readFileSync(new URL("../services/alerts/wrangler.jsonc", import.meta.url), "utf8"));
  const built = await build({ stdin: { resolveDir: root, loader: "ts", contents: `
    import { sendPush, encode } from './services/alerts/web-push.ts';
    export default { async fetch() {
      const receiver = await crypto.subtle.generateKey({ name:'ECDH', namedCurve:'P-256' }, true, ['deriveBits']);
      const signing = await crypto.subtle.generateKey({ name:'ECDSA', namedCurve:'P-256' }, true, ['sign','verify']);
      const subscription = { endpoint:'https://web.push.apple.com/local-fixture', keys: {
        p256dh:encode(new Uint8Array(await crypto.subtle.exportKey('raw',receiver.publicKey))),
        auth:encode(crypto.getRandomValues(new Uint8Array(16))) } };
      const config = { publicKey:encode(new Uint8Array(await crypto.subtle.exportKey('raw',signing.publicKey))),
        privateKey:(await crypto.subtle.exportKey('jwk',signing.privateKey)).d, subject:'https://app.test' };
      return Response.json({ status:await sendPush(subscription,{ title:'Local fixture' },config) });
    } };` }, bundle: true, format: "esm", write: false });
  let calls = 0, providerStatus = 201;
  const mf = new Miniflare({ telemetry: { enabled: false }, workers: [{
    config: { name: "push-runtime-test", type: "worker", compatibilityDate: config.compatibility_date,
      compatibilityFlags: config.compatibility_flags || [],
      manifest: { mainModule: "index.js", modulesRoot: "/", modules: { "index.js": { type: "esm", contents: built.outputFiles[0].text } } } },
    dev: { outboundService: { type: "fetcher", handler: async request => {
      calls++;
      assert.equal(request.url, "https://web.push.apple.com/local-fixture", "A redirect destination must never be contacted");
      assert.equal(request.method, "POST");
      assert.equal(request.headers.get("content-encoding"), "aes128gcm");
      assert.match(request.headers.get("authorization"), /^vapid t=/);
      assert.ok((await request.arrayBuffer()).byteLength > 86);
      return new Response("Local provider response", { status: providerStatus, headers: { Location: "https://other.test/forbidden" } });
    } } },
  }] });
  try {
    for (providerStatus of [201, 307]) {
      const before = calls;
      const response = await mf.dispatchFetch("http://local.test/");
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { status: providerStatus });
      assert.equal(calls, before + 1);
    }
  } finally { await mf.dispose(); }
});
