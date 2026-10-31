// People: who evaluated you, everyone you crossed paths with, your connections and circle, and your teammates.
import { GOOD, S1, hbars, legend } from "../lib/charts";
import { GROUPS, bubbles, netClass, ring } from "../lib/graphs";
import { avatar, badge, esc } from "../lib/h";
import { table } from "../lib/table";
import { Page, Section, block, cols, deletedName, filters, info, search, section, erased, shownLogin } from "./page";

/** The circle's links with the student's own side rebuilt from their evaluations (contacts' lists only see "→ me"). */
function circleLinks(net: any, me: string, given: any[], received: any[]) {
  const known = new Set((net.nodes || []).map((n: any) => n.login).filter((l: string) => l !== me));
  const links = new Map<string, number>();
  const key = (a: string, b: string) => `${a}\u0000${b}`;
  for (const l of net.links || []) if (l.source !== me && l.target !== me) links.set(key(l.source, l.target), l.count);
  for (const e of given) for (const c of e.correcteds || []) if (known.has(c.login)) links.set(key(me, c.login), (links.get(key(me, c.login)) || 0) + 1);
  for (const e of received) {
    const login = e.corrector?.login;
    if (known.has(login)) links.set(key(login, me), (links.get(key(login, me)) || 0) + 1);
  }
  const linked = new Set([me, ...[...links.keys()].flatMap((k) => k.split("\u0000"))]);
  return { ...net, nodes: (net.nodes || []).filter((n: any) => linked.has(n.login)),
    links: [...links].map(([k, count]) => { const [source, target] = k.split("\u0000"); return { source, target, count }; }) };
}

/** Said in a title's ⓘ where erased accounts were left out: for privacy the panel is drawn with the people still there. */
const erasedNote = (f: Page["f"], n: number) => (n ? f.plural(n, "who.erased_note") : "");

const staffLogins = (pg: Page) => new Set<string>(pg.D.people.filter((p: any) => p.staff).map((p: any) => p.login));
const noErased = (e: any) => ({ ...e, correcteds: (e.correcteds || []).filter((c: any) => !erased(c.login)) });

/** Everyone met with their group today; staff accounts (no cursus) get a group of their own. */
function connections(pg: Page): any[] {
  const staff = staffLogins(pg);
  return (pg.v.connections || []).map((c: any) => (staff.has(c.login) ? { ...c, group: "staff" } : c));
}

export function people(pg: Page): Section[] {
  const f = pg.f, D = pg.D, S = D.summary;
  const out: Section[] = [];
  const top = D.people.filter((p: any) => p.evaluated_me).slice(0, 25);
  const q = pg.q("q", "").slice(0, 80);
  const rows = D.people.filter((p: any) => !q || JSON.stringify([p.login, p.name, p.projects_on_me, p.hosts]).toLowerCase().includes(q.toLowerCase()));
  const firstOf = (xs: string[], n: number) => (xs.length > n ? f.t("common.first_of", { list: xs.slice(0, n).join(", "), more: xs.length - n }) : xs.join(", "));
  const details = (p: any) => {
    const projs = Object.entries(p.projects_on_me || {}).map(([k, v]: [string, any]) => (v > 1 ? `${k} (x${v})` : k));
    const seats = Object.keys(p.hosts || {});
    const line = seats.length ? f.t("who.seats", { list: firstOf(seats, 2) }) : "";
    return `<span title="${esc(projs.join(", "))}">${esc(firstOf(projs, 3) || "–")}</span>` + (line ? `<span class="sub" title="${esc(seats.join(", "))}">${esc(line)}</span>` : "");
  };
  const tip = (p: any) => [p.login, f.t("who.tip_mark", { mark: f.num(p.avg_mark_to_me, 1), rating: f.num(p.my_rating_of_them, 2) }),
    f.t("who.tip_cross", { you: p.evaluated_by_me, team: p.teammate })].join(" · ");
  const groupOf = new Map<string, string>(connections(pg).map((c: any) => [c.login, c.group]));
  const order = (g?: string) => (g && GROUPS.includes(g) ? GROUPS.indexOf(g) : 99);
  const lede = esc(f.t("who.lede", { correctors: S.unique_correctors, mutual: S.mutual }));
  out.push({ id: "who", nav: f.t("nav.who"), html: section("who", f.t("who.title"), cols(
    `<div class="block" data-panel="correctors"><div class="block-head"><h3>${esc(f.t("who.top_title"))}</h3>${legend([[f.t("flag.other"), S1], [f.t("flag.outstanding"), GOOD]])}</div>`
    + hbars(f, top.map((p: any) => (erased(p.login) ? f.t("who.erased") : p.login)), [[f.t("flag.other"), top.map((p: any) => p.evaluated_me - p.outstanding_to_me), S1], [f.t("flag.outstanding"), top.map((p: any) => p.outstanding_to_me), GOOD]],
      { label: f.t("who.top_title"), tips: top.map(tip), emptyText: f.t("empty.period"), end: (_i, v) => String(v), min: 8,
        extra: (i) => (top[i].outstanding_to_me ? `${top[i].outstanding_to_me} ${f.t("flag.outstanding")}` : "") }) + "</div>"), { lede }) });

  const rate = (v: any) => (v === null || v === undefined ? "–" : f.num(v, 2));
  out.push({ id: "crossed", nav: f.t("nav.crossed"), html: section("crossed", "", cols(
    `<div class="block" data-panel="table-people">`
    + filters("who", search("q", q, f.t("common.search"), f.t("who.search_placeholder")))
    + `<div id="who-results"><div class="table-wrap">${table(f, [
      { k: "login", t: f.t("col.login"), nw: true, f: (p) => `${erased(p.login) ? "" : avatar(p)}${shownLogin(f, p.login)}${p.staff ? " " + badge(f.t("who.staff")) : ""}` },
      { k: "name", t: f.t("col.name"), cls: "name", hide: true, f: (p) => (erased(p.login) ? deletedName(f) : `<span title="${esc(p.name || "")}">${esc(p.name || "")}</span>`) },
      { k: "group", t: f.t("col.group"), nw: true, hide: true, sv: (p) => order(groupOf.get(p.login)), f: (p) => (groupOf.has(p.login) ? esc(f.t(`groups.${groupOf.get(p.login)}`)) : "–") },
      { k: "evaluated_me", t: f.t("col.evaluated_you"), s: f.t("abbr.evaluated_you"), num: true, cls: "mid" },
      { k: "outstanding_to_me", t: f.t("col.outstanding"), s: f.t("abbr.outstanding"), num: true, cls: "mid" },
      { k: "avg_mark_to_me", t: f.t("col.avg_mark"), s: f.t("abbr.avg_mark"), num: true, cls: "mid", hide: true, f: (p) => f.num(p.avg_mark_to_me, 1) },
      { k: "evaluated_by_me", t: f.t("col.you_evaluated"), s: f.t("abbr.you_evaluated"), num: true, cls: "mid" },
      { k: "teammate", t: f.t("col.teammate"), s: f.t("abbr.teammate"), num: true, cls: "mid", hide: true },
      { k: "my_rating_of_them", t: f.t("col.ratings"), s: f.t("abbr.ratings"), num: true, cls: "mid", nw: true, hide: true,
        f: (p) => { const t = f.t("who.rating_tip", { mine: rate(p.my_rating_of_them), theirs: rate(p.their_rating_of_me) }); return `<span title="${esc(t)}" data-tip="${esc(t)}">${rate(p.my_rating_of_them)} / ${rate(p.their_rating_of_me)}</span>`; } },
      { k: "projects_on_me", t: f.t("col.details"), cls: "details", hide: true, sv: (p) => Object.keys(p.projects_on_me || {}).length, f: details },
      { k: "first", t: f.t("col.first"), nw: true, hide: true, f: (p) => esc(f.day(p.first)) },
      { k: "last", t: f.t("col.last"), nw: true, hide: true, f: (p) => esc(f.day(p.last)) },
    ], rows, { label: f.t("who.people_title"), sort: ["evaluated_me", -1], sticky: true })}</div></div></div>`),
  { head: `<h2>${esc(f.t("who.people_title"))} ${info(f.t("who.people_note"))}</h2>` }) });

  const mode = pg.q("mode", "received", ["received", "given", "mix"]);
  const conn = connections(pg).filter((c: any) => !erased(c.login));
  const connGone = (pg.v.connections || []).length - conn.length;
  const href = (login: string) => pg.url("evaluations", { q: login, log: "received" }) + "#log";
  const wide = bubbles(f, conn, mode, { width: 1200, href });
  const sw = pg.seg("mode", [["received", f.t("connections.mode_received")], ["given", f.t("connections.mode_given")], ["mix", f.t("connections.mode_mix")]], mode, f.t("connections.mode_label"), "connections");
  out.push({ id: "connections", nav: f.t("nav.connections"), html: section("connections", "", cols(`<div class="block" data-panel="connections">`
    + (wide ? `<div class="graph-panel"><div class="graph-wide">${wide}</div><div class="graph-mid">${bubbles(f, conn, mode, { width: 840, href })}</div>`
      + `<div class="graph-narrow">${bubbles(f, conn, mode, { width: 420, href })}</div></div>`
      : `<p class="note">${esc(f.t("connections.empty"))}</p>`) + "</div>"),
  { head: `<div class="panel-head"><h2>${esc(f.t("connections.title"))} ${info([f.t("stats.group_note"), erasedNote(f, connGone)].filter(Boolean).join("\n"))}</h2>${sw}</div>` }) });

  let net = pg.v.network || {};
  if (!net.nodes) net = net[pg.period] || {};
  let netGone = 0;
  if (net.nodes?.length) {
    netGone = net.nodes.filter((n: any) => erased(n.login)).length;
    const staff = staffLogins(pg);
    net = { ...net, nodes: net.nodes.filter((n: any) => !erased(n.login)).map((n: any) => (staff.has(n.login) && n.group !== "me" ? { ...n, group: "staff" } : n)),
      links: (net.links || []).filter((l: any) => !erased(l.source) && !erased(l.target)) };
    net = circleLinks(net, D.profile.login, D.given.map(noErased), D.received.filter((e: any) => !erased(e.corrector?.login)));
  }
  const has = !!net.links?.length;
  const pairs = new Map<string, Set<string>>();
  for (const l of net.links || []) {
    const k = [l.source, l.target].sort().join("\u0000");
    if (!pairs.has(k)) pairs.set(k, new Set());
    pairs.get(k)!.add(l.source);
  }
  const linesN = { one: [...pairs.values()].filter((p) => p.size === 1).length, both: [...pairs.values()].filter((p) => p.size === 2).length };
  const arrow: Record<string, string> = { one: '<line x1="1" y1="5" x2="25" y2="5"/><path d="M29 5 L22 1.5 L22 8.5 Z"/>',
    both: '<line x1="4" y1="5" x2="25" y2="5"/><path d="M1 5 L8 1.5 L8 8.5 Z"/><path d="M29 5 L22 1.5 L22 8.5 Z"/>' };
  const keyGroups: [string, string][] = [["me", f.t("network.key_me")], ["rank", f.t("network.key_rank")], ["outer", f.t("groups.outer-core")], ["alumni", f.t("groups.alumni")],
    ["dead", f.t("groups.blackholed")], ["staff", f.t("groups.staff")], ["none", f.t("groups.no-cursus")]];
  const count: Record<string, number> = {};
  for (const n of net.nodes || []) if (n.group !== "me") count[netClass(n.group)] = (count[netClass(n.group)] || 0) + 1;
  const row = (key: string, label: string, n = "") => `<li>${key}<span>${esc(label)}</span><b>${n}</b></li>`;
  const side = `<h3>${esc(f.t("network.key_who"))}</h3><ul>`
    + keyGroups.filter(([c]) => c === "me" || count[c]).map(([c, label]) => row(`<svg class="net-key" viewBox="0 0 12 12" aria-hidden="true"><g class="net-node ${c}"><circle cx="6" cy="6" r="5"/></g></svg>`, label, c !== "me" ? f.num(count[c] || 0) : "")).join("")
    + `</ul><h3>${esc(f.t("network.key_lines"))}</h3><ul>`
    + (["one", "both"] as const).map((k) => row(`<svg class="arrow-key ${k}" viewBox="0 0 30 10" aria-hidden="true">${arrow[k]}</svg>`, f.t(`network.${k === "one" ? "one_way" : "both"}`), f.num(linesN[k]))).join("")
    + `</ul><h3>${esc(f.t("network.dir_title"))}</h3><ul>`
    + ["in", "out", "both"].map((d) => row(`<svg class="dir-key ${d}" viewBox="0 0 30 10" aria-hidden="true"><line x1="1" y1="5" x2="29" y2="5"/>`
      + (d === "both" ? '<line class="gap" x1="1" y1="5" x2="29" y2="5"/>' : "") + "</svg>", f.t(`network.dir_${d}`))).join("") + "</ul>";
  out.push({ id: "circle", nav: f.t("nav.network"), html: section("circle", "", cols(`<div class="block" data-panel="network">`
    + (has ? `<div class="net-wrap"><aside class="net-side" aria-label="${esc(f.t("network.key_who"))}">${side}</aside><div class="net-plot graph-panel">`
      + `<div class="graph-wide">${ring(f, net, { width: 720, height: 640, compact: false, uid: "w" })}</div><div class="graph-narrow">${ring(f, net, { width: 400, height: 400, compact: true, uid: "n" })}</div></div></div>`
      : `<p class="note">${esc(f.t("network.empty"))}</p>`) + "</div>"), { head: `<h2>${esc(f.t("network.title"))}${netGone ? ` ${info(erasedNote(f, netGone))}` : ""}</h2>`, lede: esc(f.t("network.lede")) }) });

  const tm = D.insights?.teammates || [];
  out.push({ id: "teammates", nav: f.t("nav.teammates"), html: section("teammates", f.t("teammates.title"), cols(block("teammates", !tm.length ? `<p class="note">${esc(f.t("teammates.none"))}</p>` : `<div class="table-wrap">${table(f, [
    { k: "login", t: f.t("col.login"), nw: true, f: (r) => shownLogin(f, r.login) }, { k: "name", t: f.t("col.name"), hide: true, f: (r) => (erased(r.login) ? deletedName(f) : esc(r.name || "")) },
    { k: "teams", t: f.t("col.teams"), num: true },
    { k: "projects", t: f.t("col.projects"), sv: (r) => Object.keys(r.projects || {}).length,
      f: (r) => esc(Object.entries(r.projects || {}).map(([n, c]: [string, any]) => (c > 1 ? `${n} (x${c})` : n)).join(", ")) },
  ], tm, { label: f.t("teammates.title"), sort: ["teams", -1], empty: f.t("teammates.none") })}</div>`)), { count: f.plural(tm.length, "depth.whom") }) });

  return out;
}
