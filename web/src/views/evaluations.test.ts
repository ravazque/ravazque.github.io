import { expect, test } from "vitest";
import { binLabels, deletedApart, seatMatch } from "./evaluations";

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

test("deleted accounts get their own row by milestone, and no evaluation is lost on the way", () => {
  const stats = { "rank-01": { received: 2, received_out: 0, given: 1, given_out: 0 }, "no-cursus": { received: 3, received_out: 1, given: 5, given_out: 2 } };
  const received = [{ corrector: { login: "3b3-1" }, outstanding: true }, { corrector: { login: "3b3-2" }, outstanding: false }, { corrector: { login: "peer01" } }];
  const given = [{ correcteds: [{ login: "3b3-1" }, { login: "me" }], outstanding: true }, { correcteds: [{ login: "peer02" }], outstanding: false }];
  const got = deletedApart(stats, received, given, "me");
  expect(got.deleted).toEqual({ received: 2, received_out: 1, given: 1, given_out: 1 });
  expect(got["no-cursus"]).toEqual({ received: 1, received_out: 0, given: 4, given_out: 1 });
  expect(got["rank-01"]).toEqual(stats["rank-01"]);
  const sum = (k: string) => Object.values(got).reduce((n: number, r: any) => n + r[k], 0);
  expect([sum("received"), sum("given")]).toEqual([5, 6]);
  expect(deletedApart(stats, [{ corrector: { login: "peer01" } }], [], "me")).toEqual(stats);
});
