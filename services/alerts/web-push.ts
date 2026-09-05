// Standard Web Push: RFC 8291 (aes128gcm) and RFC 8292 (VAPID), using Web Crypto.
export type Subscription = { endpoint: string; keys: { p256dh: string; auth: string } };
const encoder = new TextEncoder();
export const bytes = (value: string) => encoder.encode(value);
export function decode(value: string): Uint8Array<ArrayBuffer> { return Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4)), c => c.charCodeAt(0)); }
export function encode(value: Uint8Array) { return btoa(String.fromCharCode(...value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
export function concat(...arrays: Uint8Array[]): Uint8Array<ArrayBuffer> { const output = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0)); let i = 0; for (const a of arrays) { output.set(a, i); i += a.length; } return output; }
async function hmac(key: Uint8Array<ArrayBuffer>, value: Uint8Array<ArrayBuffer>) { const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); return new Uint8Array(await crypto.subtle.sign("HMAC", k, value)); }
export async function hash(value: string) { return encode(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes(value)))); }
export async function encrypt(subscription: Subscription, payload: string, fixed?: { key: CryptoKeyPair; salt: Uint8Array<ArrayBuffer> }) {
  const plain = bytes(payload);
  if (plain.length > 3993) throw new Error("Push payload is too large");
  const pair = fixed?.key || await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const sender = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const receiver = decode(subscription.keys.p256dh), auth = decode(subscription.keys.auth);
  const receiverKey = await crypto.subtle.importKey("raw", receiver, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: receiverKey }, pair.privateKey, 256));
  const keyPRK = await hmac(auth, secret);
  const ikm = await hmac(keyPRK, concat(bytes("WebPush: info\0"), receiver, sender, new Uint8Array([1])));
  const salt = fixed?.salt || crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, bytes("Content-Encoding: aes128gcm\0\x01"))).slice(0, 16);
  const nonce = (await hmac(prk, bytes("Content-Encoding: nonce\0\x01"))).slice(0, 12);
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, concat(plain, new Uint8Array([2]))));
  const header = new Uint8Array(21); header.set(salt); new DataView(header.buffer).setUint32(16, 4096); header[20] = sender.length;
  return concat(header, sender, ciphertext);
}
export async function vapid(endpoint: string, publicKey: string, privateKey: string, subject: string, now = Date.now()) {
  const raw = decode(publicKey);
  const key = await crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", x: encode(raw.slice(1, 33)), y: encode(raw.slice(33)), d: privateKey }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const unsigned = `${encode(bytes(JSON.stringify({ typ: "JWT", alg: "ES256" })))}.${encode(bytes(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })))}`;
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, bytes(unsigned)));
  return `vapid t=${unsigned}.${encode(signature)}, k=${publicKey}`;
}
export async function validSubscription(value: unknown): Promise<Subscription | null> {
  try {
    const sub = value as Subscription, url = new URL(sub.endpoint);
    const allowed = url.hostname === "fcm.googleapis.com" || url.hostname === "updates.push.services.mozilla.com" || url.hostname.endsWith(".push.services.mozilla.com") || url.hostname.endsWith(".push.apple.com");
    if (!allowed || url.protocol !== "https:" || url.username || url.password || url.port || url.href.length > 4096 || url.hash) return null;
    if (decode(sub.keys.auth).length !== 16 || decode(sub.keys.p256dh).length !== 65) return null;
    await crypto.subtle.importKey("raw", decode(sub.keys.p256dh), { name: "ECDH", namedCurve: "P-256" }, false, []);
    return { endpoint: url.href, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } };
  } catch { return null; }
}
export async function sendPush(subscription: Subscription, payload: unknown, config: { publicKey: string; privateKey: string; subject: string }, fetcher: typeof fetch = fetch) {
  const body = await encrypt(subscription, JSON.stringify(payload));
  const authorization = await vapid(subscription.endpoint, config.publicKey, config.privateKey, config.subject);
  const response = await fetcher(subscription.endpoint, { method: "POST", redirect: "error", signal: AbortSignal.timeout(10000), headers: { Authorization: authorization, "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: "300", Urgency: "high" }, body });
  await response.body?.cancel();
  return response.status;
}
