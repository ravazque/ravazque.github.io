// The logtime bonus on Coalition (and as a widget on Profile): the rolling week against 50h and 80h, one row per bonus
// with its state and its reset, and the days the coming hours leave on, each opening to the times and sessions.
import type { Fmt } from "../fmt";
import { madridParts } from "../fmt";
import { esc } from "../lib/h";
import { info } from "./page";

export type Tier = { hours: number; points: number; window_h: number; need_h: number; last: string | null; from: string | null; state: string; until: string | null };
export type Drop = { at: string; hours: number };

const ms = (iso: string) => new Date(iso).getTime();
const HOUR = 36e5, WEEK = 7 * 24 * HOUR, STEP = HOUR / 10;
const tidy = (hours: number) => Math.round(hours * 100) / 100;

/** "Thu 30 Oct, 09:00" (Madrid), always the same shape. */
export function moment(f: Fmt, iso: string) {
  const p = madridParts(ms(iso));
  const wd = f.weekdays[(new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay() + 6) % 7];
  return `${wd} ${p.d} ${f.months[p.m - 1]}, ${p.hh}:${p.mm}`;
}

export type DropRow = { from: string; to: string; hours: number; session: string };
export type DropDay = { day: string; hours: number; left: number; rows: DropRow[] };
type LogRow = { begin_ms: number; seconds: number; host?: string | null };

/** The hours leaving the window, day by day (a session leaves as slowly as it was made, so a long one spans days): how
 * many, what stays at the end of the day with none added, and what leaves when (each hour left a week after it was made).
 * The drops are the whole week, so the last day leaves nothing. */
export function dropDays(f: Fmt, drops: Drop[], log: LogRow[] = []): DropDay[] {
  const hhmm = (t: number) => { const p = madridParts(t); return `${p.hh}:${p.mm}`; };
  const dayOf = (t: number) => moment(f, new Date(t).toISOString()).split(",")[0];
  const days = new Map<string, DropRow[]>();
  for (const d of drops) {
    const end = ms(d.at) + d.hours * HOUR;
    let row: DropRow | null = null, rowDay = "";
    for (let t = ms(d.at); t < end; t += STEP) {
      const day = dayOf(t), stop = Math.min(t + STEP, end);
      if (!row || day !== rowDay) {
        const made = t - WEEK, host = log.find((l) => l.begin_ms <= made && made < l.begin_ms + l.seconds * 1000)?.host;
        row = { from: hhmm(t), to: "", hours: 0, session: dayOf(made) + (host ? ` · ${host}` : "") };
        rowDay = day;
        days.set(day, [...(days.get(day) || []), row]);
      }
      row.hours += (stop - t) / HOUR;
      row.to = hhmm(stop);
    }
  }
  let left = drops.reduce((sum, d) => sum + d.hours, 0);
  return [...days].map(([day, rows]) => {
    const hours = rows.reduce((sum, r) => sum + r.hours, 0);
    left -= hours;
    return { day, hours: tidy(hours), left: Math.max(0, tidy(left)), rows: rows.map((r) => ({ ...r, hours: tidy(r.hours) })) };
  });
}

/** When the week drops under a line with none added; null when it is under already or never gets there. */
export function underAt(week: number, drops: Drop[], line: number): number | null {
  if (week < line) return null;
  let left = week;
  for (const d of [...drops].sort((a, b) => ms(a.at) - ms(b.at))) {
    if (left - d.hours < line) return ms(d.at) + (left - line) * HOUR;
    left -= d.hours;
  }
  return null;
}

export const weekFigure = (f: Fmt, week: number) => `<p class="figure">${esc(f.num(week, 1))}<small> h</small></p>`;

/** The rule from nothing to 80h with the week on it. */
export function rule(f: Fmt, week: number) {
  const top = 80;
  return `<div class="tmeter" role="img" aria-label="${esc(f.t("coal.s_meter", { have: f.num(week, 1), need: top }))}">`
    + `<i style="width:${Math.min(100, (100 * week) / top).toFixed(1)}%"></i><em style="left:62.5%"></em><em class="end"></em></div>`
    + `<div class="tticks" aria-hidden="true"><span style="left:0">0h</span><span style="left:62.5%">50h</span><span class="end">80h</span></div>`;
}

/** One row per bonus: its state, and the one date that matters in that state. */
export function tierRows(f: Fmt, tiers: Tier[], open: boolean, week: number, drops: Drop[], now = Date.now()) {
  return `<div class="tiers">${tiers.map((t) => {
    const soonest = t.until && t.until !== t.from ? f.t(open ? "bonus.earliest" : "bonus.earliest_out", { time: moment(f, t.until) }) : "";
    let state: string, lines: string[];
    if (t.state === "cooldown") {
      state = `${f.t("bonus.tier_got")} ${f.t("coal.v_cooldown")}`;
      lines = [f.t("bonus.resets", { time: moment(f, t.from!), left: f.left(ms(t.from!) - now) }), soonest];
    } else if (t.state === "ready") {
      const by = underAt(week, drops, t.hours);
      state = f.t("coal.v_ready");
      lines = [open ? f.t("coal.s_next_logout") : by ? f.t("bonus.due_by", { time: moment(f, new Date(by).toISOString()) }) : f.t("coal.s_ready_out", { hours: t.hours })];
    } else {
      state = f.t("bonus.to_go", { n: f.num(t.need_h, 1) });
      lines = [soonest];
    }
    return `<div class="tier ${esc(t.state)}"><b>${esc(f.t("bonus.tier", { hours: t.hours, points: f.num(t.points) }))}</b>`
      + `<div><p class="state">${esc(state)}</p>${lines.filter(Boolean).map((l) => `<p>${esc(l)}</p>`).join("")}</div></div>`;
  }).join("")}</div>`;
}

/** The days the coming hours leave on, one line each, opening to the times and the sessions; and when that takes you
 * under a line. */
export function leaving(f: Fmt, drops: Drop[], week: number, log: LogRow[] = []) {
  const days = dropDays(f, drops, log);
  if (!days.length) return `<p class="line">${esc(f.t("bonus.no_drops"))}</p>`;
  const list = days.map((d) => `<details class="drop-day"><summary><span>${esc(d.day)}</span><b>−${esc(f.nb(d.hours, "h"))}</b>`
    + `<span class="left">${esc(f.t("bonus.left", { n: f.num(d.left, 1) }))}</span></summary><ul>`
    + d.rows.map((r) => `<li><span class="nw">${esc(r.from)}–${esc(r.to)}</span><span>${esc(f.t("bonus.session", { day: r.session }))}</span><b>−${esc(f.nb(r.hours, "h"))}</b></li>`).join("")
    + "</ul></details>").join("");
  const under = [80, 50].flatMap((h) => { const u = underAt(week, drops, h); return u ? [f.t("bonus.under", { hours: h, time: moment(f, new Date(u).toISOString()) })] : []; });
  return `<h3 class="sub-h drops-title">${esc(f.t("bonus.drops"))} ${info(f.t("bonus.drops_note"))}</h3><div class="drop-days">${list}</div>`
    + (under.length ? `<p class="line note">${esc(under.join(" · "))}</p>` : "");
}
