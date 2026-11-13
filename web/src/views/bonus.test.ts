import { expect, test } from "vitest";
import { Fmt } from "../fmt";
import { dropDays, leaving, tierRows, underAt, weekFigure, type Tier } from "./bonus";
import { coalition } from "./coalition";
import { Page } from "./page";

const f = new Fmt("en");
const NOW = Date.UTC(2026, 10, 7, 10); // Sat 7 Nov 2026, 11:00 in Madrid
const iso = (hoursFromNow: number) => new Date(NOW + hoursFromNow * 36e5).toISOString();
const tier = (state: string, o: Partial<Tier> = {}): Tier => ({ hours: 50, points: 500, window_h: 52, need_h: 0, last: null, from: null, state, until: null, ...o });

test("hours leaving the window, by day: how many, what stays, and what leaves when", () => {
  const log = [{ begin_ms: Date.UTC(2026, 9, 29, 22), seconds: 2 * 3600, host: "c1r2s3" }];
  const days = dropDays(f, [
    { at: "2026-11-05T10:00:00.000Z", hours: 0.0 },
    { at: "2026-11-05T11:00:00.000Z", hours: 0.4 },
    { at: "2026-11-05T22:00:00.000Z", hours: 2 }, // 23:00 in Madrid: past midnight, on both days
  ], log);
  expect(days.map((d) => [d.day, d.hours, d.left])).toEqual([["Thu 5 Nov", 1.4, 1], ["Fri 6 Nov", 1, 0]]);
  expect(days[0].rows.map((r) => [r.from, r.to, r.hours, r.session])).toEqual([
    ["12:00", "12:24", 0.4, "Thu 29 Oct"], ["23:00", "00:00", 1, "Thu 29 Oct · c1r2s3"]]);
  expect(days[1].rows.map((r) => [r.from, r.to, r.hours])).toEqual([["00:00", "01:00", 1]]);
});

test("each day opens to the times and the session leaving, and what is left is said once", () => {
  const html = leaving(f, [{ at: iso(1), hours: 4 }, { at: iso(24), hours: 48 }], []);
  expect(html.match(/<details class="drop-day">/g)?.length).toBe(4);
  expect(html).toContain("Sat 7 Nov");
  expect(html).toContain("48:00h left");
  expect(html).toContain("12:00–16:00");
  expect(html).toContain("session of Sat 31 Oct");
  expect(html).not.toContain("Under 50h"); // the tiers already say when (owner, 2026-11-12)
  expect(leaving(f, [], [])).toBe(""); // nothing leaving: nothing said (owner, 2026-11-13)
});

test("the moment you drop under a line, if you ever do", () => {
  const drops = [{ at: iso(1), hours: 4 }, { at: iso(24), hours: 10 }];
  expect(underAt(52, drops, 50)).toBe(NOW + 3 * 36e5);
  expect(underAt(52, drops, 45)).toBe(NOW + 27 * 36e5);
  expect(underAt(52, drops, 30)).toBeNull(); // the whole week never takes it that low
  expect(underAt(40, drops, 50)).toBeNull(); // already under
});

test("a bonus waiting says when it resets and how long is left", () => {
  const html = tierRows(f, [tier("cooldown", { from: iso(5 * 24 + 1), until: iso(5 * 24 + 1), last: iso(-40) })], true, 52, [], NOW);
  expect(html).toContain("Waiting");
  expect(html).toContain("resets Thu 12 Nov, 12:00 · in 5d 1h");
  expect(html).not.toContain("earliest");
});

test("a bonus with hours to go says how many and the earliest logout", () => {
  const html = tierRows(f, [tier("short", { hours: 80, points: 1000, need_h: 27.5, until: iso(30) })], true, 52.5, [], NOW);
  expect(html).toContain("27:30h to go");
  expect(html).toContain("earliest Sun 8 Nov, 17:00");
});

test("over the line: at the next logout when logged in, before dropping under it when not", () => {
  const drops = [{ at: iso(1), hours: 4 }];
  expect(tierRows(f, [tier("ready", { until: iso(0) })], true, 52, drops, NOW)).toContain(f.t("coal.s_next_logout"));
  const out = tierRows(f, [tier("ready", { until: iso(0) })], false, 52, drops, NOW);
  expect(out).toContain("log in and out before Sat 7 Nov, 14:00");
  expect(out).not.toContain("stay until");
});

test("Coalition: rows, the days leaving and the history, no chart of the coming days", () => {
  const W = { at: iso(0), open: false, sessions: [], last: {} };
  const t = tier("ready", { until: iso(0), last: iso(-400) });
  const pg = new Page(f, { report: { logtime_bonus: W, coalition_points: { bonuses: [{ at: iso(-400), hours: 50, points: 500 }] }, projects: [] },
    derive: { logtime_bonus: [t], logtime_drops: [{ at: iso(1), hours: 4 }] }, all_projects: [] } as any, "coalition", {});
  const html = coalition(pg).map((s) => s.html).join("");
  expect(html).not.toContain('class="fc');
  expect(html).toContain('<details class="drop-day">');
  expect(html).toContain("Every bonus so far");
  expect(html).not.toContain(f.t("bonus.got", { hours: 50 }) + "</b><p");
});

test("a big figure keeps the space before its unit, the rows and days do not; hours read as hours and minutes", () => {
  expect(weekFigure(f, 62.4)).toContain("62:24<small> h</small>");
  expect(tierRows(f, [tier("short", { need_h: 27.5 })], true, 52.5, [], NOW)).toContain("27:30h to go");
});

test("Every bonus so far shows templates of the rows to come while it has room, and none once it is full", () => {
  const W = { at: iso(0), open: false, sessions: [], last: {} };
  const html = (bonuses: any[]) => coalition(new Page(f, { report: { logtime_bonus: W, coalition_points: { bonuses }, projects: [] },
    derive: { logtime_bonus: [tier("short")], logtime_drops: [] }, all_projects: [] } as any, "coalition", {})).map((s) => s.html).join("");
  const b = { at: iso(-400), hours: 50, points: 500 };
  expect(html([b, b])).toContain('<li class="fill" aria-hidden="true"><p>' + f.t("bonus.room") + "</p>");
  expect(html([])).toContain('class="fill"');
  expect(html(Array(24).fill(b))).not.toContain('class="fill"');
});
