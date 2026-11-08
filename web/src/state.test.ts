import { beforeEach, expect, test } from "vitest";
import { hasPin, loadPins, moveWidget, pins, relabelStars, setActivity, setWidget, togglePin } from "./state";

beforeEach(() => { localStorage.clear(); pins.login = ""; });

/** A profile that has been through the first load: the tests below look at what they add themselves. */
const fresh = (login: string) => { localStorage.setItem(`widgets:${login}:seeded`, "2"); loadPins(login); };

test("stars and widgets are kept per login, in the order they were added, and a second toggle takes one away", () => {
  fresh("peer01");
  togglePin("stars", { page: "campus", id: "seats", label: "Where you sat" });
  togglePin("stars", { page: "people", id: "who", label: "Who evaluated you" });
  togglePin("widgets", { page: "projects", id: "exams", label: "" });
  togglePin("stars", { page: "campus", id: "seats", label: "Where you sat" });
  expect(pins.stars.map((p) => p.id)).toEqual(["who"]);
  expect(hasPin("widgets", "projects", "exams")).toBe(true);
  pins.login = "";
  fresh("peer02");
  expect(pins.stars).toEqual([]);
  loadPins("peer01");
  expect(pins.stars.map((p) => p.id)).toEqual(["who"]);
  expect(pins.widgets.map((p) => p.id)).toEqual(["exams"]);
});

test("a broken saved list reads as empty, and titles follow the language once the page shows", () => {
  localStorage.setItem("stars:peer03", "{not json");
  loadPins("peer03");
  expect(pins.stars).toEqual([]);
  togglePin("stars", { page: "people", id: "who", label: "Who evaluated you" });
  relabelStars("people", new Map([["who", "Quién te evaluó"]]));
  expect(pins.stars[0].label).toBe("Quién te evaluó");
  expect(JSON.parse(localStorage.getItem("stars:peer03")!)[0].label).toBe("Quién te evaluó");
});

test("widgets move to any place, keep their size and column, and read back as saved", () => {
  fresh("peer04");
  for (const id of ["a", "b", "c", "d"]) togglePin("widgets", { page: "people", id, label: "" });
  moveWidget(0, 3); // a before d
  expect(pins.widgets.map((p) => p.id)).toEqual(["b", "c", "a", "d"]);
  moveWidget(3, 0); // d first
  expect(pins.widgets.map((p) => p.id)).toEqual(["d", "b", "c", "a"]);
  moveWidget(1, 4); // b last
  expect(pins.widgets.map((p) => p.id)).toEqual(["d", "c", "a", "b"]);
  setWidget("people", "c", { wide: true });
  setWidget("people", "a", { side: "right" });
  setWidget("people", "a", { side: null });
  setWidget("people", "b", { side: "left" });
  pins.login = "";
  loadPins("peer04");
  expect(pins.widgets).toEqual([
    { page: "people", id: "d", label: "" }, { page: "people", id: "c", label: "", wide: true },
    { page: "people", id: "a", label: "" }, { page: "people", id: "b", label: "", side: "left" }]);
});

test("the next refresh falls on the next quarter of the hour", async () => {
  const { untilQuarter } = await import("./state");
  expect(untilQuarter(new Date(2026, 10, 1, 12, 14, 30))).toBe(30_000);
  expect(untilQuarter(new Date(2026, 10, 1, 12, 15, 0))).toBe(15 * 60_000);
  expect(untilQuarter(new Date(2026, 10, 1, 12, 59, 59, 500))).toBe(500);
});

test("a new profile starts with Contribution, Rhythm, the bonus and the evaluation log, once: taken away, they stay away", () => {
  loadPins("peer05");
  expect(pins.widgets.map((p) => `${p.page}:${p.id}`)).toEqual(["evaluations:community", "campus:rhythm", "coalition:bonus", "evaluations:log"]);
  togglePin("widgets", { page: "campus", id: "rhythm", label: "" });
  pins.login = "";
  loadPins("peer05");
  expect(pins.widgets.map((p) => p.id)).toEqual(["community", "bonus", "log"]);
});

test("a list saved before keeps its own and gains the four once", () => {
  localStorage.setItem("widgets:peer06", JSON.stringify([{ page: "projects", id: "exams", label: "" }, { page: "campus", id: "rhythm", label: "" }]));
  loadPins("peer06");
  expect(pins.widgets.map((p) => p.id)).toEqual(["community", "bonus", "log", "exams", "rhythm"]);
});

test("a profile given the first three gets the evaluation log once, under the bonus", () => {
  localStorage.setItem("widgets:peer08", JSON.stringify([{ page: "evaluations", id: "community", label: "" }, { page: "coalition", id: "bonus", label: "" }, { page: "projects", id: "exams", label: "" }]));
  localStorage.setItem("widgets:peer08:seeded", "1");
  loadPins("peer08");
  expect(pins.widgets.map((p) => p.id)).toEqual(["community", "bonus", "log", "exams"]);
  togglePin("widgets", { page: "evaluations", id: "log", label: "" });
  pins.login = "";
  loadPins("peer08");
  expect(pins.widgets.map((p) => p.id)).toEqual(["community", "bonus", "exams"]);
  localStorage.setItem("widgets:peer09", JSON.stringify([{ page: "projects", id: "exams", label: "" }]));
  localStorage.setItem("widgets:peer09:seeded", "1");
  loadPins("peer09"); // the bonus taken away: the log goes last
  expect(pins.widgets.map((p) => p.id)).toEqual(["exams", "log"]);
});

test("Activity can be minimized or hidden, per login", () => {
  loadPins("peer07");
  expect(pins.activity).toBe("");
  setActivity("min");
  pins.login = "";
  loadPins("peer08");
  expect(pins.activity).toBe("");
  loadPins("peer07");
  expect(pins.activity).toBe("min");
  setActivity("off");
  expect(localStorage.getItem("activity:peer07")).toBe("off");
  setActivity("");
  expect(localStorage.getItem("activity:peer07")).toBe("");
});
