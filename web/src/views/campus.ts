// Campus: your rhythm, the logtime bonus in detail and its history, the seat plan with every computer, the days, every
// session, where evaluations happen and your campuses.
import { S1, S2, legend, vbars } from "../lib/charts";
import { ACCENT, calendar, heat, seatPlan } from "../lib/graphs";
import { esc } from "../lib/h";
import { table } from "../lib/table";
import { Page, Section, block, cols, filters, info, kpis, msOf, search, section } from "./page";

/** Two facts on one line of a description, split by a light rule. */
const pair = (a: string, b: string) => `${esc(a)}<span class="sep" aria-hidden="true"> | </span>${esc(b)}`;

const when = (pg: Page, iso: string) => `<span class="nw">${esc(pg.f.stamp(msOf(iso)))}</span>`;

export function campus(pg: Page): Section[] {
  const f = pg.f, D = pg.D, L = D.logtime, layout = pg.v.layout || {}, dv = pg.v.derive || {};
  const out: Section[] = [];

  // rhythm (Home held it in v1)
  const [weeks, span] = dv.active_weeks || [0, 0];
  const split = dv.day_split || { morning: 0, afternoon: 0, night: 0 };
  const validated = D.projects.filter((p: any) => p.validated && p.days_to_validate !== null && p.days_to_validate !== undefined).map((p: any) => p.days_to_validate).sort((a: number, b: number) => a - b);
  const median = validated.length ? validated[Math.floor(validated.length / 2)] : null;
  const parts = Object.entries(split) as [string, number][];
  const any = parts.some(([, v]) => v);
  const topPart = parts.reduce((a, b) => (b[1] > a[1] ? b : a))[0];
  out.push({ id: "rhythm", nav: f.t("rhythm.title"), html: section("rhythm", f.t("rhythm.title"), cols(block("kpis", kpis([
    [f.t("rhythm.k_streak"), f.num(dv.streak), [esc(f.t("rhythm.s_streak"))]],
    [f.t("rhythm.k_weeks"), f.num(weeks), [esc(f.t("rhythm.s_weeks", { total: f.num(span) }))]],
    [f.t("rhythm.k_time"), any ? esc(capital(f.t(`rhythm.${topPart}`))) : "–", [
      `<span class="split" aria-hidden="true">${parts.filter(([, v]) => v).map(([k, v]) => `<i class="${k}" style="width:${v}%"></i>`).join("")}</span>`,
      parts.map(([k, v], i) => `<span class="part"><i class="${k}"></i>${esc(f.t("rhythm.s_part", { pct: v, part: f.t(`rhythm.${k}`), hours: ["6–14 h", "14–20 h", "20–6 h"][i] }))}</span>`).join("")]],
    [f.t("rhythm.k_validate"), median !== null ? f.num(median, 1) : "–", [esc(f.t("rhythm.s_validate", { n: validated.length })), esc(f.t("rhythm.s_resilience", { n: dv.resilience ?? 0 }))]],
  ]))), { lede: esc(f.t("rhythm.lede")) }) });

  // the logtime bonus in detail (inferred rule) and every bonus given so far
  const W = D.logtime_bonus, tiers = dv.logtime_bonus as any[] | null, P = D.coalition_points;
  if (W && tiers && pg.period !== "piscine") {
    const sessions = W.sessions || [];
    const items: [string, string, string[]][] = [[f.t("coal.k_window"), `${f.num(tiers[0].window_h, 1)}<small> h</small>`,
      [W.open && sessions.length ? f.t("coal.s_open", { since: when(pg, sessions[sessions.length - 1][0]) }) : esc(f.t("coal.s_closed")), f.t("coal.s_as_of", { time: when(pg, W.at) })]]];
    for (const t of tiers) {
      const p = Math.min(100, (100 * t.window_h) / t.hours);
      const meter = `<span class="hbar" aria-hidden="true"><i style="width:${p.toFixed(1)}%"></i></span>` + esc(f.t("coal.s_meter", { have: f.num(t.window_h, 1), need: t.hours }));
      const head = ({ ready: esc(f.t("coal.v_ready")), cooldown: esc(f.t("coal.v_cooldown")), short: `${f.num(t.need_h, 1)}<small> ${esc(f.t("coal.v_short"))}</small>` } as Record<string, string>)[t.state];
      const until = t.state === "ready" && W.open ? esc(f.t("coal.s_next_logout"))
        : t.until && t.until !== t.from ? f.t(W.open ? "coal.s_until" : "coal.s_login_until", { time: when(pg, t.until) }) : "";
      items.push([f.t("coal.k_tier", { hours: t.hours, points: f.num(t.points) }), head,
        [meter, t.from ? f.t("coal.s_from", { time: when(pg, t.from) }) : "", until, t.last ? f.t("coal.s_last", { time: when(pg, t.last) }) : esc(f.t("coal.s_never"))]]);
    }
    const bonuses = P?.bonuses || [];
    const list = bonuses.map((b: any) => `<li><span><b>${esc(f.t("bonus.got", { hours: b.hours }))}</b><br><span class="note">${esc(f.stamp(msOf(b.at)))}</span></span>`
      + `<span class="when">+${esc(f.num(b.points))}</span></li>`).join("") || `<li class="note">${esc(f.t("bonus.none"))}</li>`;
    out.push({ id: "bonus", nav: f.t("bonus.title"), html: section("bonus", "", cols(block("coal-bonus", kpis(items)),
      block("bonus-history", `<ol class="list" tabindex="0" aria-label="${esc(f.t("bonus.history"))}">${list}</ol>`, f.t("bonus.history"),
        bonuses.length ? f.t("bonus.history_note", { n: f.plural(bonuses.length, "coal.awards"), points: f.num(bonuses.reduce((s: number, b: any) => s + b.points, 0)) }) : "")),
    { head: `<h2>${esc(f.t("bonus.title"))} ${info(f.t("coal.note"))}</h2>`, lede: esc(f.t("bonus.lede")) }) });
  }

  const topSeat = L.seats[0];
  const overlap = L.seats.reduce((s: number, x: any) => s + x.seconds, 0) - L.total_seconds;
  const lede = topSeat ? [pair(f.t("seats.lede_total", { total: f.hm(L.total_seconds), computers: f.plural(L.seats.length, "count.computers"),
    clusters: f.plural(Object.keys(L.clusters).length, "count.clusters") }),
  f.t("seats.lede_top", { seat: topSeat.host, hours: f.nb(topSeat.hours, "h"), sessions: f.plural(topSeat.sessions, "count.sessions") })),
  esc(f.t("seats.lede_sum")), ...(overlap >= 60 ? [`<b>${esc(f.t("common.exception"))}</b> ${esc(f.t("seats.lede_overlap", { overlap: f.hm(overlap) }))}`] : [])].join("<br>") : esc(f.t("empty.sessions"));
  const info_ = new Map<string, any>(L.seats.map((s: any) => [s.host, s]));
  const hm = (sec: number) => { const m = Math.floor(sec / 60); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")} h`; };
  const [plan, sc] = seatPlan(f, layout, Object.fromEntries(L.seats.map((s: any) => [s.host, s.seconds])), { unit: "h", toUnit: (v) => v / 3600, anchor: true,
    detail: (h) => { const s = info_.get(h); return [`${h} · ${hm(s.seconds)}`, f.plural(s.sessions, "count.sessions"), f.t("plan.first", { date: f.day(s.first) }), f.t("plan.last", { date: f.day(s.last) })].join("\n"); } });
  const seatLink = (s: any) => `<a class="code" href="#seat-${esc(s.host)}" title="${esc(f.t("computers.show_on_plan", { seat: s.host }))}">${esc(s.host)}</a>`;
  const keys = Object.keys(L.monthly || {});
  let daily = false, labels: string[] = [], values: number[] = [];
  if (keys.length) {
    const months: string[] = [];
    let [y, mo] = keys[0].split("-").map(Number);
    while (`${y}-${String(mo).padStart(2, "0")}` <= keys[keys.length - 1]) {
      months.push(`${y}-${String(mo).padStart(2, "0")}`);
      [y, mo] = mo === 12 ? [y + 1, 1] : [y, mo + 1];
    }
    daily = months.length <= 2;
    labels = daily ? L.days.map((d: string) => `${+d.slice(8)} ${f.months[+d.slice(5, 7) - 1]}`) : months.map((m) => f.monthLabel(m));
    values = daily ? L.hours : months.map((m) => L.monthly[m] || 0);
  }
  const peakAt = values.length && Math.max(...values) > 0 ? values.indexOf(Math.max(...values)) : -1;
  out.push({ id: "seats", nav: f.t("nav.seats"), html: section("seats", f.t("seats.title"), cols(
    `<div class="block" data-panel="seat-plan">${plan}${sc}</div>`,
    `<div class="block" data-panel="hours-month"><div class="block-head"><h3>${esc(f.t(daily ? "seats.day_title" : "seats.month_title"))}</h3>`
    + (peakAt >= 0 ? `<span class="head-figure">${esc(f.t("seats.peak", { v: f.num(values[peakAt], 1), label: labels[peakAt] }))}</span>` : "") + "</div>"
    + vbars(f, labels, [[f.t("unit.hours"), values, S1]], { label: f.t("seats.month_aria"), fmt: (v) => f.num(v, 1), emptyText: f.t("empty.sessions") }) + "</div>"), { count: f.plural(L.seats.length, "count.computers"), lede }) });

  const busiest = L.days.length ? L.days.map((d: string, i: number) => [d, L.hours[i]] as [string, number]).reduce((a: any, b: any) => (b[1] > a[1] ? b : a)) : null;
  const [cal, calScale] = calendar(f, L.days, L.hours);
  out.push({ id: "days", nav: f.t("nav.days"), html: section("days", f.t("days.title"), cols(
    block("calendar", `<div class="cal-scroll">${cal}</div>${calScale}`, f.t("days.calendar_title")),
    block("heat-presence", `<div class="heat-wide">${heat(f, L.heat, ACCENT, "h")}</div>`, f.t("days.heat_title"))),
  { lede: L.days_present && busiest ? [pair(f.t("days.l_span", { days: f.plural(L.days_present, "count.days"), first: f.day(L.first_day), last: f.day(L.last_day) }),
    f.t("days.l_avg", { avg: f.hm(L.total_seconds / L.days_present) })), pair(f.t("days.l_longest", { longest: f.nb(L.longest_session_h, "h") }),
    f.t("days.l_busiest", { busiest: f.day(busiest[0], true), busiest_h: f.nb(busiest[1], "h") }))].join("<br>") : esc(f.t("empty.sessions")) }) });

  const sq = pg.q("sq", "").slice(0, 80);
  const log = L.log.filter((s: any) => !sq || `${s.begin} ${s.end} ${s.host}`.toLowerCase().includes(sq.toLowerCase()));
  out.push({ id: "sessions", nav: f.t("nav.sessions"), html: section("sessions", f.t("sessions.title"),
    filters("sessions", search("sq", sq, f.t("common.search"), f.t("sessions.search_placeholder")))
    + `<div id="sessions-results"><p class="controls-after"><span class="note">${esc(f.t("sessions.count", { shown: f.num(log.length), total: f.num(L.log.length) }))}</span></p>`
    + cols(block("table-sessions", `<div class="table-wrap">${table(f, [
      { k: "begin_ms", t: f.t("col.logged_in"), s: f.t("abbr.logged_in"), nw: true, f: (s) => esc(s.begin) },
      { k: "seconds", t: f.t("col.duration"), s: f.t("abbr.duration"), num: true, nw: true, f: (s) => f.hm(s.seconds) },
      { k: "host", t: f.t("col.computer"), s: f.t("abbr.computer"), f: seatLink, sv: (s) => seatOrder(s.host) },
      { k: "end", t: f.t("col.logged_out"), s: f.t("abbr.logged_out"), nw: true, hide: true, f: (s) => esc(s.end || f.t("sessions.still_logged")) },
    ], log, { label: f.t("sessions.table_aria"), sort: ["begin_ms", -1], empty: f.t(sq ? "empty.search_sessions" : "empty.sessions") })}</div>`)) + "</div>",
  { lede: `${esc(f.t("sessions.lede"))}<br><b>${esc(f.t("common.exception"))}</b> ${esc(f.t("sessions.lede_overlap"))}` }) });

  out.push(where(pg));

  const campuses = D.campuses || [];
  if (campuses.length) out.push({ id: "campuses", nav: f.t("foot.campuses"), html: section("campuses", f.t("foot.campuses"), cols(block("campuses", `<ul class="list">${campuses.map((c: any) => {
    const time = c.sessions ? f.t("foot.time", { hours: f.num(c.hours, 1), sessions: f.num(c.sessions) }) : f.t("foot.no_sessions");
    return `<li><span><b>${esc(c.name || "?")}</b>${c.city ? ` <span class="note">${esc(c.city)}</span>` : ""}<br><span class="note">${esc(`${f.t("foot.joined", { when: f.day(c.joined) })} · ${time}`)}</span></span>`
      + (c.first ? `<span class="when">${esc(f.t("foot.span", { first: f.day(c.first), last: f.day(c.last) }))}</span>` : "") + "</li>";
  }).join("")}</ul>`))) });
  return out;
}

/** c1r2s3 sorts before c1r10s1: cluster, row and seat as numbers; other hosts after, by name. */
const seatOrder = (h: string) => {
  const m = /^c(\d+)r(\d+)s(\d+)$/.exec(h || "");
  return m ? +m[1] * 1e6 + +m[2] * 1e3 + +m[3] : 9e9;
};

const capital = (s: string) => s.slice(0, 1).toUpperCase() + s.slice(1);

/** The seat plan of "Where · evaluations": off, its code kept. */
const WHERE_PLAN = false;

function where(pg: Page): Section {
  const f = pg.f, D = pg.D, PL = D.place, S = D.summary, layout = pg.v.layout || {};
  // one set of evaluations at a time: the ones you received or the ones you gave; in each, where you were and, for the
  // last SeatDays days only, where the other side was
  const role = pg.q("where", "received", ["received", "given"]);
  const recv = role === "received";
  const checked = (recv ? D.received : D.given).filter((e: any) => e.other_host_checked);
  const theirs: (string | null)[] = recv ? checked.map((e: any) => e.other_host) : checked.flatMap((e: any) => e.correcteds.map((c: any) => c.host));
  const clus = (h: string | null) => (h && h.startsWith("c") && h.includes("r") ? h.split("r")[0] : h || "not logged");
  const count = (xs: (string | null)[]) => { const o: Record<string, number> = {}; for (const x of xs) o[clus(x)] = (o[clus(x)] || 0) + 1; return o; };
  const series: [string, Record<string, number>, string][] = [[f.t("where.s_you"), recv ? PL.received_my_cluster : PL.given_my_cluster, S1]];
  if (pg.seats && checked.length) series.push([f.t(recv ? "where.s_corrector" : "where.s_evaluated"), count(theirs), S2]);
  const ckeys = [...new Set(series.flatMap(([, v]) => Object.keys(v)))].sort((a, b) => Number(a === "not logged") - Number(b === "not logged") || a.localeCompare(b));
  const lab = (k: string) => (k === "not logged" ? f.t("log.not_logged") : k);
  // group evaluations happen at the leader's computer: how many of the received ones you led
  const led = D.projects.flatMap((p: any) => p.attempts).filter((a: any) => a.leader && (a.members || []).length).reduce((n: number, a: any) => n + (a.evals || []).length, 0);
  const tips = ckeys.map((k) => [lab(k), ...series.map(([n, v]) => `${n}: ${f.num(v[k] || 0)}`),
    ...(k === "not logged" && recv ? [f.plural(led, "where.leader")] : [])].join("\n"));
  // the seat plan of evaluations is kept but not drawn (WHERE_PLAN): the cluster chart says it more plainly
  const shown: Record<string, number> = {};
  for (const h of theirs) if (h) shown[h] = (shown[h] || 0) + 1;
  const [wplan, wscale] = WHERE_PLAN ? seatPlan(f, layout, shown, { unit: f.t("unit.evals"), detail: (h, v) => `${h}\n${f.plural(v, "count.evaluations")}` }) : ["", ""];
  const total = recv ? S.received : S.given;
  const lede = [f.t("where.cov_me", { me: recv ? PL.me_located_received : PL.me_located_given, n: total }),
    !pg.seats ? f.t("where.cov_light") : checked.length || (recv ? PL.corrector_checked : PL.evaluated_checked)
      ? f.t("where.cov_other", { x: recv ? PL.corrector_located : PL.evaluated_located, y: recv ? PL.corrector_checked : PL.evaluated_checked })
      : f.t("where.cov_none")].map(esc).join("<br>") + (pg.seats ? ` <b>${esc(f.t("where.cov_window", { days: pg.seats }))}</b>` : "");
  const sw = pg.seg("where", [["received", f.t("where.role_received")], ["given", f.t("where.role_given")]], role, f.t("where.role_label"), "where");
  return { id: "where", nav: f.t("nav.where"), html: section("where", "", cols(
    ...(WHERE_PLAN ? [`<div class="block" data-panel="where-plan" id="where-plan">${wplan}${wscale}</div>`] : []),
    `<div class="block" data-panel="where-clusters" id="where-clusters"><h3>${esc(f.t(`where.title_${role}`))}</h3><p class="note">${[f.t(`where.note_${role}`), ...(recv ? [f.t("where.note_not_logged")] : []), ...(series.length > 1 ? [f.t(`where.note_other_${role}`)] : [])].map((l) => `· ${esc(l)}`).join("<br>")}</p>`
    + vbars(f, ckeys.map(lab), series.map(([n, v, c]) => [n, ckeys.map((k) => v[k] || 0), c]), { label: f.t(`where.title_${role}`), fmt: (v) => f.num(v), tips, barTips: true, emptyText: f.t("empty.period") })
    + legend(series.map(([n, , c]) => [n, c])) + "</div>"),
  { head: `<div class="panel-head"><h2>${esc(f.t("where.title"))} ${info(f.t("where.inferred_note"))}</h2>${sw}</div>`, lede }) };
}
