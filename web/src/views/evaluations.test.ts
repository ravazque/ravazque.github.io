import { expect, test } from "vitest";
import { Fmt } from "../fmt";
import { absence, binLabels, cancelledSection, deletedApart, lateText, logSection, milestoneOf, seatMatch, seatOptions, teamCell, withoutWorkLate, workExperience } from "./evaluations";
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
  expect(summary).toContain("+1");
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
