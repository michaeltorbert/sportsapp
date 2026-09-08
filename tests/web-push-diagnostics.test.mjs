import test from "node:test";
import assert from "node:assert/strict";
import { bundle } from "./helpers.mjs";
const { sendPush, encode } = await bundle("services/alerts/web-push.ts");
async function fixture() {
  const receiver = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const signing = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  return {
    subscription: { endpoint: "https://web.push.apple.com/synthetic-private-path", keys: { p256dh: encode(new Uint8Array(await crypto.subtle.exportKey("raw", receiver.publicKey))), auth: encode(crypto.getRandomValues(new Uint8Array(16))) } },
    config: { publicKey: encode(new Uint8Array(await crypto.subtle.exportKey("raw", signing.publicKey))), privateKey: (await crypto.subtle.exportKey("jwk", signing.privateKey)).d, subject: "https://app.test" },
  };
}
for (const stage of ["serialize", "encrypt", "vapid", "transport"]) test(`push ${stage} failures emit only a safe stage and retain rejection`, async t => {
  const { subscription, config } = await fixture(), logs = [];
  t.mock.method(console, "error", message => logs.push(message));
  const payload = stage === "serialize" ? { toJSON() { throw new Error("sensitive payload detail"); } } : { title: "sensitive payload detail" };
  if (stage === "encrypt") subscription.keys.p256dh = "invalid";
  if (stage === "vapid") config.privateKey = "invalid";
  let calls = 0;
  await assert.rejects(sendPush(subscription, payload, config, async () => { calls++; throw new Error(`${subscription.endpoint} ${config.privateKey}`); }), { message: `Push send failed during ${stage}` });
  assert.equal(calls, stage === "transport" ? 1 : 0);
  assert.deepEqual(logs, [JSON.stringify({ event: "push_send_failed", stage })]);
});
test("body cleanup rejection preserves the received status and logs only the status", async t => {
  const { subscription, config } = await fixture(), logs = [];
  t.mock.method(console, "error", message => logs.push(message));
  assert.equal(await sendPush(subscription, { title: "local test" }, config, async () => ({ status: 201, body: { async cancel() { throw new Error(subscription.endpoint); } } })), 201);
  assert.deepEqual(logs, [JSON.stringify({ event: "push_response_cleanup_failed", status: 201 })]);
});
