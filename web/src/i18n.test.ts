import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import en from "@data/i18n/en.json";
import es from "@data/i18n/es.json";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|vue)$/.test(n) && !n.endsWith(".test.ts") ? [p] : [];
  });
}

test("every literal text key the app uses exists in English and Spanish", () => {
  const keys = new Set<string>();
  for (const file of files("src")) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/\b(?:t|plural|has)\(\s*(?:[^,()]+,\s*)?"([a-z_]+(?:\.[a-z0-9_-]+)+)"/g)) keys.add(m[1]);
    for (const m of src.matchAll(/\bt\("([a-z_]+(?:\.[a-z0-9_-]+)+)"/g)) keys.add(m[1]);
  }
  expect(keys.size).toBeGreaterThan(200);
  const missing = [...keys].filter((k) => !(k in en) || !(k in es));
  expect(missing).toEqual([]);
});

test("hours and minutes stick to their number, in every text", () => {
  const texts = (o: any): string[] => (typeof o === "string" ? [o] : Array.isArray(o) ? o.flatMap(texts) : o && typeof o === "object" ? Object.values(o).flatMap(texts) : []);
  for (const dict of [en, es]) expect(texts(dict).filter((t) => /(\d|\})[\s\u00a0](h|m|min)(?!\p{L})/u.test(t))).toEqual([]);
});
