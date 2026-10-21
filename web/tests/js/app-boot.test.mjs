import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SOURCE = readFileSync(new URL("../../static/app.js", import.meta.url), "utf8");

// Any property of a stub element is another stub (callable), assignments are kept: enough DOM for the boot code.
function stub() {
  const own = {};
  return new Proxy(function () {}, {
    get: (_, k) => (k in own ? own[k] : k === Symbol.toPrimitive ? () => "" : (own[k] = k === "dataset" ? {} : stub())),
    set: (_, k, v) => { own[k] = v; return true; },
    apply: () => stub(),
  });
}

async function boot(status, data = {}) {
  const els = new Map();
  const el = (sel) => els.get(sel) ?? els.set(sel, stub()).get(sel);
  const errors = [];
  const json = (body, code = 200) => ({ status: code, ok: code < 300, json: async () => body, text: async () => "" });
  const calls = [];
  const ctx = {
    document: { body: { dataset: { page: "web-home", csrf: "c", lang: "en", accent: "#E39F0B", ...data }, classList: stub() },
      querySelector: el, querySelectorAll: () => [], addEventListener() {} },
    fetch: async (url, opts = {}) => { calls.push(`${opts.method || "GET"} ${url}`);
      return url === "/api/me/report" && data.noReport ? json({ error: "no-data" }, 404) : json(url === "/api/me/status" ? status : {}); },
    setDict() {}, applyAccent() {}, startReport() {}, setLanguage() {},
    t: (k, v) => (k === "_locale" ? "en-GB" : v && v.count != null ? `${k}:${v.count}` : k),
    setTimeout: () => 0, clearTimeout() {}, URLSearchParams, location: { pathname: "/app" },
  };
  ctx.window = ctx;
  const onReject = (e) => errors.push(e);
  process.on("unhandledRejection", onReject);
  vm.runInNewContext(SOURCE, ctx);
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setTimeout(r, 20));
  process.off("unhandledRejection", onReject);
  return { els, errors, calls, ctx };
}

test("dashboard boot reaches the rail controls without throwing", async () => {
  const { errors } = await boot({ state: "done", next_refresh_in: 120 });
  assert.deepEqual(errors.map(String), []);
});

test("the refresh countdown is shown after boot during the cooldown", async () => {
  const { els } = await boot({ state: "done", next_refresh_in: 120 });
  assert.equal(els.get("#refreshWait").textContent, "refresh.wait:2");
  assert.equal(els.get("#refreshBtn").disabled, true);
});

test("the owner's publish button waits for a fresh extraction", async () => {
  const { els, errors } = await boot({ state: "done", next_refresh_in: 0, last: "2020-01-01T00:00:00+00:00" }, { publish: "1" });
  assert.deepEqual(errors.map(String), []);
  assert.equal(els.get("#publishBtn").disabled, true);
  assert.equal(els.get("#publishNote").textContent, "publish.stale");
});

test("the owner's publish button is ready right after an extraction", async () => {
  const { els } = await boot({ state: "done", next_refresh_in: 3000, last: new Date().toISOString() }, { publish: "1" });
  assert.equal(els.get("#publishBtn").disabled, false);
});

test("only the owner's settings get the publish button", async () => {
  const other = await boot({ state: "done", next_refresh_in: 0 });
  const owner = await boot({ state: "done", next_refresh_in: 0 }, { publish: "1" });
  assert.ok(!String(other.els.get("#settingsWeb").innerHTML).includes("publishBtn"));
  assert.ok(String(owner.els.get("#settingsWeb").innerHTML).includes("publishBtn"));
});

test("refresh lives in the top bar; language and account in the settings panel", async () => {
  const { els } = await boot({ state: "done", next_refresh_in: 0 });
  assert.ok(String(els.get("#sync").innerHTML).includes('id="refreshBtn"'));
  const settings = String(els.get("#settingsWeb").innerHTML);
  assert.ok(settings.includes('id="langToggle"') && settings.includes('id="deleteBtn"') && settings.includes('action="/auth/logout"'));
  assert.ok(String(els.get("#dialogs").innerHTML).includes('id="deleteDialog"'));
});

test("a refused status sends the page to the refused screen", async () => {
  const { ctx } = await boot({ state: "refused", message: "blackholed", next_refresh_in: 0 }, { noReport: "1" });
  assert.equal(ctx.location.href, "/app/refused?reason=blackholed");
});

test("rail buttons never carry the rail layout class (it is the 100vh sticky column)", async () => {
  const { els } = await boot({ state: "done", next_refresh_in: 0 }, { publish: "1" });
  const html = String(els.get("#sync").innerHTML) + String(els.get("#settingsWeb").innerHTML);
  assert.ok(!/class="[^"]*\brail\b[^"]*"/.test(html.replace(/\bon-rail\b/g, "")), html.match(/class="[^"]*\brail\b[^"]*"/)?.[0]);
  assert.ok(html.includes('class="btn on-rail"'));
});

test("after deleting and signing in again within the hour, the boot screen counts down and offers sign-out", async () => {
  const { els, errors } = await boot({ state: "none", next_refresh_in: 600 }, { noReport: "1" });
  assert.deepEqual(errors.map(String), []);
  const html = String(els.get("#boot").innerHTML);
  assert.ok(html.includes("boot.wait"), html);
  assert.ok(html.includes('action="/auth/logout"'));
});

test("with nothing stored and nothing queued, the boot starts the extraction itself", async () => {
  const { calls, els } = await boot({ state: "none", next_refresh_in: 0 }, { noReport: "1" });
  assert.ok(calls.includes("POST /api/me/refresh"), calls.join(", "));
  assert.ok(String(els.get("#boot").innerHTML).includes('action="/auth/logout"'));
});
