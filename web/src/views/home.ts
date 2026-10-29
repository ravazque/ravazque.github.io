// Home: only what changes day to day. The logtime bonus first, then where you are, your last seven days, what comes
// next, what is open and this month. Built from /api/me/today (computed at request time from the stored report).
import type { Fmt } from "../fmt";
import { madridParts } from "../fmt";
import { badge, esc, initials, safeColor } from "../lib/h";
import { type Page, type Section, myRank } from "./page";

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
    + `<p class="line note"><a href="/app/campus#bonus">${esc(f.t("today.bonus_more"))}</a></p>`, { live: true, span: 2, aside: f.t("today.bonus_aside") });
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

function week(f: Fmt, td: Today) {
  const rows = td.week.map((d) => {
    const label = f.day(d.date, true).split(" ")[0];
    const bars = d.parts.map((p) => {
      const tip = `${f.day(d.date, true)} · ${String(Math.floor(p.from)).padStart(2, "0")}:${String(Math.round((p.from % 1) * 60)).padStart(2, "0")}–`
        + `${String(Math.floor(p.to)).padStart(2, "0")}:${String(Math.round((p.to % 1) * 60)).padStart(2, "0")}${p.host ? ` · ${p.host}` : ""}${p.leaving ? ` · ${f.t("today.leaving")}` : ""}`;
      return `<i class="${p.leaving ? "leaving" : ""}" style="left:${((p.from / 24) * 100).toFixed(2)}%;width:max(3px,${(((p.to - p.from) / 24) * 100).toFixed(2)}%)" data-tip="${esc(tip)}" title="${esc(tip)}"></i>`;
    }).join("");
    return `<div class="wk-row"><span class="wk-day">${esc(label)} <small>${+d.date.slice(8)}</small></span><span class="wk-track">${bars}</span><span class="wk-total">${d.seconds ? esc(f.hm(d.seconds)) : "–"}</span></div>`;
  }).join("");
  const axis = `<div class="wk-row wk-axis" aria-hidden="true"><span></span><span class="wk-track">${[0, 6, 12, 18, 24].map((h) => `<b style="left:${(h / 24) * 100}%">${h}</b>`).join("")}</span><span></span></div>`;
  const total = td.week.reduce((s, d) => s + d.seconds, 0);
  return panel("week", f.t("today.week"), `<div class="wk" role="img" aria-label="${esc(f.t("today.week_aria", { time: f.hm(total) }))}">${rows}${axis}</div>`
    + `<p class="line note">${esc(f.t("today.week_note"))}</p>`, { span: 3, aside: f.hm(total) });
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

/** Who you are on 42 and what the intra keeps on your profile, then where you are now (v1's profile card). */
function profile(pg: Page): string {
  const f = pg.f, D = pg.D, P = D.profile, X = D.extras, dv = pg.v.derive || {};
  const cursus = new Map<string, any>((X.cursus || []).map((c: any) => [c.name, c]));
  const main = cursus.get("42cursus"), piscine = cursus.get("C Piscine");
  const coal = P.coalition, promo = pg.v.promo, rank = myRank(X);
  const month = (s: string) => `${f.months[+s.slice(5, 7) - 1]} ${s.slice(0, 4)}`;
  const facts = ([
    main ? [f.t("home.k_level"), f.num(main.level, 2)] : null,
    promo ? [f.t("standing.promo"), `${f.num(promo.rank)} / ${f.num(promo.size)}`] : null,
    P.wallet !== null && P.wallet !== undefined ? [f.t("head.wallet"), `${f.num(P.wallet)} ₳`] : null,
    P.correction_point !== null && P.correction_point !== undefined ? [f.t("head.points"), f.num(P.correction_point)] : null,
    piscine?.begin ? [f.t("profile.piscine"), month(piscine.begin)] : null,
    main?.begin ? [f.t("profile.kickoff"), f.day(main.begin)] : null,
    dv.alumni_due ? [f.t("profile.alumni"), dv.alumni_due === "paused" ? f.t("profile.paused") : f.day(dv.alumni_due)] : null,
    coal ? [f.t("home.k_coalition"), coal.rank ? `${coal.name} · ${f.t("home.nth", { n: coal.rank })}` : coal.name] : null,
  ].filter(Boolean) as [string, string][]);
  const coalLine = (coal ? `<i class="dot" style="background:${safeColor(coal.color)}"></i>${esc(coal.name)} · ` : "")
    + esc(rank ? f.t(`groups.${rank}`) : f.t("home.no_cursus")) + (main?.grade ? ` ${badge(main.grade)}` : "");
  const now = P.location ? f.t("rail.now_at", { seat: P.location }) : f.t("rail.not_logged");
  return `<section id="profile" aria-label="${esc(f.t("profile.title"))}"><div class="id-card">`
    + `<div class="avatar-lg"><span aria-hidden="true">${esc(initials(P.name || P.login))}</span>${P.image ? `<img src="${esc(P.image)}" alt="">` : ""}</div>`
    + `<div class="id-text"><p class="name">${esc(P.name || P.login)}</p><p>${esc(P.login)}${P.campus_current ? ` · ${esc(P.campus_current)}` : ""}</p>`
    + `<p class="coal">${coalLine}</p>${(P.groups || []).length ? `<p class="groups">${P.groups.map((g: string) => badge(g)).join("")}</p>` : ""}</div>`
    + `<dl class="id-facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>`
    + `<p class="id-now">${esc(now)} · ${esc(f.t("head.generated", { when: D.generated ? `${f.day(D.generated)}, ${D.generated.slice(11, 16)}` : "" }))}</p></div></section>`;
}

/** The last row: your rhythm, your campuses, and your titles and latest achievements. */
function more(pg: Page): string {
  const f = pg.f, D = pg.D, X = D.extras, dv = pg.v.derive || {};
  const [weeks, span] = dv.active_weeks || [0, 0];
  const split = (dv.day_split || {}) as Record<string, number>;
  const part = Object.entries(split).reduce((a, b) => (b[1] > a[1] ? b : a), ["", 0])[0];
  const rhythm = `<p class="figure">${esc(f.num(dv.streak || 0))}<small> ${esc(f.t("home.streak_days"))}</small></p>`
    + `<p class="line">${esc(f.t("home.weeks", { n: f.num(weeks), total: f.num(span) }))}</p>`
    + (part && split[part] ? `<p class="line">${esc(f.t("home.mostly", { pct: split[part], part: f.t(`rhythm.${part}`) }))}</p>` : "")
    + `<p class="line note"><a href="/app/campus#rhythm">${esc(f.t("home.more_rhythm"))}</a></p>`;
  const campuses = (D.campuses || []).map((c: any) => `<li><span><b>${esc(c.name || "?")}</b>${c.city ? ` <span class="note">${esc(c.city)}</span>` : ""}</span>`
    + `<span class="when">${c.sessions ? esc(f.nb(c.hours, "h")) : "–"}</span></li>`).join("") || `<li class="note">${esc(f.t("empty.period"))}</li>`;
  const titles = (X.titles || []).filter((t: any) => t.selected).map((t: any) => `<li><span><b>${esc(t.name)}</b></span><span class="when">${esc(f.t("extras.selected"))}</span></li>`);
  const ach = [...(X.achievements || [])].reverse().slice(0, 4).map((a: any) => `<li><span>${esc(a.name)}</span><span class="when">${esc((a.at || "").slice(0, 10))}</span></li>`);
  const list = [...titles, ...ach].join("") || `<li class="note">${esc(f.t("empty.period"))}</li>`;
  const tp = (key: string, label: string, body: string) =>
    `<article class="tp" data-today="${key}"><h2 class="tab">${esc(label)}</h2>${body}</article>`;
  return `<div class="today">${tp("rhythm", f.t("rhythm.title"), rhythm)}${tp("campuses", f.t("foot.campuses"), `<ul class="list">${campuses}</ul>`)}`
    + tp("titles", f.t("home.titles"), `<ul class="list">${list}</ul><p class="line note"><a href="/app/projects#activity">${esc(f.t("home.more_activity"))}</a></p>`) + "</div>";
}

export function home(f: Fmt, td: Today, pg: Page): Section[] {
  const date = f.day(madridParts(Date.now()).iso, true).split(" ").slice(0, 3).join(" ");
  return [
    { id: "profile", nav: f.t("profile.title"), html: profile(pg) },
    { id: "today", nav: f.t("today.title"), html: `<section id="today" class="today-wrap"><h2>${esc(f.t("today.head", { date }))}</h2>`
      + `<div class="today">${bonus(f, td)}${nowPanel(f, td)}${week(f, td)}${next(f, td)}${progress(f, td)}${month(f, td)}</div>${more(pg)}</section>` },
  ];
}
