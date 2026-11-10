import { expect, test } from "vitest";
import { Fmt } from "../fmt";
import { Page, daysTo, erased, monthsBetween, myTrack } from "./page";

const ex = (quests: [string, boolean][]) => ({ cursus: [{ name: "42cursus" }], quests: quests.map(([name, v]) => ({ name, validated: v ? "2026-01-01" : null })) });

test("the Common Core track: Python when the 42Next quest is validated, C otherwise", () => {
  expect(myTrack(ex([["42Next", true], ["Common Core Rank 02", true]]))).toBe("python");
  expect(myTrack(ex([["Common Core Rank 04", true]]))).toBe("c");
  expect(myTrack({ cursus: [{ name: "C Piscine" }], quests: [] })).toBe(null);
});

test("an account 42 erased (login 3b3-NNNNN) reads as a deleted account", () => {
  expect(erased("3b3-12345")).toBe(true);
  expect(erased("peer01")).toBe(false);
  expect(erased(null)).toBe(false);
});

test("the months between two, both included, across a year", () => {
  expect(monthsBetween("2025-11", "2026-02")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  expect(monthsBetween("2026-02", "2026-02")).toEqual(["2026-02"]);
  expect(monthsBetween("2026-03", "2026-02")).toEqual([]);
});

test("days carried on to a later day with zeros, untouched when already there", () => {
  expect(daysTo(["2026-02-27", "2026-02-28"], [1, 2], "2026-03-02")).toEqual([["2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02"], [1, 2, 0, 0]]);
  expect(daysTo(["2026-02-27"], [1], "2026-02-27")).toEqual([["2026-02-27"], [1]]);
  expect(daysTo(["2026-02-27"], [1], "")).toEqual([["2026-02-27"], [1]]);
  expect(daysTo([], [], "2026-03-01")).toEqual([[], []]);
});

test("every section Profile offers as a widget is built by its page and has a title in both languages", async () => {
  const { readFileSync } = await import("node:fs");
  const { WIDGETS } = await import("./profile");
  expect(WIDGETS.some(([page, id]) => page === "home" && id === "activity")).toBe(true); // a widget like the rest
  const en = (await import("@data/i18n/en.json")).default as Record<string, unknown>;
  const es = (await import("@data/i18n/es.json")).default as Record<string, unknown>;
  for (const [page, id, key] of WIDGETS) {
    expect(readFileSync(`src/views/${page === "home" ? "profile" : page}.ts`, "utf8"), `${page}#${id}`).toMatch(new RegExp(`id: "${id}"`));
    expect(key in en && key in es, key).toBe(true);
  }
});

test("per project, the received evaluations with no session of yours open and, where looked up, none of your corrector's", async () => {
  const { notLoggedRows } = await import("./campus");
  const ev = (project: string, my_host: string | null, checked = false, other_host: string | null = null) => ({ project, my_host, other_host_checked: checked, other_host });
  expect(notLoggedRows("received", [ev("libft", null), ev("minishell", "c1r1s1", true, null), ev("libft", null, true, "c2r1s1"), ev("cub3d", "c1r1s1", true, "c1r2s2"),
    ev("push_swap", null, true, null)])).toEqual([
    { project: "libft", me: 2, other: 0 }, { project: "push_swap", me: 1, other: 1 }, { project: "minishell", me: 0, other: 1 }]);
});

test("per project, the given evaluations with no session of yours open and each evaluated person not logged where looked up", async () => {
  const { notLoggedRows } = await import("./campus");
  const ev = (project: string, my_host: string | null, checked: boolean, hosts: (string | null)[]) =>
    ({ project, my_host, other_host_checked: checked, correcteds: hosts.map((host, i) => ({ login: `peer0${i}`, host })) });
  expect(notLoggedRows("given", [ev("libft", "c1r1s1", true, [null, null, "c1r1s2"]), ev("libft", null, false, [null]), ev("so_long", "c1r1s1", true, ["c3r1s1"])]))
    .toEqual([{ project: "libft", me: 1, other: 2 }]);
});

test("Coalition always shows the student period; every other page the one chosen", async () => {
  const { pagePeriod } = await import("./page");
  expect(pagePeriod("coalition", "piscine")).toBe("student");
  expect(pagePeriod("coalition", "")).toBe("student");
  expect(pagePeriod("campus", "piscine")).toBe("piscine");
  expect(pagePeriod("home", "")).toBe("");
});

test("the not logged bar's tip names your projects beside your count", async () => {
  const { notLoggedProjects } = await import("./campus");
  const rows = [{ project: "libft", me: 2, other: 0 }, { project: "push_swap", me: 1, other: 1 }, { project: "minishell", me: 0, other: 3 }];
  expect(notLoggedProjects(rows)).toBe("libft (x2), push_swap");
  expect(notLoggedProjects([{ project: "minishell", me: 0, other: 3 }, { project: "libft", me: 2, other: 0 }], "other")).toBe("minishell (x3)");
  expect(notLoggedProjects([{ project: "minishell", me: 0, other: 3 }])).toBe("");
});

test("negative flags are named, most first, per month", async () => {
  const { negativeFlags } = await import("./page");
  const ev = (begin: string, flag: string, negative_flag = true) => ({ begin, flag, negative_flag });
  const evs = [ev("2026-03-02 10:00", "Cheat"), ev("2026-03-09 10:00", "Crash"), ev("2026-03-20 10:00", "Cheat"), ev("2026-03-21 10:00", "Ok", false),
    ev("2026-04-01 10:00", "Norme")];
  expect(negativeFlags(evs)).toEqual(new Map([["2026-03", "Cheat ×2, Crash"], ["2026-04", "Norme"]]));
});

test("a work experience's part reads Work Exp. wherever a page names it, keys included; the whole one keeps its name; the view as it came stays untouched", () => {
  const v: any = { period: "all", all_projects: [{ name: "Work Experience II - Company final evaluation" }],
    report: { projects: [{ name: "Work Experience I" }, { name: "Work Experience I  - Contract Upload" }, { name: "Libft" }],
      received: [{ project: "Work Experience - Peer Video", comment: "Work Experience is hard" }], stats: { by_project: { "Work Experience II - Duration": 2, "Work Experience II": 1 } } } };
  const pg = new Page(new Fmt("en"), v, "projects", {});
  expect(pg.D.projects.map((p: any) => p.name)).toEqual(["Work Experience I", "Work Exp. I - Contract Upload", "Libft"]); // the API's double space goes too
  expect(pg.D.received[0].project).toBe("Work Exp. - Peer Video");
  expect(pg.D.received[0].comment).toBe("Work Experience is hard"); // names only
  expect(Object.keys(pg.D.stats.by_project)).toEqual(["Work Exp. II - Duration", "Work Experience II"]);
  expect(pg.allProjects[0].name).toBe("Work Exp. II - Company final evaluation");
  expect(v.report.projects[0].name).toBe("Work Experience I");
  expect(new Page(new Fmt("en"), v, "evaluations", {}).D).toBe(pg.D); // shortened once per view
});
