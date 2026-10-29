import { describe, expect, test } from "vitest";
import cases from "./testdata/fmt-cases.json";
import { Fmt, pyRound } from "./fmt";

// expectations printed by v1's Python formatter (web/app/dash/fmt.py)
for (const lang of ["en", "es"] as const) {
  describe(`fmt ${lang}`, () => {
    const f = new Fmt(lang);
    const c = (cases as any)[lang];
    test("num", () => c.num.forEach(([v, d, want]: any) => expect(f.num(v, d)).toBe(want)));
    test("hm", () => c.hm.forEach(([s, want]: any) => expect(f.hm(s)).toBe(want)));
    test("day", () => c.day.forEach(([s, w, want]: any) => expect(f.day(s, w)).toBe(want)));
    test("stamp", () =>
      c.stamp.forEach(([ms, want]: any) => expect(f.stamp(ms)).toBe(want)));
    test("monthLabel", () => c.month_label.forEach(([m, want]: any) => expect(f.monthLabel(m)).toBe(want)));
    test("plural", () => c.plural.forEach(([n, k, want]: any) => expect(f.plural(n, k)).toBe(want)));
    test("pct", () => c.pct.forEach(([a, b, want]: any) => expect(f.pct(a, b)).toBe(want)));
  });
}

test("pyRound rounds exact ties to even, like Python", () => {
  expect(pyRound(0.125, 2)).toBe(0.12);
  expect(pyRound(0.375, 2)).toBe(0.38);
  expect(pyRound(2.675, 2)).toBe(2.67); // 2.675 is 2.67499999… as a double
  expect(pyRound(2.5, 0)).toBe(2);
  expect(pyRound(-3.25, 1)).toBe(-3.2);
});

test("missing keys show the key; vars fill in", () => {
  const f = new Fmt("en");
  expect(f.t("no.such.key")).toBe("no.such.key");
  expect(f.t("home.promo", { rank: "3", size: "9" })).toBe("#3 of 9 in your promo");
});

test("dates read as 29 Oct 2026, with the time when there is one", () => {
  const f = new Fmt("es");
  expect(f.dayTime("2026-10-29 13:15")).toBe("29 oct 2026, 13:15");
  expect(f.dayTime("2026-10-29T13:15:00")).toBe("29 oct 2026, 13:15");
  expect(f.dayTime("2026-10-29")).toBe("29 oct 2026");
  expect(f.dayTime("")).toBe("–");
});
