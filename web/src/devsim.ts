// Dev only (Vite's dev server, make dev-live): ?sim=<scenario> on any /app address fakes the server's side of loading,
// so every loading screen can be seen with the saved profiles, without spending the 42 API. Production builds drop
// this file whole: import.meta.env.DEV is false there.
//   boot     first extraction: skeleton with your card, progress in the band, the page once it ends (15 s)
//   restore  the server forgot your report: this browser's copy comes back, then a refresh runs in the band (12 s)
//   gone     same, while a page sits open: forgotten at the next page you open (pick another page in the band)
//   failed   the extraction failed: "Try again" starts the boot scenario
//   wait     deleted your data less than an hour ago: no copy, no extraction yet
//   hold     the first extraction's screen that never ends (the skeleton and its boxed status), to look at it at ease; the
//            owner's "Loading screen" button in the account menu turns it on for every page until turned off
// restore and gone need this browser's copy: open /app once without ?sim first.

const SCENARIOS = ["boot", "restore", "gone", "failed", "wait", "hold"];
export const HOLD = "devsim:hold"; // sessionStorage: the hold scenario on every page

if (import.meta.env.DEV) {
  const sim = new URLSearchParams(location.search).get("sim") || (sessionStorage.getItem(HOLD) ? "hold" : null);
  if (sim && SCENARIOS.includes(sim)) simulate(sim);
  else if (sim) console.info(`[devsim] unknown scenario "${sim}": ${SCENARIOS.join(", ")}`);
}

function simulate(start: string) {
  const real = window.fetch.bind(window);
  const json = (body: object, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const base = { consent: true, has_report: false, progress: 0, next_refresh_in: 0 };
  const queued = () => json({ state: "queued", progress: 0, next_refresh_in: 0 }, 202);
  const copies = () => Object.keys(localStorage).filter((k) => k.startsWith("copy:"));
  let phase = start, since = Date.now(), views = 0;
  const go = (p: string) => { console.info(`[devsim] ${phase} → ${p}`); phase = p; since = Date.now(); };
  // a running extraction for `secs`, then the server's real answer
  const running = (secs: number, extra: object = {}) => {
    const p = (Date.now() - since) / 1000 / secs;
    return p < 1 ? json({ ...base, ...extra, state: "running", progress: Math.round(p * 1000) / 1000 }) : null;
  };

  function reply(path: string, method: string): Response | null {
    if (path === "/api/me/status") {
      if (phase === "hold") return json({ ...base, state: "running", progress: ((Date.now() - since) / 60000) % 1 }); // a minute round, over and over
      if (phase === "boot") return running(15);
      if (phase === "refreshing") return running(12, { has_report: true });
      if (phase === "failed") return json({ ...base, state: "failed", message: "status.failed", next_refresh_in: 290 });
      if (phase === "wait") return json({ ...base, state: "none", next_refresh_in: 1800 });
      if (phase === "restore" || phase === "forgotten") { go("restored"); return json({ ...base, state: "none" }); }
    }
    if (path === "/api/me/report" && method === "POST") {
      if (phase === "hold") return json({ error: "signature" }, 400); // the copy never comes back: the skeleton stays
      if (phase === "wait") { copies().forEach((k) => localStorage.removeItem(k)); return json({ error: "signature" }, 400); } // the next plain visit keeps a new copy
      copies().forEach((k) => localStorage.setItem(k, "2000-01-01T00:00:00Z")); // old enough for the refresh in the band
    }
    if (path === "/api/me/refresh" && method === "POST") {
      if (phase === "failed") { go("boot"); return queued(); }
      if (phase === "restored") { go("refreshing"); return queued(); }
    }
    if (path === "/api/me/view" && phase === "gone" && ++views === 2) { go("forgotten"); return json({ error: "no-data" }, 404); }
    return null;
  }

  window.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
    return reply(url.pathname, (init?.method || "GET").toUpperCase()) ?? real(input, init);
  };
  console.info(`[devsim] scenario "${start}"`);
}
