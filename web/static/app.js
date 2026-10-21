"use strict";
// Dashboard boot: language, status (first extraction, refresh), report, rail controls.

function viewFor(status, hasReport) {
  if (!hasReport) {
    if (status.state === "failed") return "error";
    // nothing stored and the hourly limit still running (back right after "Delete my data"): wait for it
    return status.next_refresh_in > 0 && (status.state === "none" || status.state === "done") ? "wait" : "progress";
  }
  return status.state === "queued" || status.state === "running" ? "report+progress" : "report";
}

function fmtWait(seconds, t) {
  return seconds < 60 ? t("refresh.wait_s", {count: Math.ceil(seconds)}) : t("refresh.wait", {count: Math.ceil(seconds / 60)});
}

// The public snapshot may only be published from a profile extracted less than an hour ago
function publishState(status, now) {
  if (status.state === "queued" || status.state === "running") return "busy";
  const last = Date.parse(status.last || "");
  return Number.isFinite(last) && now - last < 3600e3 ? "ready" : "stale";
}

if (typeof module !== "undefined" && module.exports) module.exports = {viewFor, fmtWait, publishState};

if (typeof window !== "undefined" && document.body?.dataset.page) {
  (async () => {
    const body = document.body;
    const csrf = body.dataset.csrf;
    const PAGES = [{href: "/app", key: "home", page: "web-home"}, {href: "/app/corrections", key: "corrections", page: "web-corrections"},
      {href: "/app/campus", key: "campus", page: "web-campus"}];
    const $ = (s) => document.querySelector(s);
    const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
    let lang = body.dataset.lang || "en";
    let dict = await (await fetch(`/shared/i18n/${lang}.json`)).json();
    setDict(dict);

    document.addEventListener("accent:change", (ev) => recolorFavicon(ev.detail));

    async function api(path, opts = {}) {
      const r = await fetch(path, {credentials: "same-origin", ...opts});
      if (r.status === 401) { sessionEnded(); throw new Error("session"); }
      return r;
    }
    function sessionEnded() {
      const boot = $("#boot");
      boot.hidden = false;
      boot.innerHTML = `<div><h2>${esc(t("session.ended"))}</h2><p><a class="btn primary" href="/auth/login">${esc(t("session.signin"))}</a></p></div>`;
    }
    const post = (path) => api(path, {method: "POST", headers: {"X-CSRF-Token": csrf}});

    let status = await (await api("/api/me/status")).json();
    let report = null;
    let timer;
    const loadReport = async () => {
      const r = await api("/api/me/report");
      report = r.status === 200 ? await r.json() : null;
    };
    await loadReport();

    // first visit (or a failure with nothing stored): full-page state until the report exists
    const refused = () => { location.href = `/app/refused?reason=${encodeURIComponent(status.message || "campus")}`; };
    if (status.state === "refused") return refused();
    while (!report) {
      if (status.state === "refused") return refused();
      const view = viewFor(status, false);
      showBoot(view, status);
      if (view === "error") return;
      // nothing queued and nothing to wait for: start the extraction from here (the hour ended while on this screen)
      if (status.state === "none" && !(status.next_refresh_in > 0)) status = await (await post("/api/me/refresh")).json();
      await new Promise((ok) => setTimeout(ok, 2000));
      status = await (await api("/api/me/status")).json();
      if (status.state === "done") await loadReport();
    }
    $("#boot").hidden = true;

    report.page = body.dataset.page;
    report.pages = PAGES;
    startReport(report, {i18n: dict});
    entrance();
    railControls();

    function showBoot(view, s) {
      const boot = $("#boot");
      boot.hidden = false;
      const signOut = `<form method="post" action="/auth/logout"><input type="hidden" name="csrf" value="${esc(csrf)}">` +
        `<button class="btn secondary" type="submit">${esc(t("signout.button"))}</button></form>`;
      if (view === "error") {
        boot.innerHTML = `<div><h2>${esc(t("boot.title"))}</h2><p>${esc(t("boot.failed"))}</p><p class="row-btns"><button class="btn primary" type="button" id="bootRetry">${esc(t("boot.retry"))}</button>${signOut}</p></div>`;
        $("#bootRetry").onclick = async () => { await post("/api/me/refresh"); location.reload(); };
        return;
      }
      if (view === "wait") {
        boot.innerHTML = `<div><h2>${esc(t("boot.title"))}</h2><p>${esc(fmtWait(s.next_refresh_in, t))}</p>` +
          `<p class="note">${esc(t("boot.wait_note"))}</p><p class="row-btns">${signOut}</p></div>`;
        return;
      }
      const pct = Math.round(100 * (s.progress || 0));
      boot.innerHTML = `<div><h2>${esc(t("boot.title"))}</h2><div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div>` +
        `<p>${esc(t(s.message || `status.${s.state}`))}</p><p class="note">${esc(t("boot.first"))}</p><p class="row-btns">${signOut}</p></div>`;
    }

    function entrance() {
      document.querySelectorAll("main > section").forEach((s, i) => s.style.setProperty("--i", String(Math.min(i, 8))));
      document.body.classList.add("enter");
    }

    // the top bar shows the sync state and Refresh; the settings panel holds language and account; dialogs sit outside it
    function railControls() {
      $("#sync").innerHTML = `<span class="last" id="lastRefresh"></span><span class="wait" id="refreshWait"></span>
        <div class="progress" id="refreshProgress" hidden><i></i></div><button class="btn on-rail" type="button" id="refreshBtn">${esc(t("refresh.button"))}</button>`;
      $("#settingsWeb").innerHTML = `<p class="s-label">${esc(t("settings.language"))}</p>
        <div class="theme" role="group" aria-label="${esc(t("site.language"))}" id="langToggle"><button type="button" data-v="en">EN</button><button type="button" data-v="es">ES</button></div>
        <p class="s-label">${esc(t("settings.account"))}</p>` +
        (body.dataset.publish ? `<div class="publish"><button class="btn on-rail" type="button" id="publishBtn">${esc(t("publish.button"))}</button><p class="wait" id="publishNote"></p></div>` : "") +
        `<div class="row-links"><button class="link-btn" type="button" id="deleteBtn">${esc(t("delete.button"))}</button>
        <form method="post" action="/auth/logout"><input type="hidden" name="csrf" value="${esc(csrf)}"><button class="link-btn" type="submit">${esc(t("signout.button"))}</button></form></div>
        <p class="wait" id="accountNote" role="status"></p>`;
      $("#dialogs").innerHTML = `<dialog id="deleteDialog"><h2>${esc(t("delete.title"))}</h2><p>${esc(t("delete.confirm"))}</p>
          <p class="row-btns"><button class="btn primary" type="button" id="deleteYes">${esc(t("delete.yes"))}</button><button class="btn secondary" type="button" id="deleteNo">${esc(t("delete.no"))}</button></p></dialog>` +
        (body.dataset.publish ? `<dialog id="publishDialog"><h2>${esc(t("publish.title"))}</h2><p>${esc(t("publish.confirm"))}</p>
          <p class="row-btns"><button class="btn primary" type="button" id="publishYes">${esc(t("publish.yes"))}</button><button class="btn secondary" type="button" id="publishNo">${esc(t("publish.no"))}</button></p></dialog>` : "");
      const langButtons = () => document.querySelectorAll("#langToggle button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === lang)));
      langButtons();
      $("#langToggle").onclick = async (ev) => {
        const b = ev.target.closest("button"); if (!b || b.dataset.v === lang) return;
        lang = b.dataset.v;
        await fetch("/lang", {method: "POST", body: new URLSearchParams({lang, next: location.pathname}), redirect: "manual", credentials: "same-origin"});
        dict = await (await fetch(`/shared/i18n/${lang}.json`)).json();
        window.setLanguage(dict);
        railControls();
      };
      $("#deleteBtn").onclick = () => $("#deleteDialog").showModal();
      $("#deleteNo").onclick = () => $("#deleteDialog").close();
      $("#deleteYes").onclick = async () => {
        const r = await post("/api/me/delete");
        if (r.ok) { location.href = "/"; return; }
        $("#deleteDialog").close();
        $("#accountNote").textContent = t(r.status === 403 ? "session.changed" : "status.failed");
      };
      if (body.dataset.publish) {
        $("#publishBtn").onclick = () => $("#publishDialog").showModal();
        $("#publishNo").onclick = () => $("#publishDialog").close();
        $("#publishYes").onclick = async () => {
          $("#publishDialog").close();
          const btn = $("#publishBtn");
          btn.disabled = true; btn.dataset.sending = "1";
          $("#publishNote").textContent = t("publish.sending");
          const r = await post("/api/me/publish").finally(() => { delete btn.dataset.sending; });
          const out = await r.json().catch(() => ({}));
          if (r.ok) {
            status.published = out.published;
            $("#publishNote").innerHTML = `${esc(t("publish.done"))} · <a href="${esc(out.url)}" target="_blank" rel="noopener">${esc(t("publish.view"))}</a>`;
          } else $("#publishNote").textContent = t(`publish.error_${out.error || "github"}`);
          btn.disabled = publishState(status, Date.now()) !== "ready";
        };
      }
      $("#refreshBtn").onclick = async () => {
        const r = await post("/api/me/refresh");
        if (r.status === 403) { $("#refreshWait").textContent = t("session.changed"); return; }
        status = await r.json();
        tick();
      };
      tick();
    }

    function tick() {
      clearTimeout(timer);
      const btn = $("#refreshBtn"), wait = $("#refreshWait"), bar = $("#refreshProgress");
      if (!btn) return;
      $("#lastRefresh").textContent = status.last ? t("refresh.last", {when: new Date(status.last).toLocaleString(t("_locale"), {dateStyle: "medium", timeStyle: "short"})}) : "";
      publishTick();
      const busy = status.state === "queued" || status.state === "running";
      bar.hidden = !busy;
      if (busy) {
        bar.firstElementChild.style.width = `${Math.round(100 * (status.progress || 0))}%`;
        btn.disabled = true;
        wait.textContent = t(status.message || `status.${status.state}`);
        timer = setTimeout(async () => {
          status = await (await api("/api/me/status")).json();
          if (status.state === "refused") { refused(); return; }
          if (status.state === "done") { location.reload(); return; }
          tick();
        }, 2000);
        return;
      }
      btn.disabled = status.next_refresh_in > 0;
      wait.textContent = status.state === "failed" ? t("status.failed") : status.next_refresh_in > 0 ? fmtWait(status.next_refresh_in, t) : "";
      if (status.next_refresh_in > 0) timer = setTimeout(() => { status.next_refresh_in -= 1; tick(); }, 1000);
    }

    function publishTick() {
      const btn = $("#publishBtn"), note = $("#publishNote");
      if (!btn || btn.dataset.sending) return;
      const state = publishState(status, Date.now());
      btn.disabled = state !== "ready";
      if (state === "ready" && note.querySelector("a")) return;
      note.textContent = state === "stale" ? t("publish.stale") : state === "busy" ? "" :
        status.published ? t("publish.last", {when: new Date(status.published).toLocaleString(t("_locale"), {dateStyle: "medium", timeStyle: "short"})}) : "";
    }

    function recolorFavicon(color) {
      if (!/^#[0-9a-f]{3,6}$/i.test(color || "")) return;
      fetch("/static/favicon.svg").then((r) => r.text()).then((svg) => {
        const url = "data:image/svg+xml," + encodeURIComponent(svg.replace(/(id="lit"[^>]*fill=")#[0-9a-f]+/i, `$1${color}`));
        document.querySelectorAll('link[rel="icon"][type="image/svg+xml"]').forEach((l) => { l.href = url; });
      });
    }
  })();
}
