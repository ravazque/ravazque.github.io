import { expect, test } from "vitest";
import { outward, sortBodies, sortRows } from "./behave";
import { csv, parseCsv } from "./table";

const row = (...vals: string[]) => {
  const tr = document.createElement("tr");
  for (const v of vals) { const td = document.createElement("td"); td.dataset.v = v; tr.append(td); }
  return tr;
};
const body = (v: string, group = false) => {
  const tb = document.createElement("tbody");
  if (group) tb.className = "group";
  tb.append(row(v));
  tb.dataset.name = v;
  return tb;
};

test("numbers sort numerically and empty cells go last either way", () => {
  const rows = [row("10"), row(""), row("9"), row("100")];
  expect(sortRows(rows, 0, 1, true).map((r) => (r.firstChild as HTMLElement).dataset.v)).toEqual(["9", "10", "100", ""]);
  expect(sortRows(rows, 0, -1, true).map((r) => (r.firstChild as HTMLElement).dataset.v)).toEqual(["100", "10", "9", ""]);
});

test("text sorts by the chosen column", () => {
  const rows = [row("1", "beta"), row("2", "alpha")];
  expect(sortRows(rows, 1, 1, false).map((r) => (r.children[1] as HTMLElement).dataset.v)).toEqual(["alpha", "beta"]);
});

test("a grouped table sorts inside each group and keeps the group headers in place", () => {
  const bodies = [body("rank-00", true), body("3"), body("1"), body("rank-01", true), body("9"), body("2"), body("5")];
  expect(sortBodies(bodies, 0, 1, true).map((b) => b.dataset.name)).toEqual(["rank-00", "1", "3", "rank-01", "2", "5", "9"]);
});

test("CSV previews read quoted fields, doubled quotes and line breaks inside quotes", () => {
  expect(parseCsv('a,b\n"x, y","say ""hi"""\r\n"two\nlines",3\n')).toEqual([["a", "b"], ["x, y", 'say "hi"'], ["two\nlines", "3"]]);
  expect(parseCsv("a,b")).toEqual([["a", "b"]]);
  expect(parseCsv("")).toEqual([]);
  expect(parseCsv(csv([["x, y", 'say "hi"', null]]))).toEqual([["x, y", 'say "hi"', ""]]);
});

test("a ring node's tip goes outwards in one of eight directions", () => {
  expect(outward(-90)).toEqual([0, -1]); // top: above, centred
  expect(outward(90)).toEqual([0, 1]); // bottom: below, centred
  expect(outward(0)).toEqual([1, 0]); // right: beside
  expect(outward(180)).toEqual([-1, 0]);
  expect(outward(45)).toEqual([1, 1]); // bottom right: below and to the right
  expect(outward(-135)).toEqual([-1, -1]); // top left
  expect(outward(80)).toEqual([0, 1]); // nearly at the bottom still opens straight down
});
