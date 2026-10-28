import { expect, test } from "vitest";
import { type Copy, type Shelf, keepCopy, restore } from "./copy";

function memShelf(): Shelf & { m: Map<string, Copy> } {
  const m = new Map<string, Copy>();
  return { m, get: async (l) => m.get(l), put: async (l, c) => { m.set(l, c); }, del: async (l) => { m.delete(l); } };
}

const bytes = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;

test("keepCopy stores the server's bytes with their signature, once", async () => {
  const shelf = memShelf();
  let calls = 0;
  const fetcher = async () => { calls++; return new Response("{\"a\":1}", { headers: { "X-Report-Sig": "S1" } }); };
  await keepCopy(shelf, "tnova", fetcher);
  expect(shelf.m.get("tnova")?.sig).toBe("S1");
  await keepCopy(shelf, "tnova", fetcher);
  expect(calls).toBe(2); // asked again (the signature tells), stored once
});

test("restore posts the copy with its signature and CSRF token", async () => {
  const shelf = memShelf();
  shelf.m.set("tnova", { sig: "S1", body: bytes("{}") });
  let sent: RequestInit | undefined;
  const ok = await restore(shelf, "tnova", "C", async (_p, init) => { sent = init; return new Response(null, { status: 204 }); });
  const h = new Headers(sent?.headers);
  expect(ok).toBe(true);
  expect(h.get("X-Report-Sig")).toBe("S1");
  expect(h.get("X-CSRF-Token")).toBe("C");
});

test("a refused copy is forgotten; no copy means a fresh extraction", async () => {
  const shelf = memShelf();
  shelf.m.set("tnova", { sig: "old", body: bytes("{}") });
  expect(await restore(shelf, "tnova", "C", async () => new Response(null, { status: 400 }))).toBe(false);
  expect(shelf.m.has("tnova")).toBe(false);
  expect(await restore(shelf, "tnova", "C", async () => new Response(null, { status: 204 }))).toBe(false);
});
