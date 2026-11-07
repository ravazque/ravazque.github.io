import { expect, test } from "vitest";
import { binLabels, seatMatch } from "./evaluations";

test("the log's seat filter: you with no session open, or the other side not logged where it was looked up", () => {
  const recv = (my_host: string | null, checked: boolean, other_host: string | null) => ({ my_host, other_host_checked: checked, other_host });
  expect(seatMatch("received", "me", recv(null, false, null))).toBe(true);
  expect(seatMatch("received", "me", recv("c1r1s1", false, null))).toBe(false);
  expect(seatMatch("received", "other", recv("c1r1s1", true, null))).toBe(true);
  expect(seatMatch("received", "other", recv("c1r1s1", false, null))).toBe(false);
  expect(seatMatch("received", "other", recv(null, true, "c2r1s1"))).toBe(false);
  const given = (checked: boolean, hosts: (string | null)[]) => ({ my_host: "c1r1s1", other_host_checked: checked, correcteds: hosts.map((host) => ({ host })) });
  expect(seatMatch("given", "other", given(true, ["c1r1s2", null]))).toBe(true);
  expect(seatMatch("given", "other", given(true, ["c1r1s2"]))).toBe(false);
  expect(seatMatch("given", "other", given(false, [null]))).toBe(false);
  expect(seatMatch("given", "", given(false, [null]))).toBe(true);
});

test("the seat filter by cluster keeps the evaluations you had in that cluster", () => {
  expect(seatMatch("received", "c1", { my_host: "c1r2s3" })).toBe(true);
  expect(seatMatch("given", "c2", { my_host: "c1r2s3" })).toBe(false);
  expect(seatMatch("received", "c1", { my_host: null })).toBe(false);
});

test("a histogram's bins carry their unit beside the numbers", () => {
  expect(binLabels([0, 1, 3], "h")).toEqual(["0–1h", "1–3h", "3+h"]);
  expect(binLabels([0, 15], "m")).toEqual(["0–15m", "15+m"]);
});
