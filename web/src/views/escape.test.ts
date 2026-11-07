import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { Fmt } from "../fmt";
import { campus } from "./campus";
import { coalition } from "./coalition";
import { evaluations } from "./evaluations";
import { Page, type PageKey, type Section } from "./page";
import { people } from "./people";
import { profile } from "./profile";
import { projects } from "./projects";

const BAD = `"'><x-xss onerror="1">`;
const KEEP = new Set(["group", "dir"]); // the app's own words, which it looks up, not text from the API
/** The same document with this text after every string that isn't a date: the pages draw it as markup (v-html). */
const poison = (v: any): any => (typeof v === "string" ? (/^\d{4}-\d\d/.test(v) ? v : v + BAD)
  : Array.isArray(v) ? v.map(poison) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, KEEP.has(k) ? x : poison(x)])) : v);

for (const name of ["mid", "alumni"]) {
  test(`no value from the API becomes markup on any page (${name})`, () => {
    const doc = poison(JSON.parse(readFileSync(`../server/core/testdata/golden/${name}.report.json`, "utf8")));
    const all = doc.periods.all, derive = poison(JSON.parse(readFileSync(`../server/core/testdata/golden/${name}.derive.json`, "utf8"))).all;
    const f = new Fmt("en");
    const view = { period: "all", report: all, derive, layout: doc.layout, connections: doc.connections?.all, network: doc.network, promo: doc.promo, coalitions: doc.coalitions,
      all_projects: all.projects, all_cursus: all.extras.cursus, seat_days: 60 } as any;
    const pages: [PageKey, (pg: Page) => Section[]][] = [["projects", projects], ["evaluations", evaluations], ["coalition", coalition], ["people", people], ["campus", campus],
      ["home", (pg) => profile(pg)]];
    for (const [key, build] of pages) {
      const box = document.createElement("div");
      box.innerHTML = build(new Page(f, view, key, {})).map((s) => s.html).join("");
      expect([key, box.querySelectorAll("x-xss").length, box.querySelectorAll("[onerror]").length]).toEqual([key, 0, 0]);
    }
  });
}
