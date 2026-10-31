// Campus: your rhythm, the seat plan with every computer, the days, every session and where evaluations happen (your
// campuses are on Profile).
import { S1, S2, legend, vbars } from "../lib/charts";
import { ACCENT, calendar, heat, seatPlan } from "../lib/graphs";
import { esc } from "../lib/h";
import { table } from "../lib/table";
import { Page, Section, block, cols, daysTo, filters, headBlock, info, kpis, monthsBetween, search, section } from "./page";

/** Two facts on one line of a description, split by a light rule. */
const pair = (a: string, b: string) => `${esc(a)}<span class="sep" aria-hidden="true"> | </span>${esc(b)}`;

export function campus(pg: Page): Section[] {
  const f = pg.f, D = pg.D, L = D.logtime, layout = pg.v.layout || {}, dv = pg.v.derive || {};
  const out: Section[] = [];

  // rhythm (Home held it in v1)
  const [weeks, span] = dv.active_weeks || [0, 0];
  // the day hour by hour (every weekday added up) in four parts of six hours, each in its own shade
  const byHour = Array.from({ length: 24 }, (_, h) => (L.heat || []).reduce((s: number, row: number[]) => s + (row[h] || 0), 0));
  const peak = Math.max(...byHour) || 1, total = byHour.reduce((a, b) => a + b, 0);
  const PARTS = ["early", "morning", "afternoon", "night"] as const; // 0–6, 6–12, 12–18, 18–24
  const partOf = (h: number) => PARTS[Math.floor(h / 6)];
  const parts = PARTS.map((k, i) => [k, total ? Math.round((100 * byHour.slice(6 * i, 6 * i + 6).reduce((a, b) => a + b, 0)) / total) : 0] as [string, number]);
  const any = total > 0;
  const topPart = parts.reduce((a, b) => (b[1] > a[1] ? b : a))[0];
  const day = `<span class="day24" role="img" aria-label="${esc(f.t("rhythm.k_time"))}">${byHour.map((v, h) => {
    const tip = `${h}–${h + 1} h · ${f.nb(v, "h")}`;
    return `<i class="${partOf(h)}" style="height:${((100 * v) / peak).toFixed(1)}%" data-tip="${esc(tip)}" title="${esc(tip)}"></i>`;
  }).join("")}</span><span class="day24-axis" aria-hidden="true">${[0, 6, 12, 18, 24].map((h) => `<b style="left:${(h / 24) * 100}%">${h}</b>`).join("")}</span>`;
  out.push({ id: "rhythm", nav: f.t("rhythm.title"), html: section("rhythm", f.t("rhythm.title"), cols(block("kpis", kpis([
    [f.t("rhythm.k_streak"), f.num(dv.streak), [esc(f.t("rhythm.s_streak"))]],
    [f.t("rhythm.k_weeks"), f.num(weeks), [esc(f.t("rhythm.s_weeks", { total: f.num(span) }))]],
    [f.t("rhythm.k_time"), any ? esc(capital(f.t(`rhythm.${topPart}`))) : "–", any ? [day,
      `<span class="parts">${parts.map(([k, v]) => `<span class="part"><i class="${k}"></i>${esc(f.t("rhythm.s_share", { pct: v, part: f.t(`rhythm.${k}`) }))}</span>`).join("")}</span>`] : [], "wide"],
  ])))) });

  const topSeat = L.seats[0];
  const overlap = L.seats.reduce((s: number, x: any) => s + x.seconds, 0) - L.total_seconds;
  const lede = topSeat ? pair(f.t("seats.lede_total", { total: f.hm(L.total_seconds), computers: f.plural(L.seats.length, "count.computers"),
    clusters: f.plural(Object.keys(L.clusters).length, "count.clusters") }),
  f.t("seats.lede_top", { seat: topSeat.host, hours: f.nb(topSeat.hours, "h"), sessions: f.plural(topSeat.sessions, "count.sessions") })) : esc(f.t("empty.sessions"));
  const seatsHead = `<h2>${esc(f.t("seats.title"))}`
    + (overlap >= 60 ? ` ${info(capital(f.t("seats.lede_overlap", { overlap: f.hm(overlap) })))}` : "") + "</h2>";
  const info_ = new Map<string, any>(L.seats.map((s: any) => [s.host, s]));
  const hm = (sec: number) => { const m = Math.floor(sec / 60); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")} h`; };
  const [plan] = seatPlan(f, layout, Object.fromEntries(L.seats.map((s: any) => [s.host, s.seconds])), { unit: "h", toUnit: (v) => v / 3600, anchor: true,
    detail: (h) => { const s = info_.get(h); return [`${h} · ${hm(s.seconds)}`, f.plural(s.sessions, "count.sessions"), f.t("plan.first", { date: f.day(s.first) }), f.t("plan.last", { date: f.day(s.last) })].join("\n"); } });
  const seatLink = (s: any) => `<a class="code" href="#seat-${esc(s.host)}" title="${esc(f.t("computers.show_on_plan", { seat: s.host }))}">${esc(s.host)}</a>`;
  // every day and month up to the report's day, the quiet ones as zero
  const [days, hours] = daysTo(L.days, L.hours, pg.asOf);
  const keys = Object.keys(L.monthly || {}).sort();
  let daily = false, labels: string[] = [], values: number[] = [];
  if (keys.length) {
    const end = keys[keys.length - 1] > pg.asOf.slice(0, 7) ? keys[keys.length - 1] : pg.asOf.slice(0, 7);
    const months = monthsBetween(keys[0], end);
    daily = months.length <= 2;
    labels = daily ? days.map((d: string) => `${+d.slice(8)} ${f.months[+d.slice(5, 7) - 1]}`) : months.map((m) => f.monthLabel(m));
    values = daily ? hours : months.map((m) => L.monthly[m] || 0);
  }
  const peakAt = values.length && Math.max(...values) > 0 ? values.indexOf(Math.max(...values)) : -1;
  out.push({ id: "seats", nav: f.t("nav.seats"), html: section("seats", f.t("seats.title"), cols(
    `<div class="block" data-panel="seat-plan">${plan}</div>`), { head: seatsHead, lede }) });

  // every day, then the hours per month beside the week hour by hour
  const cal = calendar(f, days, hours), hgrid = heat(f, L.heat, ACCENT, "h");
  out.push({ id: "days", nav: f.t("nav.days"), html: section("days", f.t("days.title"), cols(
    block("calendar", `<div class="cal-scroll">${cal}</div>`, f.t("days.calendar_title")),
    `<div class="block" data-panel="hours-month"><div class="block-head"><h3>${esc(f.t(daily ? "seats.day_title" : "seats.month_title"))}</h3>`
    + (peakAt >= 0 ? `<span class="head-figure">${esc(f.t("seats.peak", { v: f.num(values[peakAt], 1), label: labels[peakAt] }))}</span>` : "") + "</div>"
    + vbars(f, labels, [[f.t("unit.hours"), values, S1]], { label: f.t("seats.month_aria"), fmt: (v) => f.num(v, 1), emptyText: f.t("empty.sessions") }) + "</div>",
    block("heat-presence", `<div class="heat-wide">${hgrid}</div>`, f.t("days.heat_title"))),
  { lede: L.days_present ? pair(f.t("days.l_span", { days: f.plural(L.days_present, "count.days"), first: f.day(L.first_day), last: f.day(L.last_day) }),
    f.t("days.l_avg", { avg: f.hm(L.total_seconds / L.days_present) })) : esc(f.t("empty.sessions")) }) });

  const sq = pg.q("sq", "").slice(0, 80);
  const log = L.log.filter((s: any) => !sq || `${s.begin} ${s.end} ${s.host} ${f.dayTime(s.begin)} ${f.dayTime(s.end)}`.toLowerCase().includes(sq.toLowerCase()));
  out.push({ id: "sessions", nav: f.t("nav.sessions"), html: section("sessions", f.t("sessions.title"),
    filters("sessions", search("sq", sq, f.t("common.search"), f.t("sessions.search_placeholder")))
    + `<div id="sessions-results"><p class="controls-after"><span class="note">${esc(f.t("sessions.count", { shown: f.num(log.length), total: f.num(L.log.length) }))}</span></p>`
    + cols(block("table-sessions", `<div class="table-wrap">${table(f, [
      { k: "begin_ms", t: f.t("col.logged_in"), s: f.t("abbr.logged_in"), nw: true, f: (s) => esc(f.dayTime(s.begin)) },
      { k: "seconds", t: f.t("col.duration"), s: f.t("abbr.duration"), num: true, nw: true, f: (s) => f.hm(s.seconds) },
      { k: "host", t: f.t("col.computer"), s: f.t("abbr.computer"), f: seatLink, sv: (s) => seatOrder(s.host) },
      { k: "end", t: f.t("col.logged_out"), s: f.t("abbr.logged_out"), nw: true, hide: true, f: (s) => esc(s.end ? f.dayTime(s.end) : f.t("sessions.still_logged")) },
    ], log, { label: f.t("sessions.table_aria"), sort: ["begin_ms", -1], empty: f.t(sq ? "empty.search_sessions" : "empty.sessions") })}</div>`)) + "</div>") });

  out.push(where(pg));
  return out;
}

/** Your campuses: when you joined each and your time there (shown on Profile). */
export function campuses(pg: Page): Section[] {
  const f = pg.f, list = pg.D.campuses || [];
  if (!list.length) return [];
  return [{ id: "campuses", nav: f.t("foot.campuses"), html: section("campuses", f.t("foot.campuses"), cols(block("campuses", `<ul class="list">${list.map((c: any) => {
    const time = c.sessions ? f.t("foot.time", { hours: f.num(c.hours, 1), sessions: f.num(c.sessions) }) : f.t("foot.no_sessions");
    return `<li><span><b>${esc(c.name || "?")}</b>${c.city ? ` <span class="note">${esc(c.city)}</span>` : ""}<br><span class="note">${esc(`${f.t("foot.joined", { when: f.day(c.joined) })} · ${time}`)}</span></span>`
      + (c.first ? `<span class="when">${esc(f.t("foot.span", { first: f.day(c.first), last: f.day(c.last) }))}</span>` : "") + "</li>";
  }).join("")}</ul>`))) }];
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
    ...(k === "not logged" && recv ? [f.t("where.note_not_logged"), f.plural(led, "where.leader")] : [])].join("\n"));
  // the seat plan of evaluations is kept but not drawn (WHERE_PLAN): the cluster chart says it more plainly
  const shown: Record<string, number> = {};
  for (const h of theirs) if (h) shown[h] = (shown[h] || 0) + 1;
  const [wplan, wscale] = WHERE_PLAN ? seatPlan(f, layout, shown, { unit: f.t("unit.evals"), detail: (h, v) => `${h}\n${f.plural(v, "count.evaluations")}` }) : ["", ""];
  const total = recv ? S.received : S.given;
  const lede = pair(f.t("where.cov_me", { me: recv ? PL.me_located_received : PL.me_located_given, n: total }),
    !pg.seats ? f.t("where.cov_light") : checked.length || (recv ? PL.corrector_checked : PL.evaluated_checked)
      ? f.t("where.cov_other", { x: recv ? PL.corrector_located : PL.evaluated_located, y: recv ? PL.corrector_checked : PL.evaluated_checked })
      : f.t("where.cov_none")) + (pg.seats ? ` <b>${esc(f.t("where.cov_window", { days: pg.seats }))}</b>` : "");
  const sw = pg.seg("where", [["received", f.t("where.role_received")], ["given", f.t("where.role_given")]], role, f.t("where.role_label"), "where");
  return { id: "where", nav: f.t("nav.where"), html: section("where", "", cols(
    ...(WHERE_PLAN ? [`<div class="block" data-panel="where-plan" id="where-plan"><div class="block-head">${wscale}</div>${wplan}</div>`] : []),
    headBlock("where-clusters", f.t(`where.title_${role}`), series.length > 1 ? legend(series.map(([n, , c]) => [n, c])) : "",
      vbars(f, ckeys.map(lab), series.map(([n, v, c]) => [n, ckeys.map((k) => v[k] || 0), c]), { label: f.t(`where.title_${role}`), fmt: (v) => f.num(v), tips, barTips: true, emptyText: f.t("empty.period") }))),
  { head: `<div class="panel-head"><h2>${esc(f.t("where.title"))} ${info(f.t("where.inferred_note"))}</h2>${sw}</div>`, lede }) };
}
