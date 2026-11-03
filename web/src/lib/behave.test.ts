import { expect, test } from "vitest";
import { floatAt, hintScroll, outward, sortBodies, sortRows } from "./behave";
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

test("a scroll box marks each side where more waits and how thick its scrollbars are", () => {
  const box = document.createElement("div");
  box.className = "table-wrap";
  const geo = { scrollWidth: 500, clientWidth: 300, scrollLeft: 0, scrollHeight: 400, clientHeight: 200, scrollTop: 50, offsetWidth: 310, offsetHeight: 212 };
  for (const [k, v] of Object.entries(geo)) Object.defineProperty(box, k, { value: v, configurable: true });
  document.body.append(box);
  hintScroll(document);
  expect(["more-t", "more", "more-l", "more-r"].filter((c) => box.classList.contains(c))).toEqual(["more-t", "more", "more-r"]);
  expect([box.style.getPropertyValue("--sb-w"), box.style.getPropertyValue("--sb-h")]).toEqual(["10px", "12px"]);
  box.remove();
});

test("a floating panel opens under what opened it, or above when there is no room below, always on screen", () => {
  const r = { left: 100, right: 260, top: 300, bottom: 320 } as DOMRect;
  expect(floatAt(r, 240, 150, 1000, 800)).toEqual({ left: 100, top: 326 });
  expect(floatAt(r, 240, 600, 1000, 800)).toEqual({ left: 100, top: 192 }); // fits neither side: as low as the screen allows
  expect(floatAt({ ...r, top: 700, bottom: 720 } as DOMRect, 240, 150, 1000, 800)).toEqual({ left: 100, top: 544 });
  expect(floatAt({ ...r, left: 900, right: 990 } as DOMRect, 240, 150, 1000, 800)).toEqual({ left: 752, top: 326 });
});
