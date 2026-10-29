import { expect, test } from "vitest";
import { erased, myTrack } from "./page";

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
