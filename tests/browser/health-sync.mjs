import { expect } from "@playwright/test";

// Observe body consumption, not merely transport completion. Only health JSON
// is instrumented; the original result and rejection behavior are preserved.
export async function observeHealthBodies(page) {
  await page.addInitScript(() => {
    window.__healthBodiesConsumed = 0;
    const json = Response.prototype.json;
    Response.prototype.json = function (...args) {
      if (!this.url || new URL(this.url).pathname !== "/api/health") return json.apply(this, args);
      return json.apply(this, args).then(body => {
        window.__healthBodiesConsumed++;
        return body;
      });
    };
  });
}

export async function consumeHealthAfter(page, action) {
  const before = await page.evaluate(() => window.__healthBodiesConsumed);
  expect(Number.isInteger(before), "Install the health observer before navigation").toBe(true);
  const received = page.waitForResponse(response => new URL(response.url()).pathname === "/api/health" && response.ok());
  await action();
  expect(await (await received).finished(), "Health response completed successfully").toBeNull();
  // Node polling stays live while the page clock is installed/paused.
  await expect.poll(() => page.evaluate(() => window.__healthBodiesConsumed)).toBeGreaterThan(before);
  // Let the application's promise continuations schedule their confirmation
  // timer before the caller advances fake time. MessageChannel uses real tasks.
  await page.evaluate(() => new Promise(resolve => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => { channel.port1.close(); channel.port2.close(); resolve(); };
    channel.port2.postMessage(null);
  }));
}
