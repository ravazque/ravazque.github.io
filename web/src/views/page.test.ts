import { expect, test } from "vitest";
import { daysTo, erased, monthsBetween, myTrack } from "./page";

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
  const en = (await import("@data/i18n/en.json")).default as Record<string, unknown>;
  const es = (await import("@data/i18n/es.json")).default as Record<string, unknown>;
  for (const [page, id, key] of WIDGETS) {
    expect(readFileSync(`src/views/${page}.ts`, "utf8"), `${page}#${id}`).toMatch(new RegExp(`id: "${id}"`));
    expect(key in en && key in es, key).toBe(true);
  }
});
