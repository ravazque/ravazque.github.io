import { expect, test } from "vitest";
import { Fmt } from "../fmt";
import { Page } from "./page";
import { evaluatedBy, firstMore, outerTip, people, shortName, whoDetails } from "./people";

test("a name shows its first two words", () => {
  expect(shortName("Álvaro Cerezo Fernández")).toBe("Álvaro Cerezo");
  expect(shortName("  Jaime   Vidal ")).toBe("Jaime Vidal");
  expect(shortName("Cher")).toBe("Cher");
  expect(shortName(null)).toBe("");
});

test("the projects a person evaluated you on, newest first, each with the seat they used when it was looked up", () => {
  const ev = (login: string, project: string, begin: string, checked: boolean, host: string | null) =>
    ({ corrector: { login }, project, begin, other_host_checked: checked, other_host: host });
  const received = [ev("peer01", "libft", "2026-03-01 10:00", false, null), ev("peer02", "minishell", "2026-10-20 12:00", true, "c1r1s1"),
    ev("peer01", "ft_printf", "2026-10-25 16:00", true, "c3r2s4"), ev("peer01", "get_next_line", "2026-10-28 09:00", true, null)];
  const lines = evaluatedBy(new Fmt("en"), received, "peer01").split("\n");
  expect(lines.slice(1)).toEqual(["get_next_line · 28 Oct 2026 · not logged", "ft_printf · 25 Oct 2026 · c3r2s4", "libft · 1 Mar 2026 · –"]);
  expect(evaluatedBy(new Fmt("en"), received, "peer09")).toBe("");
});

test("details name the first project and how many more", () => {
  const f = new Fmt("en");
  expect(firstMore(f, ["libft (x2)", "ft_printf", "so_long"])).toBe("libft (x2) +2 more");
  expect(firstMore(f, ["libft"])).toBe("libft");
  expect(firstMore(f, [])).toBe("–");
});

test("details open a floating list on click: the first project and how many more, then every evaluation", () => {
  const html = whoDetails(new Fmt("en"), ["libft (x2)", "ft_printf"], "Project · day · their seat\nlibft · 1 Mar 2026 · –\nft_printf · 2 Mar 2026 · c1r1s1");
  expect(html).toMatch(/^<details class="pop who-pop" data-float><summary>libft \(x2\) \+1 more<\/summary>/); // plain text under the dotted line
  expect(html.match(/<li>/g)).toHaveLength(2);
  expect(html).toContain("<b>Project · day · their seat</b>");
  expect(whoDetails(new Fmt("en"), [], "")).toBe("–");
  expect(whoDetails(new Fmt("en"), ["libft"], "")).toBe("libft");
});

test("a bubble opens that person in the evaluation log on the side it stands for: given when it counts the ones you corrected", () => {
  const page = (mode: string) => new Page(new Fmt("en"), { period: "student", network: {}, all_projects: [],
    connections: [{ login: "peer01", group: "outer-core", received: 2, given: 0 }, { login: "peer02", group: "rank-03", received: 1, given: 3 }],
    report: { profile: { login: "me" }, extras: { cursus: [], quests: [] }, summary: { unique_correctors: 2, mutual: 0 }, given: [], received: [], insights: {}, people: [] } } as any,
    "people", { mode });
  const hrefs = (mode: string) => [...people(page(mode)).find((s) => s.id === "connections")!.html.matchAll(/href="([^"]*#log)"/g)].map((m) => m[1].replaceAll("&amp;", "&"));
  expect(hrefs("given").every((h) => h.includes("log=given"))).toBe(true);
  expect(hrefs("given").some((h) => h.includes("q=peer02"))).toBe(true);
  expect(hrefs("received").every((h) => h.includes("log=received"))).toBe(true);
  const mix = hrefs("mix"); // each person twice, one bubble per side
  expect(mix.filter((h) => h.includes("q=peer02") && h.includes("log=given")).length).toBeGreaterThan(0);
  expect(mix.filter((h) => h.includes("q=peer02") && h.includes("log=received")).length).toBeGreaterThan(0);
  expect(mix.some((h) => h.includes("q=peer01") && h.includes("log=given"))).toBe(false);
});

test("the tip counts what a person gave you in Outer Core projects, nothing when there is none", () => {
  const ev = (project: string, o: any) => ({ corrector: { login: "peer01" }, project, mark: 100, ...o });
  const received = [ev("ft_transcendence", { outstanding: true }), ev("webserv", {}), ev("webserv", { negative_flag: true }), ev("webserv", { mark: null }), ev("libft", {}),
    { corrector: { login: "peer02" }, project: "webserv", mark: 100 }];
  const f = new Fmt("en"), outer = new Set(["ft_transcendence", "webserv"]);
  expect(outerTip(f, received, "peer01", outer)).toBe("Outer projects: 1 OK, 1 outstanding");
  expect(outerTip(f, received, "nobody", outer)).toBe("");
});

const whoPage = (extras: any) => new Page(new Fmt("en"), { all_projects: [{ name: "webserv", group: "outer-core", attempts: [] }], period: "student",
  connections: [{ login: "peer01", group: "outer-core" }, { login: "peer02", group: "rank-03" }], network: {},
  report: { profile: { login: "me" }, extras, summary: { unique_correctors: 2, mutual: 0 }, given: [], insights: {},
    received: [{ corrector: { login: "peer01" }, project: "webserv", mark: 100, outstanding: true }],
    people: [{ login: "peer01", name: "", evaluated_me: 1, evaluated_by_me: 0, outstanding_to_me: 1, avg_mark_to_me: 100, my_rating_of_them: 4, teammate: 0 },
      { login: "peer02", name: "", evaluated_me: 1, evaluated_by_me: 0, outstanding_to_me: 0, avg_mark_to_me: 80, my_rating_of_them: 3, teammate: 0 }] } } as any, "people", {});

test("Top 25: the tip tells Outer Core and what they gave you there, with no mark, no rating and no square", () => {
  const html = people(whoPage({ cursus: [{ name: "42cursus", grade: "Transcender" }], quests: [] }))[0].html;
  expect(html).toContain("peer01 (OuterCore) · you evaluated them");
  expect(html).toContain("Outer projects: 0 OK, 1 outstanding");
  expect(html).not.toContain("hb-mark");
  expect(html).not.toContain("average mark");
  expect(html).not.toContain("your rating");
});

test("Top 25: nobody else's group in the tip unless you are in Outer Core yourself", () => {
  const html = people(whoPage({ cursus: [{ name: "42cursus", grade: "Learner" }], quests: [] }))[0].html;
  expect(html).not.toContain("OuterCore");
});

test("deleted accounts join Your circle as their own group, named Deleted, never by their old id; Connections leaves them out with a note", async () => {
  const { readFileSync } = await import("node:fs");
  const gone = (t: string) => t.replaceAll("peer03", "3b3-12345");
  const doc = JSON.parse(gone(readFileSync("../server/core/testdata/golden/mid.report.json", "utf8"))), all = doc.periods.all;
  const pg = new Page(new Fmt("en"), { period: "all", report: all, layout: doc.layout, connections: doc.connections.all, network: doc.network,
    all_projects: all.projects, all_cursus: all.extras.cursus } as any, "people", {});
  const [conn, html] = ["connections", "circle"].map((id) => people(pg).find((s) => s.id === id)!.html);
  const f = new Fmt("en");
  expect(html).toContain("net-node deleted"); // a ring node of its own
  expect(html).not.toMatch(/>3b3-12345</); // no label shows the old id
  expect(html).not.toMatch(/data-tip="3b3-12345/);
  expect(html).toContain(f.t("groups.deleted"));
  expect(conn).not.toContain("net-node deleted");
  expect(conn).toContain(f.plural(1, "who.erased_note"));
});
