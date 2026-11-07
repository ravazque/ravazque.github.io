import { expect, test } from "vitest";
import { Fmt } from "../fmt";
import { table } from "./table";

test("a table can keep its room: empty rows in a foot of their own, which sorting never touches", () => {
  const f = new Fmt("en"), cols = [{ k: "a", t: "A" }, { k: "b", t: "B" }];
  const html = table(f, cols, [{ a: 1, b: 2 }, { a: 3, b: 4 }], { label: "x", minRows: 5 });
  expect(html.match(/<tbody/g)?.length).toBe(1);
  expect(html).toContain('<tfoot class="blank-rows" aria-hidden="true">');
  expect(html.match(/<td colspan="2">/g)?.length).toBe(3);
  expect(table(f, cols, [{ a: 1, b: 2 }], { label: "x" })).not.toContain("tfoot");
  expect(table(f, cols, [1, 2, 3].map((a) => ({ a, b: a })), { label: "x", minRows: 2 })).not.toContain("tfoot");
});
