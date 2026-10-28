// People: who evaluated you, your connections and circle, teammates, your coalition and your promo.
import { GOOD, S1, S2, hbars, legend, vbars } from "../lib/charts";
import { GROUPS, bubbles, netClass, ring } from "../lib/graphs";
import { avatar, badge, esc, safeColor } from "../lib/h";
import { table } from "../lib/table";
import { Page, Section, block, cols, filters, info, msOf, search, section } from "./page";

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

export function people(pg: Page): Section[] {
  const f = pg.f, D = pg.D, S = D.summary;
  const out: Section[] = [];
  const most = D.people.filter((p: any) => p.outstanding_to_me).reduce((a: any, b: any) => (!a || b.outstanding_to_me > a.outstanding_to_me ? b : a), null);
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
  const groupOf = new Map<string, string>((pg.v.connections || []).map((c: any) => [c.login, c.group]));
  const order = (g?: string) => (g && GROUPS.includes(g) ? GROUPS.indexOf(g) : 99);
  const lede = esc(f.t("who.lede", { correctors: S.unique_correctors, mutual: S.mutual }))
    + (most ? ` <em>${esc(f.t("who.lede_most", { login: most.login, n: most.outstanding_to_me }))}</em>` : "");
  out.push({ id: "who", nav: f.t("nav.who"), html: section("who", f.t("who.title"), cols(
    `<div class="block" data-panel="correctors"><div class="block-head"><h3>${esc(f.t("who.top_title"))}</h3>${legend([[f.t("flag.other"), S1], [f.t("flag.outstanding"), GOOD]])}</div>`
    + hbars(f, top.map((p: any) => p.login), [[f.t("flag.other"), top.map((p: any) => p.evaluated_me - p.outstanding_to_me), S1], [f.t("flag.outstanding"), top.map((p: any) => p.outstanding_to_me), GOOD]],
      { label: f.t("who.top_title"), tips: top.map(tip), emptyText: f.t("empty.period"), end: (_i, v) => String(v),
        extra: (i) => (top[i].outstanding_to_me ? `${top[i].outstanding_to_me} ${f.t("flag.outstanding")}` : "") }) + "</div>",
    `<div class="block" data-panel="table-people"><h3>${esc(f.t("who.people_title"))} ${info(f.t("who.people_note"))}</h3>`
    + filters("who", search("q", q, f.t("common.search"), f.t("who.search_placeholder")))
    + `<div id="who-results"><div class="table-wrap">${table(f, [
      { k: "login", t: f.t("col.login"), nw: true, f: (p) => `${avatar(p)}${esc(p.login)}${p.staff ? " " + badge(f.t("who.staff")) : ""}` },
      { k: "name", t: f.t("col.name"), cls: "name", hide: true, f: (p) => `<span title="${esc(p.name || "")}">${esc(p.name || "")}</span>` },
      { k: "group", t: f.t("col.group"), nw: true, hide: true, sv: (p) => order(groupOf.get(p.login)), f: (p) => (groupOf.has(p.login) ? esc(f.t(`groups.${groupOf.get(p.login)}`)) : "–") },
      { k: "evaluated_me", t: f.t("col.evaluated_you"), s: f.t("abbr.evaluated_you"), num: true },
      { k: "outstanding_to_me", t: f.t("col.outstanding"), s: f.t("abbr.outstanding"), num: true },
      { k: "avg_mark_to_me", t: f.t("col.avg_mark"), s: f.t("abbr.avg_mark"), num: true, hide: true, f: (p) => f.num(p.avg_mark_to_me, 1) },
      { k: "evaluated_by_me", t: f.t("col.you_evaluated"), s: f.t("abbr.you_evaluated"), num: true },
      { k: "teammate", t: f.t("col.teammate"), s: f.t("abbr.teammate"), num: true, hide: true },
      { k: "my_rating_of_them", t: f.t("col.ratings"), s: f.t("abbr.ratings"), num: true, nw: true, hide: true, f: (p) => `${f.num(p.my_rating_of_them, 2)} / ${f.num(p.their_rating_of_me, 2)}` },
      { k: "projects_on_me", t: f.t("col.details"), cls: "details", hide: true, sv: (p) => Object.keys(p.projects_on_me || {}).length, f: details },
      { k: "first", t: f.t("col.first"), nw: true, hide: true, f: (p) => esc((p.first || "–").slice(0, 10)) },
      { k: "last", t: f.t("col.last"), nw: true, hide: true, f: (p) => esc((p.last || "–").slice(0, 10)) },
    ], rows, { label: f.t("who.people_title"), sort: ["evaluated_me", -1], sticky: true })}</div></div></div>`), { lede }) });

  const mode = pg.q("mode", "received", ["received", "given", "mix"]);
  const conn = pg.v.connections || [];
  const href = (login: string) => pg.url("evaluations", { q: login, log: "received" }) + "#log";
  const height = Math.max(260, Math.min(520, 160 + 12 * conn.length)); // few people, a short panel
  const wide = bubbles(f, conn, mode, { width: 960, height, href });
  const sw = pg.seg("mode", [["received", f.t("connections.mode_received")], ["given", f.t("connections.mode_given")], ["mix", f.t("connections.mode_mix")]], mode, f.t("connections.mode_label"), "connections");
  out.push({ id: "connections", nav: f.t("nav.connections"), html: section("connections", "", cols(`<div class="block graph-panel" data-panel="connections">`
    + legend([[f.t("connections.legend_received"), S1], [f.t("connections.legend_given"), S2]])
    + (wide ? `<div class="graph-wide">${wide}</div><div class="graph-narrow">${bubbles(f, conn, mode, { width: 420, height, href })}</div>` : `<p class="note">${esc(f.t("connections.empty"))}</p>`) + "</div>"),
  { head: `<div class="panel-head"><h2>${esc(f.t("connections.title"))} ${info(f.t("stats.group_note"))}</h2>${sw}</div>`, lede: esc(f.t("connections.lede")) }) });

  let net = pg.v.network || {};
  if (!net.nodes) net = net[pg.period] || {};
  if (net.nodes?.length) net = circleLinks(net, D.profile.login, D.given, D.received);
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
    ["dead", f.t("groups.blackholed")], ["none", f.t("groups.no-cursus")]];
  const count: Record<string, number> = {};
  for (const n of net.nodes || []) if (n.group !== "me") count[netClass(n.group)] = (count[netClass(n.group)] || 0) + 1;
  const row = (key: string, label: string, n = "") => `<li>${key}<span>${esc(label)}</span><b>${n}</b></li>`;
  const side = `<h3>${esc(f.t("network.key_who"))}</h3><ul>`
    + keyGroups.filter(([c]) => c === "me" || count[c]).map(([c, label]) => row(`<svg class="net-key" viewBox="0 0 12 12" aria-hidden="true"><g class="net-node ${c}"><circle cx="6" cy="6" r="5"/></g></svg>`, label, c !== "me" ? f.num(count[c]) : "")).join("")
    + `</ul><h3>${esc(f.t("network.key_lines"))}</h3><ul>`
    + (["one", "both"] as const).map((k) => row(`<svg class="arrow-key ${k}" viewBox="0 0 30 10" aria-hidden="true">${arrow[k]}</svg>`, f.t(`network.${k === "one" ? "one_way" : "both"}`), f.num(linesN[k]))).join("")
    + `</ul><h3>${esc(f.t("network.dir_title"))}</h3><ul>`
    + ["in", "out", "both"].map((d) => row(`<svg class="dir-key ${d}" viewBox="0 0 30 10" aria-hidden="true"><line x1="1" y1="5" x2="29" y2="5"/>`
      + (d === "both" ? '<line class="gap" x1="1" y1="5" x2="29" y2="5"/>' : "") + "</svg>", f.t(`network.dir_${d}`))).join("") + "</ul>";
  out.push({ id: "circle", nav: f.t("nav.network"), html: section("circle", f.t("network.title"), cols(`<div class="block" data-panel="network">`
    + (has ? `<div class="net-wrap"><aside class="net-side" aria-label="${esc(f.t("network.key_who"))}">${side}</aside><div class="net-plot graph-panel">`
      + `<div class="graph-wide">${ring(f, net, { width: 720, height: 640, compact: false, uid: "w" })}</div><div class="graph-narrow">${ring(f, net, { width: 400, height: 400, compact: true, uid: "n" })}</div></div></div>`
      : `<p class="note">${esc(f.t("network.empty"))}</p>`) + "</div>"), { lede: esc(f.t("network.lede")) }) });

  const tm = D.insights?.teammates || [];
  out.push({ id: "teammates", nav: f.t("nav.teammates"), html: section("teammates", f.t("teammates.title"), cols(block("teammates", `<div class="table-wrap">${table(f, [
    { k: "login", t: f.t("col.login"), nw: true }, { k: "name", t: f.t("col.name"), hide: true, f: (r) => esc(r.name || "") },
    { k: "teams", t: f.t("col.teams"), num: true },
    { k: "projects", t: f.t("col.projects"), sv: (r) => Object.keys(r.projects || {}).length,
      f: (r) => esc(Object.entries(r.projects || {}).map(([n, c]: [string, any]) => (c > 1 ? `${n} (x${c})` : n)).join(", ")) },
  ], tm, { label: f.t("teammates.title"), sort: ["teams", -1], empty: f.t("teammates.none") })}</div>`)), { count: f.plural(tm.length, "depth.whom") }) });

  // your coalition and your promo (Home held them in v1)
  const C = pg.v.coalitions || [], promo = pg.v.promo;
  const recent = recentPoints(pg);
  if (C.length || promo || recent) {
    const best = Math.max(1, ...C.map((c: any) => c.score));
    const coal = C.map((c: any) => `<li class="${c.mine ? "mine" : ""}"><span class="rank">${esc(c.rank)}</span><span class="name"><i style="background:${safeColor(c.color)}"></i>`
      + `${esc(c.name)}${c.mine ? " " + badge(f.t("standing.yours")) : ""}</span><span class="track"><b style="width:${((100 * c.score) / best).toFixed(1)}%;`
      + `background:${safeColor(c.color)}"></b></span><span class="num">${f.num(c.score)}</span></li>`).join("");
    const mineC = D.profile.coalition;
    const mineLine = mineC ? [mineC.name, mineC.rank ? f.t("standing.coal_rank", { n: mineC.rank }) : "", mineC.score !== null && mineC.score !== undefined ? f.t("standing.coal_score", { n: f.num(mineC.score) }) : "",
      mineC.master ? f.t("standing.coal_master") : ""].filter(Boolean).join(" · ") : "";
    const promoLede = promo ? f.t("standing.promo_lede", { rank: f.num(promo.rank), size: f.num(promo.size), pct: f.num(promo.percentile, 1), median: f.num(promo.median, 2) }) : f.t("standing.no_promo");
    out.push({ id: "standing", nav: f.t("nav.standing"), html: section("standing", f.t("standing.title"), cols(
      C.length || recent ? `<div class="block${promo ? " fit" : ""}" data-panel="coalitions">`
        + (C.length ? `<h3>${esc(f.t("standing.coalitions"))}</h3><ol class="standings">${coal}</ol>` : "")
        + (recent ? `<div class="recent" data-panel="coal-recent"><h3>${esc(f.t("standing.recent"))}</h3><p class="note">${esc(f.t("standing.recent_note"))}</p>`
          + `<ol class="list" tabindex="0" aria-label="${esc(f.t("standing.recent"))}">${recent}</ol></div>` : "") + "</div>" : "",
      block("promo", `<p class="lede">${esc(promoLede)}</p>` + (promo ? promoChart(pg, promo) : ""), f.t("standing.promo"))),
    { lede: mineLine ? `<b>${esc(f.t("standing.mine"))}:</b> ${esc(mineLine)}` : "" }) });
  }

  const P = D.coalition_points;
  if (P && P.count) {
    const src = P.sources, months = P.months;
    const month = (m: string) => `${f.months[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`;
    const names = src.map((s: any) => f.t(`coal.src.${s.key}`));
    const total = f.t("coal.total", { points: f.num(P.total), n: f.plural(P.count, "coal.awards"),
      coalition: D.profile.coalition?.name || "–", span: months.length ? f.t("coal.span", { first: month(months[0].month), last: month(months[months.length - 1].month) }) : f.t("empty.period") });
    out.push({ id: "coal-points", nav: f.t("nav.coal"), html: section("coal-points", f.t("coal.title"), cols(
      block("coal-sources", `<p class="lede">${esc(total)}</p><div class="centred">${hbars(f, names, [[f.t("coal.points"), src.map((s: any) => s.points), S1]],
        { label: f.t("coal.sources"), end: (_i, v) => f.num(v), tips: names.map((n: string, i: number) => `${n} · ${f.num(src[i].points)} · ${f.plural(src[i].count, "coal.awards")}`),
          emptyText: f.t("empty.period"), big: true })}</div>`, f.t("coal.sources")),
      block("coal-months", legend([[f.t("coal.src.logtime"), S1], [f.t("coal.rest"), S2]]) + vbars(f, months.map((m: any) => f.monthLabel(m.month)),
        [[f.t("coal.src.logtime"), months.map((m: any) => m.logtime), S1], [f.t("coal.rest"), months.map((m: any) => m.other), S2]],
        { label: f.t("coal.months"), stacked: true, fmt: (v) => f.num(v), every: Math.ceil(months.length / 6) || 1, emptyText: f.t("empty.period") }), f.t("coal.months"))),
    { lede: esc(f.t("coal.lede")) }) });
  }
  return out;
}

function promoChart(pg: Page, promo: any) {
  const f = pg.f;
  const hist = new Map<number, number>(promo.histogram.map((h: any) => [h.level, h.count]));
  const keys = [...hist.keys()];
  const levels = keys.length ? Array.from({ length: Math.max(...keys) - Math.min(...keys) + 1 }, (_, i) => Math.min(...keys) + i) : [];
  const mine = Math.floor(promo.mine);
  const tips = levels.map((lv) => [f.t("standing.level_tip", { level: lv }), f.plural(hist.get(lv) || 0, "standing.n_students"), ...(lv === mine ? [f.t("standing.you_here")] : [])].join(" · "));
  return vbars(f, levels.map(String), [[f.t("standing.students"), levels.map((lv) => (lv !== mine ? hist.get(lv) || 0 : 0)), S2],
    [f.t("standing.your_level"), levels.map((lv) => (lv === mine ? hist.get(lv) || 0 : 0)), S1]],
  { label: f.t("standing.promo"), stacked: true, xtitle: f.t("standing.level_axis"), fmt: (v) => f.num(v), tips });
}

/** The latest awards to the coalition, newest first, each with the project, evaluation or exam it came from. */
function recentPoints(pg: Page): string {
  const f = pg.f;
  const recent = pg.D.coalition_points?.recent;
  if (!recent?.length) return "";
  const names = new Map<string, string>();
  for (const p of pg.allProjects) {
    names.set(`projects|${p.pu_id}`, p.name);
    for (const a of p.attempts) names.set(`exams|${a.team_id}`, p.name);
  }
  for (const e of pg.D.given) names.set(`evaluations|${e.id}`, e.project);
  return recent.map((r: any) => {
    const name = names.get(`${r.key}|${r.id}`);
    const what = name || r.key.startsWith("logtime") ? f.t(`coal.why.${r.key}`, { name: name || "" }) : f.t(`coal.src.${r.key}`);
    return `<li><span>${esc(what)}<br><span class="note">${esc(f.stamp(msOf(r.at)))}</span></span><span class="when">+${esc(f.num(r.points))}</span></li>`;
  }).join("");
}
