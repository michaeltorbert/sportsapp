import { test as base, expect } from "@playwright/test";

export const NOW = "2026-09-06T03:59:00Z"; // Saturday, 11:59 p.m. Eastern.
export const ALERT_ORIGIN = "https://alerts.example.test";
export const CREDENTIALS = { id: "simulated-device", token: "simulated-management-token" };

export function event(id, { date = "2026-09-05T23:30:00Z", state = "live", acc = false, rank = null, scores = [14, 21] } = {}) {
  const post = state === "final", pre = state === "upcoming";
  return {
    id, date,
    status: { period: pre ? 0 : 4, clock: pre || post ? 0 : 180, type: { name: post ? "STATUS_FINAL" : pre ? "STATUS_SCHEDULED" : "STATUS_IN_PROGRESS", state: post ? "post" : pre ? "pre" : "in", completed: post, shortDetail: post ? "Final" : pre ? "Scheduled" : "3:00 - 4th" } },
    competitions: [{ broadcasts: [{ names: ["TEST NETWORK"] }], competitors: ["away", "home"].map((side, i) => ({
      id: `${id}-${side}`, homeAway: side, score: pre ? "0" : String(scores[i]), curatedRank: { current: i === 0 && rank ? rank : 99 },
      team: { id: `${id}-${side}`, shortDisplayName: `${id} ${side}`, abbreviation: side.toUpperCase(), conferenceId: i === 0 && acc ? "1" : "2" },
    })) }],
  };
}

export function standardEvents() {
  return [
    event("ranked-live", { rank: 5 }),
    event("acc-final", { acc: true, state: "final", scores: [28, 7] }),
    event("close-live", { scores: [10, 10] }),
    event("sunday-acc", { date: "2026-09-06T21:00:00Z", acc: true, state: "upcoming" }),
    event("monday-ranked", { date: "2026-09-07T23:00:00Z", rank: 12, state: "upcoming" }),
    event("friday-ranked", { date: "2026-09-04T22:00:00Z", rank: 20, state: "final", scores: [28, 7] }),
  ];
}

// Deliberately fake browser APIs: this exercises the real Alerts UI, not a push
// provider, OS permission dialog, actual service worker, or installed iOS app.
async function installPushSimulation(page, options) {
  await page.addInitScript(({ options, credentials }) => {
    let sequence = 0;
    const audit = { permissionRequests: 0, subscribes: 0, unsubscribes: 0 };
    const makeSubscription = endpoint => ({ endpoint,
      toJSON() { return { endpoint, keys: { p256dh: "simulated-public-key", auth: "simulated-auth" } }; },
      async unsubscribe() { audit.unsubscribes++; current = null; try { sessionStorage.removeItem("simulated-push-endpoint"); } catch {} return true; },
    });
    let persisted = null; try { persisted = sessionStorage.getItem("simulated-push-endpoint"); } catch {}
    let current = persisted ? makeSubscription(persisted) : options.existing ? makeSubscription("https://push.example.test/existing") : null;
    const registration = { pushManager: {
      async getSubscription() { return current; },
      async subscribe() { audit.subscribes++; current = makeSubscription(`https://push.example.test/new-${++sequence}`); try { sessionStorage.setItem("simulated-push-endpoint", current.endpoint); } catch {} return current; },
    } };
    class SimulatedNotification {
      static permission = persisted ? "granted" : options.permission || "default";
      static async requestPermission() { audit.permissionRequests++; this.permission = options.permissionResult || "granted"; return this.permission; }
    }
    Object.defineProperty(window, "Notification", { configurable: true, value: SimulatedNotification });
    Object.defineProperty(window, "PushManager", { configurable: true, value: class SimulatedPushManager {} });
    Object.defineProperty(navigator, "standalone", { configurable: true, value: options.standalone !== false });
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: {
      async register() { return registration; }, ready: Promise.resolve(registration),
      async getRegistration() { return registration; },
    } });
    window.__pushSimulation = audit;
    if (options.credentials && !localStorage.getItem("ss:push")) localStorage.setItem("ss:push", JSON.stringify(credentials));
  }, { options, credentials: CREDENTIALS });
}

export const test = base.extend({
  harness: async ({ page, browser, browserName, request }, provide, testInfo) => {
    const state = {
      events: standardEvents(), failScores: false, ready: true, failConfig: false,
      active: true, kickoff: true, closeGame: true, upsetWatch: true, upsetFinal: true, revision: 0, preferencesVersion: 1, failSave: false, conflict: false, alertRequests: [], scoreRequests: [], cdnFeed: null, cdnRequests: [], hostedScoreRequests: [], unexpectedExternal: [], errors: [],
    };
    const lifecycle = [];
    const recordLifecycle = event => lifecycle.push({ event, utc: new Date().toISOString(), url: page.url() });
    const onCrash = () => recordLifecycle("crash");
    const onClose = () => recordLifecycle("close");
    const onDisconnect = () => recordLifecycle("disconnected");
    page.on("crash", onCrash);
    page.on("close", onClose);
    browser.on("disconnected", onDisconnect);
    page.on("pageerror", error => state.errors.push(error.message));
    await page.route("**/*", async route => {
      const req = route.request(), url = new URL(req.url());
      const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
      if (url.origin === ALERT_ORIGIN) {
        if (url.pathname === "/config") return json({ ready: state.ready, publicKey: "AA", preferencesVersion: state.preferencesVersion }, state.failConfig ? 503 : 200);
        state.alertRequests.push({ method: req.method(), path: url.pathname, authorization: req.headers().authorization || null, body: req.postDataJSON() });
        const status = () => ({ active: state.active, kickoff: state.kickoff, closeGame: state.closeGame, upsetWatch: state.upsetWatch, upsetFinal: state.upsetFinal, revision: state.revision, preferencesVersion: state.preferencesVersion });
        if (req.method() === "GET") return json(state.getStatus ? { error: "simulated settings read failure" } : status(), state.getStatus || 200);
        if (state.failSave) return json({ error: "simulated failure" }, 503);
        if (req.method() === "POST" && state.conflict) return json({ error: "simulated missing credentials", code: "ownership-conflict" }, 409);
        if (req.method() === "POST" && req.postDataJSON().revision !== undefined && req.postDataJSON().revision !== state.revision) return json({ error: "simulated stale revision", code: "revision-conflict" }, 409);
        if (req.method() === "PATCH" || req.method() === "POST") {
          const body = req.postDataJSON();
          for (const key of ["active", "kickoff", "closeGame", "upsetWatch", "upsetFinal"]) if (typeof body[key] === "boolean") state[key] = body[key];
          if (req.method() === "POST") state.active = true;
          state.revision++;
          return json(req.method() === "POST" ? CREDENTIALS : status());
        }
        if (req.method() === "DELETE") { state.active = false; state.revision++; }
        return json({ ok: true });
      }
      if (url.hostname === "site.api.espn.com") {
        if (url.pathname.endsWith("/summary")) { state.summaryRequests = (state.summaryRequests || 0) + 1; return json(state.summary || {}, state.failSummary ? 503 : 200); }
        if (url.pathname.endsWith("/scoreboard")) {
          state.scoreRequests.push(url.search);
          const events = url.searchParams.get("groups") === "1" ? state.events.filter(e => e.competitions[0].competitors.some(c => c.team.conferenceId === "1")) : state.events;
          return json({ events }, state.failScores ? 503 : 200);
        }
      }
      if (url.hostname === "cdn.espn.com") {
        state.cdnRequests.push(url.search);
        return state.cdnFeed ? json(state.cdnFeed) : json({ error: "simulated CDN unavailable" }, 503);
      }
      if (url.origin === testInfo.project.use.baseURL) {
        if (url.pathname === "/alerts-config.json") return json({ serviceUrl: ALERT_ORIGIN });
        // The simulated direct feed only falls back in explicit failure cases.
        // Intercept here so the local Worker can never query a real score feed.
        if (url.pathname === "/api/scores") {
          state.hostedScoreRequests.push(url.search);
          return json({ error: "simulated feed unavailable" }, 503);
        }
        return route.continue();
      }
      state.unexpectedExternal.push(req.url());
      return route.abort();
    });
    const health = await (await request.get("/api/health")).json();
    expect(health).toEqual({ version: testInfo.config.metadata.appVersion, commit: testInfo.config.metadata.sourceCommit });
    await provide({
      state,
      async open({ now = NOW, push = {}, path = "/", waitForScores = true } = {}) {
        await page.clock.install({ time: new Date(now) });
        await installPushSimulation(page, push);
        await page.goto(path);
        if (waitForScores) await expect(page.getByRole("button", { name: "Refresh scores" })).toBeEnabled();
      },
    });
    // The page may already have crashed. Preserve the original test failure and
    // attach Node-side evidence even when evaluating navigator is impossible.
    let userAgent = null, userAgentError = null;
    try { userAgent = await page.evaluate(() => navigator.userAgent); }
    catch (error) { userAgentError = error.message; }
    page.off("crash", onCrash);
    page.off("close", onClose);
    browser.off("disconnected", onDisconnect);
    await testInfo.attach("browser-evidence", { contentType: "application/json", body: JSON.stringify({
      utc: new Date().toISOString(), ...testInfo.config.metadata, deployedLocalBuild: health,
      browser: browserName, engineVersion: browser.version(), viewport: page.viewportSize(),
      userAgent, userAgentError, hasTouch: testInfo.project.use.hasTouch,
      lifecycle, pageClosed: page.isClosed(), browserConnected: browser.isConnected(),
      testErrors: testInfo.errors.map(error => ({ message: error.message, stack: error.stack })),
      runtimeErrors: state.errors,
      simulated: ["ESPN responses", "alert-service responses", "notification permission", "PushManager", "service-worker registration", "installed standalone state"],
      alertRequests: state.alertRequests, scoreRequests: state.scoreRequests, cdnRequests: state.cdnRequests, hostedScoreRequests: state.hostedScoreRequests, unexpectedExternal: state.unexpectedExternal,
    }, null, 2) });
    // Soft assertions still fail the test while allowing every crash/runtime
    // check to report its evidence instead of stopping at the first failure.
    expect.soft(lifecycle.filter(entry => entry.event === "crash"), "No browser page crashes").toEqual([]);
    expect.soft(lifecycle.filter(entry => entry.event === "disconnected"), "Browser remains connected during the test").toEqual([]);
    expect.soft(state.unexpectedExternal, "No unmocked external request is permitted").toEqual([]);
    expect.soft(state.errors, "No browser runtime errors").toEqual([]);
  },
});

export { expect };
export const dateInput = page => page.getByLabel("Scoreboard date, Eastern time");
export const cards = page => page.locator("article.game-card");
// Category toggles and the All reset are aria-pressed buttons named "<label> <count>".
export const category = (page, label) => page.getByRole("button", { name: new RegExp(`^${label}\\b`) });
export const period = (page, label) => page.getByRole("group", { name: "Scoreboard period" }).getByRole("button", { name: label, exact: true });
export async function expectCount(page, label, count) {
  await expect(category(page, label).locator(".tab-count")).toHaveText(String(count));
}
export async function expectUpsetCount(page, brewing, total) {
  const button = category(page, "Upsets");
  await expect(button.locator(".tab-count")).toHaveText(`${brewing} (${total})`);
  await expect(button).toHaveAttribute("aria-label", `Upsets, ${brewing} brewing, ${total} brewing or completed upsets`);
}
export async function expectPressed(page, labels) {
  for (const label of ["All", "ACC", "Top 25", "One score", "Upsets"]) await expect(category(page, label)).toHaveAttribute("aria-pressed", String(labels.includes(label)));
}
