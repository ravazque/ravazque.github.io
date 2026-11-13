import { expect, test } from "vitest";
import { Fmt } from "../fmt";
import { absence, autoFeedback, binLabels, staffApart, cancelledSection, pointsSection, deletedApart, evaluations, lateText, logSection, milestoneOf, seatMatch, seatOptions, teamCell, withoutWorkLate, workExperience } from "./evaluations";
import { Page, shownLogin } from "./page";

test("the log's seat filter: the evaluated side only, you received with no session open, or the students you evaluated not logged where it was looked up", () => {
  const recv = (my_host: string | null) => ({ my_host, other_host_checked: true, other_host: null });
  expect(seatMatch("received", "me", recv(null))).toBe(true);
  expect(seatMatch("received", "me", recv("c1r1s1"))).toBe(false);
  const given = (checked: boolean, hosts: (string | null)[]) => ({ my_host: "c1r1s1", other_host_checked: checked, correcteds: hosts.map((host) => ({ host })) });
  expect(seatMatch("given", "other", given(true, ["c1r1s2", null]))).toBe(true);
  expect(seatMatch("given", "other", given(true, ["c1r1s2"]))).toBe(false);
  expect(seatMatch("given", "other", given(false, [null]))).toBe(false);
  expect(seatMatch("given", "", given(false, [null]))).toBe(true);
});

test("the seat filter by cluster keeps the evaluations you had in that cluster", () => {
  expect(seatMatch("received", "c1", { my_host: "c1r2s3" })).toBe(true);
  expect(seatMatch("given", "c2", { my_host: "c1r2s3" })).toBe(false);
  expect(seatMatch("received", "c1", { my_host: null })).toBe(false);
});

test("a histogram's bins carry their unit beside the numbers", () => {
  expect(binLabels([0, 1, 3], "h")).toEqual(["0–1h", "1–3h", "3+h"]);
  expect(binLabels([0, 15], "m")).toEqual(["0–15m", "15+m"]);
});

test("deleted accounts get their own row by milestone, and no evaluation is lost on the way", () => {
  const stats = { "rank-01": { received: 2, received_out: 0, given: 1, given_out: 0 }, "no-cursus": { received: 3, received_out: 1, given: 5, given_out: 2 } };
  const received = [{ corrector: { login: "3b3-1" }, outstanding: true }, { corrector: { login: "3b3-2" }, outstanding: false }, { corrector: { login: "peer01" } }];
  const given = [{ correcteds: [{ login: "3b3-1" }, { login: "me" }], outstanding: true }, { correcteds: [{ login: "peer02" }], outstanding: false }];
  const got = deletedApart(stats, received, given, "me");
  expect(got.deleted).toEqual({ received: 2, received_out: 1, given: 1, given_out: 1 });
  expect(got["no-cursus"]).toEqual({ received: 1, received_out: 0, given: 4, given_out: 1 });
  expect(got["rank-01"]).toEqual(stats["rank-01"]);
  const sum = (k: string) => Object.values(got).reduce((n: number, r: any) => n + r[k], 0);
  expect([sum("received"), sum("given")]).toEqual([5, 6]);
  expect(deletedApart(stats, [{ corrector: { login: "peer01" } }], [], "me")).toEqual(stats);
});

test("how late the evaluated student logged in reads in minutes, then hours and minutes", () => {
  const en = new Fmt("en"), es = new Fmt("es");
  expect(lateText(en, 12)).toBe("12m late");
  expect(lateText(en, 75)).toBe("1h 15m late");
  expect(lateText(es, 12)).toBe("12m tarde");
});

test("the log's late filter: evaluations you logged into late, or where a student you evaluated did", () => {
  expect(seatMatch("received", "late", { my_late_min: 12 })).toBe(true);
  expect(seatMatch("received", "late", { my_late_min: null })).toBe(false);
  expect(seatMatch("given", "late", { correcteds: [{ late_min: null }, { late_min: 3 }] })).toBe(true);
  expect(seatMatch("given", "late", { correcteds: [{ late_min: null }] })).toBe(false);
});

test("the log's seat options leave out the corrector's side: yours when you gave it, the corrector's when you received it", () => {
  expect(seatOptions("received", ["c1"])).toEqual(["", "me", "late", "c1"]);
  expect(seatOptions("given", ["c1"])).toEqual(["", "other", "late", "c1"]);
});

test("work experience evaluations (company mid and final, peer video) are told apart by slug or name", () => {
  expect(workExperience({ slug: "work-experience-ii-work-experience-ii-company-mid-evaluation" })).toBe(true);
  expect(workExperience({ slug: "42cursus-work-experience-i" })).toBe(true);
  expect(workExperience({ slug: null, project: "Work Experience I - Peer Video" })).toBe(true);
  expect(workExperience({ slug: "libft", project: "Libft" })).toBe(false);
});

test("a team you evaluated shows its leader, the rest in a list that opens", () => {
  const f = new Fmt("en");
  const team = { other_host_checked: true, team: "Team 01", correcteds: [{ login: "peer01", host: "c1r1s1" }, { login: "peer02", host: null, leader: true, late_min: 5 }] };
  const html = teamCell(f, team);
  const summary = html.slice(html.indexOf("<summary>"), html.indexOf("</summary>"));
  expect(html.startsWith("<details")).toBe(true); // one line: the leader and +N open the team
  expect(summary).toContain("peer02");
  expect(summary).toContain('<span class="more">+1 more</span>'); // text, as in Everyone you met's details (kept on one line)
  expect(summary).not.toContain("peer01");
  const panel = html.slice(html.indexOf("</summary>"));
  expect(panel).toContain("peer01");
  expect(panel).toContain("leader · not logged · 5m late");
  expect(html.slice(html.lastIndexOf("</details>"))).toContain('class="sub">not logged · 5m late'); // the leader's seat under the line
  expect(teamCell(f, { other_host_checked: false, correcteds: [{ login: "peer03" }] })).not.toContain("<details");
});

test("a report saved before work experience lost its lateness still shows none there", () => {
  const we = { slug: "work-experience-i-work-experience-i-company-mid-evaluation", my_late_min: 4685, correcteds: [{ late_min: 30 }] };
  expect(withoutWorkLate(we)).toMatchObject({ my_late_min: null, correcteds: [{ late_min: null }] });
  const peer = { slug: "libft", my_late_min: 12, correcteds: [{ late_min: 3 }] };
  expect(withoutWorkLate(peer)).toBe(peer);
});

test("a project's milestone comes from the Common Core list; the rest of the 42cursus is OuterCore, anything else other", () => {
  expect(milestoneOf({ slug: "42cursus-libft", cursus: ["42cursus"] })).toBe("rank-00");
  expect(milestoneOf({ slug: "exam-rank-02", cursus: ["42cursus"] })).toBe("rank-02");
  expect(milestoneOf({ slug: "42cursus-inception-of-things", cursus: ["42cursus"] })).toBe("outer-core");
  expect(milestoneOf({ slug: "c-piscine-c-00", cursus: ["C Piscine"] })).toBe("other");
});

const ev = (o: any) => ({ id: o.id, begin: "2026-10-01 10:00", begin_ms: o.id, project: o.project, slug: o.slug, cursus: ["42cursus"], mark: o.mark ?? null,
  truant: o.truant ?? null, flag: "Ok", correcteds: [{ login: "peer02" }], corrector: { login: "peer01" }, duration_min: 15, planned_min: 15, team_id: o.id });
const logPage = (q: Record<string, string>) => new Page(new Fmt("en"), { period: "student", layout: {}, report: { profile: { login: "peer01" }, received: [], projects: [],
  given: [ev({ id: 1, project: "Libft", slug: "42cursus-libft", mark: 100 }), ev({ id: 2, project: "minishell", slug: "42cursus-minishell", truant: "peer02" }),
    ev({ id: 3, project: "Inception of Things", slug: "42cursus-inception-of-things", mark: 0, truant: "peer02" })] }, all_projects: [] } as any, "evaluations", { log: "given", ...q });
const logOf = (q: Record<string, string>) => logSection(logPage(q)).html;

test("who marked whom absent: the API names the one who reported it, the side that was there", () => {
  const f = new Fmt("en"), e = (truant: string) => ({ truant, corrector: { login: "peer01" }, correcteds: [{ login: "me" }, { login: "peer03" }] });
  expect(absence(f, "received", e("me"), "me")).toEqual([f.t("no_mark.absent_you"), f.t("log.absent_you_tip", { who: "peer01" })]); // you marked your corrector
  expect(absence(f, "received", e("peer01"), "me")).toEqual([f.t("no_mark.absent_them"), f.t("log.absent_them_tip", { who: "peer01" })]); // your corrector marked you
  expect(absence(f, "received", e("peer03"), "me")![0]).toBe(f.t("log.absent_mate")); // a teammate marked your corrector
  const g = (truant: string) => ({ truant, corrector: { login: "me" }, correcteds: [{ login: "peer02" }] });
  expect(absence(f, "given", g("me"), "me")).toEqual([f.t("no_mark.absent_you"), f.t("log.absent_you_tip", { who: "peer02" })]); // you marked them
  expect(absence(f, "given", g("peer02"), "me")).toEqual([f.t("no_mark.absent_them"), f.t("log.absent_them_tip", { who: "peer02" })]); // they marked you
  expect(absence(f, "given", { correcteds: [] }, "me")).toBeNull();
});

test("an absence reads in the log beside the mark when there is one, and the flag filter keeps those", () => {
  const f = new Fmt("en");
  expect(logOf({}).split(`>${f.t("no_mark.absent_them")}</span>`).length - 1).toBe(2);
  expect(logOf({ flag: "noshow" })).toContain(f.plural(2, "count.evaluations"));
  expect(logOf({})).toContain(`value="noshow"`);
});

test("the log filters by the project's milestone", () => {
  const f = new Fmt("en");
  expect(logOf({ milestone: "rank-00" })).toContain(f.plural(1, "count.evaluations"));
  expect(logOf({ milestone: "outer-core" })).toContain(f.plural(1, "count.evaluations"));
  expect(logOf({})).toContain(`name="milestone"`);
});

test("a login opens its page on acerezo.top in a new tab; deleted and hidden ones have no link", () => {
  const f = new Fmt("en");
  expect(shownLogin(f, "peer01")).toBe('<a class="login-link" href="https://acerezo.top/user/peer01" target="_blank" rel="noopener noreferrer">peer01</a>');
  expect(shownLogin(f, "3b3-12345")).not.toContain("<a");
  expect(shownLogin(f, "Hidden 2")).toBe("Hidden 2");
  expect(shownLogin(f, "peer01", true, false)).toBe("peer01");
});

const cancelPage = (cp: any) => new Page(new Fmt("en"), { period: "student", layout: {}, report: { profile: { login: "me" }, correction_points: cp,
  projects: [{ name: "Inception", exam: false, attempts: [{ locked: "2026-02-10 12:00", closed: "2026-02-20 10:00" }] },
    { name: "Exam Rank 05", exam: true, attempts: [{ locked: "2026-02-17 09:00", closed: null }] },
    { name: "Libft", exam: false, attempts: [{ locked: "2025-01-01 10:00", closed: "2025-01-02 10:00" }] }],
  received: [{ id: 501, project: "Inception", begin_ms: Date.parse("2026-03-01T09:30:00Z") }, { id: 502, project: "Inception", begin_ms: Date.parse("2026-02-20T09:00:00Z") }],
  given: [{ project: "CPP Module 09", begin_ms: Date.parse("2026-04-21T10:00:00Z") }, { project: "CPP Module 09", begin_ms: Date.parse("2026-04-19T10:00:00Z") },
    { project: "Libft", begin_ms: Date.parse("2026-04-01T10:00:00Z") }] }, all_projects: [] } as any, "evaluations", {});

const unesc = (t: string) => t.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const cardTips = (html: string) => [...html.matchAll(/class="cancel-card[^"]*"[^>]*data-tip="([^"]*)"/g)].map((m) => unesc(m[1]));
const cardFigures = (html: string) => [...html.matchAll(/<p class="v">([^<]*)<\/p>/g)].map((m) => m[1]);

test("cancelled evaluations: four cards, each with its dates in its tip; only yours cancelled by you carries a project estimate", () => {
  const f = new Fmt("en");
  const html = cancelledSection(cancelPage({ cancels: [
    { kind: "self", at: "2026-02-17 16:16", at_ms: Date.parse("2026-02-17T15:16:00Z") },
    { kind: "corrector", at: "2026-02-17 16:18", at_ms: Date.parse("2026-02-17T15:18:00Z") },
    { kind: "you", at: "2026-04-20 15:43", at_ms: Date.parse("2026-04-20T13:43:00Z") },
    { kind: "you", at: "2026-04-21 15:43", at_ms: Date.parse("2026-04-21T13:43:00Z") },
    { kind: "absent", at: "2026-03-01 10:00", at_ms: Date.parse("2026-03-01T09:00:00Z"), st: 501 }] }))!.html;
  expect(unesc(html)).toContain(f.t("cancel.how")); // in the title's ⓘ
  expect(html).not.toContain("<table");
  expect(cardFigures(html)).toEqual(["1", "1", "2", "1"]);
  const [self, corrector, theirs, absent] = cardTips(html);
  expect(self.split("\n")).toContain("---"); // what it says, a rule, then the dates
  expect(self).toContain("17 Feb 2026 16:16 · Inception"); // handed in, not closed, evaluated soonest after the booking
  expect(self).not.toContain("Exam Rank 05"); // exams are never booked
  expect(corrector).toContain("17 Feb 2026 16:18");
  expect(corrector).not.toContain("Inception"); // no estimate there
  expect(theirs).toContain("21 Apr 2026 15:43");
  expect(theirs).not.toContain("CPP Module 09");
  expect(absent).toContain("1 Mar 2026 10:00 · Inception"); // the evaluation stays: its project is known
});

test("a report saved before the dates were kept counts what the reasons tell and asks for a refresh", () => {
  const f = new Fmt("en");
  const html = cancelledSection(cancelPage({ reasons: { "Evaluator cancelled a defense": { count: 20, sum: -8 }, "Refund for evaluator missing": { count: 1, sum: 1 } } }))!.html;
  expect(cardFigures(html)).toEqual(["–", "6", "14", "1"]);
  expect(html).toContain(f.t("cancel.refresh"));
  expect(cancelledSection(cancelPage({ reasons: {} }))).toBeNull();
});

test("the page goes: what you give back, by milestone, the log, what was cancelled, correction points, feedback, over time and when", async () => {
  const { readFileSync } = await import("node:fs");
  const doc = JSON.parse(readFileSync("../server/core/testdata/golden/mid.report.json", "utf8")), all = doc.periods.all;
  const derive = JSON.parse(readFileSync("../server/core/testdata/golden/mid.derive.json", "utf8")).all;
  const pg = new Page(new Fmt("en"), { period: "all", report: all, derive, layout: doc.layout, all_projects: all.projects, all_cursus: all.extras.cursus } as any, "evaluations", {});
  expect(evaluations(pg).map((s) => s.id).filter((id) => id !== "cancelled")).toEqual(["community", "by-group", "log", "points", "feedback", "over-time", "when"]);
});

test("By milestone always lists every group, in order, the ones with nothing greyed, as Points by source does", async () => {
  const { readFileSync } = await import("node:fs");
  const { GROUPS } = await import("../lib/graphs");
  const doc = JSON.parse(readFileSync("../server/core/testdata/golden/mid.report.json", "utf8")), all = doc.periods.all;
  const f = new Fmt("en");
  const pg = new Page(f, { period: "all", report: all, layout: doc.layout, all_projects: all.projects, all_cursus: all.extras.cursus } as any, "evaluations", {});
  const html = evaluations(pg).find((s) => s.id === "by-group")!.html;
  const table = html.slice(html.indexOf('data-panel="by-group"'), html.indexOf('data-panel="depth-projects"'));
  const names = [...table.matchAll(/<tr( class="zero")?><td class="nowrap" data-v="\d+">([^<]+)<\/td>/g)];
  // staff and deleted accounts only when there is something to show (owner, 2026-11-12)
  const shown = GROUPS.filter((g) => !["staff", "deleted", "no-cursus"].includes(g) || all.stats.by_group[g]);
  expect(names.map((m) => m[2])).toEqual(shown.map((g) => f.t(`groups.${g}`)));
  expect(names.filter((m) => m[1]).length).toBeGreaterThan(0); // groups with nothing, greyed
  expect(names.filter((m) => !m[1]).length).toBe(Object.keys(all.stats.by_group).length);
});

test("Projects you corrected takes the height of the table by milestone beside it: more rows scroll, fewer leave templates", async () => {
  const { readFileSync } = await import("node:fs");
  const doc = JSON.parse(readFileSync("../server/core/testdata/golden/mid.report.json", "utf8")), all = doc.periods.all;
  const pg = new Page(new Fmt("en"), { period: "all", report: all, layout: doc.layout, all_projects: all.projects, all_cursus: all.extras.cursus } as any, "evaluations", {});
  const html = evaluations(pg).find((s) => s.id === "by-group")!.html;
  const corrected = html.slice(html.indexOf('data-panel="depth-projects"'));
  expect(corrected).toMatch(/<div class="table-wrap fit"><table[^]*<\/table><div class="fill-rows" aria-hidden="true">/);
  expect(corrected).not.toContain("blank-rows");
});

test("Correction points: the balance at the end of each week, day by day when enlarged; each tip with what came in and went out by reason and the balance it ended with", () => {
  const f = new Fmt("en");
  const cp = { earned: 9, spent: 6, max: 5, series: [], reasons: {},
    by_month: [{ m: "2026-01", earned: 4, spent: 6, reasons: { "Earning after defense": 4, "Defense plannification": -6 } }, { m: "2026-03", earned: 5, spent: 0, reasons: { "Earning after defense": 5 } }],
    by_week: [{ w: "2026-01-05", earned: 4, spent: 6, reasons: { "Earning after defense": 4, "Defense plannification": -6 } }, { w: "2026-01-19", earned: 5, spent: 0, reasons: { "Earning after defense": 5 } }],
    by_day: [{ d: "2026-01-06", earned: 4, spent: 6, reasons: { "Earning after defense": 4, "Defense plannification": -6 } }, { d: "2026-01-20", earned: 5, spent: 0, reasons: { "Earning after defense": 5 } }] };
  const pg = new Page(f, { period: "piscine", report: { profile: { login: "me", correction_point: 3 }, correction_points: cp, received: [], given: [], projects: [] }, all_projects: [] } as any, "evaluations", {});
  const html = pointsSection(pg).html;
  const unesc = (t: string) => t.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  const tipsIn = (part: string) => [...part.matchAll(/class="ch-col ql"[^>]*data-tip="([^"]*)"/g)].map((m) => unesc(m[1]));
  const [weekly, daily] = html.split('<div class="zoom-only">');
  expect(tipsIn(weekly).length).toBe(3); // the weeks of January 5, 12 and 19
  expect(tipsIn(weekly)[0]).toContain(f.t("points.w_label", { d: f.day("2026-01-05") }));
  expect(tipsIn(weekly)[0]).toContain("Defense plannification −6");
  expect(tipsIn(weekly)[0]).toContain(f.t("points.q_balance", { n: f.num(-2) })); // the Piscine starts at 0
  expect(tipsIn(weekly)[2]).toContain(f.t("points.q_balance", { n: "3" }));
  expect(tipsIn(daily).length).toBe(15); // every day from January 6 to 20
  expect(tipsIn(daily)[0]).toContain(f.day("2026-01-06"));
  expect(tipsIn(daily)[14]).toContain(f.t("points.q_balance", { n: "3" }));
  expect(html).not.toContain(f.t("points.qline_title")); // months only for reports saved before
  // a report with weeks and no days (saved 9 to 12 Nov 2026) keeps its weeks when enlarged
  const old = pointsSection(new Page(f, { period: "piscine", report: { profile: { login: "me", correction_point: 3 }, correction_points: { ...cp, by_day: undefined }, received: [], given: [], projects: [] }, all_projects: [] } as any, "evaluations", {})).html;
  expect(old).not.toContain("zoom-only");
  expect(tipsIn(old).length).toBe(3);
  expect(unesc(html)).toContain(f.t("points.wline_note")); // in the title's ⓘ
  // the reasons beside the chart take its height: more rows scroll, fewer leave templates down to its base
  expect(html).toMatch(/<div class="table-wrap fit"><table[^]*<\/table><div class="fill-rows" aria-hidden="true">(<i><\/i>)+<\/div><\/div>/);
});

test("Correction points from a report saved before the months were kept: the balance at the end of each month from its own line, the last month labelled", () => {
  const f = new Fmt("en");
  const series = [{ x: Date.parse("2026-01-10T10:00:00Z"), y: 3 }, { x: Date.parse("2026-01-20T10:00:00Z"), y: 5 }, { x: Date.parse("2026-03-02T10:00:00Z"), y: 4 }];
  const pg = new Page(f, { period: "student", report: { generated: "2026-04-15 10:00", profile: { login: "me" }, correction_points: { earned: 2, spent: 1, max: 5, series, reasons: {} },
    received: [], given: [], projects: [] }, all_projects: [] } as any, "evaluations", {});
  const html = pointsSection(pg).html;
  expect(html.match(/class="ch-col ql"/g)?.length).toBe(4); // January to April, the report's month
  const labels = [...html.matchAll(/<div class="ch-x[^"]*"[^>]*>(.*?)<\/div>/g)][0][1];
  expect(labels).toContain(f.monthLabel("2026-04"));
  expect(html).toContain(f.t("points.refresh_note").replace(/'/g, "&#39;"));
});

test("the log keeps a long project name to 28 characters; opened, the whole name", () => {
  const long = "Bgp At Doors of Autonomous Systems is Simple";
  const pg = new Page(new Fmt("en"), { period: "student", layout: {}, report: { profile: { login: "peer01" }, received: [], projects: [],
    given: [ev({ id: 1, project: long, slug: "x", mark: 100 })] }, all_projects: [] } as any, "evaluations", { log: "given" });
  const html = logSection(pg).html;
  expect(html).toContain("<summary>Bgp At Doors of Autonomous...</summary>");
  expect(html).toContain(`<div class="pop-panel"><b>${long}</b>`);
  expect(html).toContain(`<option value="${long}">`); // the filter keeps whole names
});

test("the feedback 42 fills in when the student did not is named as that, never as someone unknown; real ones link their author", () => {
  const auto = { by: null, rating: 4, comment: "You failed to complete this feedback within the allocated time (this is very wrong), so we did it for you (do it next time)." };
  expect(autoFeedback(auto)).toBe(true);
  expect(autoFeedback({ by: "peer02", rating: 4, comment: auto.comment })).toBe(false);
  expect(autoFeedback({ by: null, rating: 3, comment: "fine" })).toBe(false);
  const f = new Fmt("en");
  const pg = new Page(f, { period: "student", layout: {}, report: { profile: { login: "peer01" }, received: [], projects: [],
    given: [{ ...ev({ id: 1, project: "Libft", slug: "42cursus-libft", mark: 100 }), feedbacks: [auto, { by: "peer02", rating: 5, comment: "ok" }] }] }, all_projects: [] } as any, "evaluations", { log: "given" });
  const html = logSection(pg).html;
  expect(html).toContain(f.t("log.feedback_auto", { rating: 4 }));
  expect(html).not.toContain("Feedback by ?");
  expect(html).toContain('Feedback by <a class="login-link" href="https://acerezo.top/user/peer02"');
});

test("42's automatic feedback is left out of Feedback's averages and its list, and named apart in a list that opens", async () => {
  const { readFileSync } = await import("node:fs");
  const doc = JSON.parse(readFileSync("../server/core/testdata/golden/mid.report.json", "utf8")), all = doc.periods.all;
  const f = new Fmt("en");
  const feedbackOf = (report: any) => evaluations(new Page(f, { period: "all", report, layout: doc.layout, all_projects: report.projects, all_cursus: report.extras.cursus } as any, "evaluations", {})).find((s) => s.id === "feedback")!.html;
  const before = feedbackOf(all);
  expect(before).not.toContain("auto-apart");
  const auto = { by: null, rating: 4, comment: "You failed to complete this feedback within the allocated time (this is very wrong), so we did it for you (do it next time).", auto: true };
  const given = all.given.map((e: any, i: number) => (i === 0 ? { ...e, feedbacks: [...e.feedbacks, auto] } : e));
  const after = feedbackOf({ ...all, given });
  const head = (html: string) => html.slice(0, html.indexOf("<details"));
  expect(after.slice(0, after.indexOf('<details class="apart auto-apart"'))).toBe(before.slice(0, after.indexOf('<details class="apart auto-apart"'))); // not one figure moved
  expect(after).toContain(f.plural(1, "feedback.auto_apart"));
  expect(after).toContain(given[0].project);
  expect(head(after)).not.toContain("by ?");
});

test("staff get their own row by milestone, taken from the group the report counted each one in; nothing is lost", () => {
  const stats = { "outer-core": { received: 4, received_out: 1, given: 2, given_out: 0 }, "no-cursus": { received: 3, received_out: 0, given: 1, given_out: 0 } };
  const received = [{ corrector: { login: "boss", staff: true }, outstanding: true }, { corrector: { login: "boss", staff: true } }, { corrector: { login: "tutor", staff: true } }, { corrector: { login: "peer01" } }];
  const given = [{ correcteds: [{ login: "tutor", staff: true }, { login: "me" }] }];
  const got = staffApart(stats, received, given, "me", new Map([["boss", "outer-core"]]));
  expect(got.staff).toEqual({ received: 3, received_out: 1, given: 1, given_out: 0 });
  expect(got["outer-core"]).toEqual({ received: 2, received_out: 0, given: 2, given_out: 0 });
  expect(got["no-cursus"]).toEqual({ received: 2, received_out: 0, given: 0, given_out: 0 });
  expect(staffApart(stats, [{ corrector: { login: "peer01" } }], [], "me", new Map())).toEqual(stats);
});
