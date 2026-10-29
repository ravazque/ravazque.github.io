// One page's view of the report: the period, the formatter, the query and the shared parts of the stored report.
import type { Fmt } from "../fmt";
import { esc, badge } from "../lib/h";

export type Section = { id: string; nav: string; html: string };
export type Rep = any; // one period's report, as the server stores it (core.Analyze's shape)

export type View = {
  period: string; periods: string[]; default_period: string; light: boolean; seat_days: number | null;
  report: Rep; derive: any; layout: Record<string, { rows: number; seats: number }>; connections: any[]; network: any;
  promo: any; coalitions: any[]; all_projects: any[]; all_cursus?: any[];
};

export const PAGES = ["home", "projects", "evaluations", "people", "campus"] as const;
export type PageKey = (typeof PAGES)[number];
export const PATHS: Record<PageKey, string> = {
  home: "/app", projects: "/app/projects", evaluations: "/app/evaluations", people: "/app/people", campus: "/app/campus",
};
export const KINDS = ["nice", "rigorous", "interested", "punctuality"];

export class Page {
  readonly D: Rep;
  readonly period: string;
  constructor(readonly f: Fmt, readonly v: View, readonly key: PageKey, readonly params: Record<string, string>) {
    this.D = v.report;
    this.period = v.period;
  }

  get light() { return this.v.light === true; }
  get seats() { return this.v.seat_days; }
  get allProjects(): any[] { return this.v.all_projects || this.D.projects; }

  q(name: string, def = "", allowed?: readonly string[]): string {
    const v = this.params[name] ?? def;
    return allowed && !allowed.includes(v) ? def : v;
  }

  /** This page (or another) with the period kept and some parameters changed; "" removes one. */
  url(page?: PageKey, change: Record<string, string> = {}): string {
    const keep: Record<string, string> = !page || page === this.key ? { ...this.params } : {};
    keep.period = this.period;
    Object.assign(keep, change);
    const qs = new URLSearchParams(Object.entries(keep).filter(([, v]) => v !== "" && v !== undefined)).toString();
    return PATHS[page || this.key] + (qs ? `?${qs}` : "");
  }

  /** A segmented switch made of links; the app swaps the page in place and keeps the scroll. */
  seg(name: string, options: [string, string][], current: string, label: string, target: string): string {
    return `<div class="seg" role="group" aria-label="${esc(label)}">` + options.map(([v, t]) =>
      `<a href="${esc(this.url(undefined, { [name]: v }))}#${target}" data-keep role="button" aria-pressed="${v === current}">${esc(t)}</a>`).join("") + "</div>";
  }
}

export const section = (id: string, title: string, body: string, o: { lede?: string; count?: string; head?: string } = {}) =>
  `<section id="${id}">`
  + (o.head ?? `<h2>${esc(title)}${o.count ? `<span class="count"><span class="sep"> · </span>${esc(o.count)}</span>` : ""}</h2>`)
  + (o.lede ? `<p class="lede">${o.lede}</p>` : "") + body + "</section>";

export const block = (panel: string, body: string, title = "", note = "") =>
  `<div class="block" data-panel="${panel}">${title ? `<h3>${esc(title)}</h3>` : ""}${note ? `<p class="note">${esc(note)}</p>` : ""}${body}</div>`;

export const cols = (...blocks: string[]) => `<div class="cols" data-grid>${blocks.join("")}</div>`;

export const info = (text: string) =>
  `<span class="info" tabindex="0" role="note" data-tip="${esc(text)}" title="${esc(text)}" aria-label="${esc(text)}"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7"/><path d="M8 7.2v4.3M8 4.6v.1"/></svg></span>`;

export const kpis = (items: [string, string, string[]][]) =>
  `<div class="kpis">${items.map(([k, v, subs]) => `<div><h3>${esc(k)}</h3><p class="v">${v}</p>${subs.filter(Boolean).map((x) => `<p class="s">${x}</p>`).join("")}</div>`).join("")}</div>`;

export const search = (name: string, value: string, label: string, placeholder: string) =>
  `<label class="field"><span>${esc(label)}</span><input type="search" name="${name}" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off"></label>`;

/** A filter form: the app reads it on input and puts its fields in the address (keep: the other parameters). */
export const filters = (target: string, body: string) => `<form class="controls" data-filter="${target}">${body}</form>`;

export const select = (name: string, label: string, options: [string, string][], current: string) =>
  `<label class="field"><span>${esc(label)}</span><select name="${name}">${options.map(([v, t]) =>
    `<option value="${esc(v)}"${v === current ? " selected" : ""}>${esc(t)}</option>`).join("")}</select></label>`;

export const radios = (name: string, label: string, options: [string, string][], current: string) =>
  `<div class="seg" role="radiogroup" aria-label="${esc(label)}">${options.map(([v, t]) =>
    `<label><input type="radio" name="${name}" value="${esc(v)}"${v === current ? " checked" : ""}><span>${esc(t)}</span></label>`).join("")}</div>`;

export function noMark(f: Fmt, e: any) {
  return e.no_mark ? esc(f.t(`no_mark.${e.no_mark}`)) : "–";
}

export function flagBadge(f: Fmt, e: any) {
  if (e.outstanding) return badge(f.t("flag.outstanding"), "out");
  if (e.negative_flag) return badge(e.flag || "", "bad");
  return e.flag ? badge(e.flag) : "";
}

export const failed = (e: any) => e.negative_flag || (e.mark !== null && e.mark !== undefined && e.mark < 50);

export function myRank(extras: any): string | null {
  const main = (extras?.cursus || []).find((c: any) => c.name === "42cursus");
  if (!main) return null;
  if (main.grade === "Alumni") return "alumni";
  const done = (extras.quests || []).filter((q: any) => q.validated).map((q: any) => q.name as string);
  if (main.grade === "Transcender" || done.includes("Common Core")) return "outer-core";
  const ranks = done.map((n: string) => /^Common Core Rank (\d\d)$/.exec(n)).filter(Boolean).map((m: any) => +m[1]);
  return `rank-${String(ranks.length ? Math.max(...ranks) + 1 : 0).padStart(2, "0")}`;
}

/** An ISO instant (any offset) as epoch milliseconds. */
export const msOf = (iso: string) => new Date(iso).getTime();
