// Today, on Profile: what changes day to day. The logtime bonus first, then where you are, what comes next, what is open
// and this month. Built from /api/me/today (computed at request time from the stored report).
import type { Fmt } from "../fmt";
import { madridParts } from "../fmt";
import { esc } from "../lib/h";
import type { Section } from "./page";

export type Tier = { hours: number; points: number; window_h: number; need_h: number; last: string | null; from: string | null; state: string; until: string | null };
export type Today = {
  as_of: string; bonus: Tier[]; window_h: number; drops: { at: string; hours: number; session_begin: string }[];
  now: { host: string | null; since: string } | null; today_s: number; yesterday_s: number; yesterday_seats: number;
  week: { date: string; seconds: number; parts: { from: number; to: number; host: string | null; leaving: boolean }[] }[];
  next: { at: string; project: string; role: string; more_this_week: number } | null;
  in_progress: { name: string; day: number; registered: string; attempt: number }[]; points: number; blackhole_days: number | null;
  month: { month: string; xp: number; validated: number; evaluations: number; coalition_points: number };
};

const ms = (iso: string) => new Date(iso).getTime();

/** "Thu 30 Oct, 09:00" (Madrid), always the same shape. */
function moment(f: Fmt, iso: string) {
  const p = madridParts(ms(iso));
  const wd = f.weekdays[(new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay() + 6) % 7];
  return `${wd} ${p.d} ${f.months[p.m - 1]}, ${p.hh}:${p.mm}`;
}

function panel(key: string, label: string, body: string, o: { live?: boolean; span?: number; aside?: string } = {}) {
  return `<article class="tp${o.live ? " live" : ""}${o.span ? ` span-${o.span}` : ""}" data-today="${key}">`
    + `<h2 class="tab">${esc(label)}${o.aside ? `<span>${esc(o.aside)}</span>` : ""}</h2>${body}</article>`;
}

function bonus(f: Fmt, td: Today) {
  const [t50, t80] = td.bonus;
  if (!t50) return panel("bonus", f.t("today.bonus"), `<p class="line">${esc(f.t("today.bonus_none"))}</p>`, { span: 2 });
  const max = 80, w = td.window_h;
  const meter = `<div class="tmeter" role="img" aria-label="${esc(f.t("coal.s_meter", { have: f.num(w, 1), need: max }))}">`
    + `<i style="width:${Math.min(100, (100 * w) / max).toFixed(1)}%"></i><em style="left:62.5%"></em><em class="end"></em></div>`
    + `<div class="tticks" aria-hidden="true"><span style="left:0">0</span><span style="left:62.5%">50 h</span><span class="end">80 h</span></div>`;
  const tier = (t: Tier) => {
    let state: string;
    if (t.state === "cooldown") state = f.t("today.tier_again", { time: moment(f, t.from!) });
    else if (t.state === "ready") state = f.t("today.tier_ready");
    else state = t.until ? f.t("today.tier_short", { n: f.num(t.need_h, 1), time: moment(f, t.until) }) : f.t("today.tier_short_no", { n: f.num(t.need_h, 1) });
    const got = t.state === "cooldown" ? ` ${f.t("today.tier_got")}` : "";
    return `<div class="tier ${t.state}"><b>${esc(f.t("today.tier", { hours: t.hours, points: f.num(t.points) }))}${esc(got)}</b><p>${esc(state)}</p></div>`;
  };
  const drops = td.drops.slice(0, 3).map((d) => `<li><span>${esc(f.t("today.drop", { time: moment(f, d.at), day: moment(f, d.session_begin).split(",")[0] }))}</span><b>−${esc(f.num(d.hours, 1))} h</b></li>`).join("");
  return panel("bonus", f.t("today.bonus"), `<p class="figure">${esc(f.num(w, 1))}<small> h</small></p>${meter}`
    + `<div class="tiers">${tier(t50)}${t80 ? tier(t80) : ""}</div>`
    + (drops ? `<h3 class="sub-h">${esc(f.t("today.drops"))}</h3><ul class="drops">${drops}</ul>` : `<p class="line">${esc(f.t("today.no_drops"))}</p>`)
    + `<p class="line note"><a href="/app/coalition#bonus">${esc(f.t("today.bonus_more"))}</a></p>`, { live: true, span: 2, aside: f.t("today.bonus_aside") });
}

function nowPanel(f: Fmt, td: Today) {
  const lines: string[] = [];
  let figure: string;
  if (td.now) {
    figure = `<p class="figure host">${esc(td.now.host || "–")}</p>`;
    lines.push(f.t("today.since", { time: f.clock(ms(td.now.since)) }));
  } else {
    figure = `<p class="figure">${esc(f.t("today.not_in"))}</p>`;
  }
  lines.push(f.t("today.today_h", { time: f.hm(td.today_s) }));
  lines.push(td.yesterday_s ? f.t("today.yesterday", { time: f.hm(td.yesterday_s), seats: f.plural(td.yesterday_seats, "today.seats") }) : f.t("today.yesterday_none"));
  if (td.as_of) lines.push(f.t("today.now_as_of", { time: td.as_of.slice(11, 16) }));
  return panel("now", f.t("today.now"), figure + lines.map((l) => `<p class="line">${esc(l)}</p>`).join(""), { live: !!td.now });
}

function next(f: Fmt, td: Today) {
  const points = `<p class="line">${esc(f.plural(td.points, "today.points"))}</p>`;
  if (!td.next) return panel("next", f.t("today.next"), `<p class="figure">${esc(f.num(td.points))}<small> ${esc(f.t("today.points_short"))}</small></p>`
    + `<p class="line">${esc(f.t("today.next_none"))}</p>`);
  const n = td.next;
  return panel("next", f.t("today.next"), `<p class="figure">${esc(f.clock(ms(n.at)))}</p>` + points
    + `<p class="line">${esc(f.t(n.role === "corrector" ? "today.next_corrector" : "today.next_corrected", { project: n.project || "?", when: moment(f, n.at) }))}</p>`
    + (n.more_this_week ? `<p class="line">${esc(f.plural(n.more_this_week, "today.next_more"))}</p>` : ""), { live: true });
}

function progress(f: Fmt, td: Today) {
  const bh = td.blackhole_days !== null && td.blackhole_days !== undefined ? `<p class="line">${esc(f.plural(td.blackhole_days, "today.blackhole"))}</p>` : "";
  if (!td.in_progress.length) return panel("progress", f.t("today.progress"), `<p class="figure">–</p><p class="line">${esc(f.t("today.progress_none"))}</p>` + bh);
  const [first, ...rest] = td.in_progress;
  return panel("progress", f.t("today.progress"), `<p class="figure name">${esc(first.name)}</p>`
    + `<p class="line">${esc(f.t("today.progress_day", { n: f.num(first.day), attempt: first.attempt }))}</p>`
    + rest.slice(0, 2).map((p) => `<p class="line">${esc(`${p.name} · ${f.t("today.progress_day", { n: f.num(p.day), attempt: p.attempt })}`)}</p>`).join("") + bh
    + `<p class="line note"><a href="/app/projects#projects-table">${esc(f.t("today.progress_more"))}</a></p>`);
}

function month(f: Fmt, td: Today) {
  const m = td.month;
  return panel("month", f.t("today.month"), `<p class="figure">+${esc(f.num(m.xp))}<small> XP</small></p>`
    + `<p class="line">${esc(f.t("today.month_line", { validated: f.plural(m.validated, "today.validated"), evals: f.plural(m.evaluations, "count.evaluations") }))}</p>`
    + `<p class="line">${esc(f.t("today.month_coal", { n: f.num(m.coalition_points) }))}</p>`, { aside: `${f.months[+m.month.slice(5, 7) - 1]} ${m.month.slice(0, 4)}` });
}

export function home(f: Fmt, td: Today): Section[] {
  const date = f.day(madridParts(Date.now()).iso, true).split(" ").slice(0, 3).join(" ");
  return [{ id: "today", nav: f.t("today.title"), html: `<section id="today" class="today-wrap"><h2>${esc(f.t("today.head", { date }))}</h2>`
    + `<div class="today">${bonus(f, td)}${nowPanel(f, td)}${next(f, td)}${progress(f, td)}${month(f, td)}</div></section>` }];
}
