import { beforeEach, expect, test } from "vitest";
import { hasPin, loadPins, moveWidget, pins, relabelStars, setWidget, togglePin } from "./state";

beforeEach(() => { localStorage.clear(); pins.login = ""; });

/** A profile that has been through the first load: the tests below look at what they add themselves. */
const fresh = (login: string) => { localStorage.setItem(`widgets:${login}:seeded`, "5"); localStorage.setItem(`stars:${login}`, "[]"); loadPins(login); };

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

test("a new profile starts with Contribution, Rhythm, the bonus, the evaluation log, Cancelled evaluations, Feedback and Where, once: taken away, they stay away", () => {
  loadPins("peer05");
  expect(pins.widgets.map((p) => `${p.page}:${p.id}`)).toEqual(["evaluations:community", "campus:rhythm", "coalition:bonus", "evaluations:log", "evaluations:cancelled", "evaluations:feedback", "campus:where"]);
  togglePin("widgets", { page: "campus", id: "rhythm", label: "" });
  pins.login = "";
  loadPins("peer05");
  expect(pins.widgets.map((p) => p.id)).toEqual(["community", "bonus", "log", "cancelled", "feedback", "where"]);
});

test("a list saved before keeps its own and gains the seven once", () => {
  localStorage.setItem("widgets:peer06", JSON.stringify([{ page: "projects", id: "exams", label: "" }, { page: "campus", id: "rhythm", label: "" }]));
  loadPins("peer06");
  expect(pins.widgets.map((p) => p.id)).toEqual(["community", "bonus", "log", "cancelled", "feedback", "where", "exams", "rhythm"]);
});

test("a profile given the first three gets the evaluation log once, under the bonus", () => {
  localStorage.setItem("widgets:peer08", JSON.stringify([{ page: "evaluations", id: "community", label: "" }, { page: "coalition", id: "bonus", label: "" }, { page: "projects", id: "exams", label: "" }]));
  localStorage.setItem("widgets:peer08:seeded", "1");
  loadPins("peer08");
  expect(pins.widgets.map((p) => p.id)).toEqual(["community", "bonus", "log", "cancelled", "feedback", "where", "exams"]);
  togglePin("widgets", { page: "evaluations", id: "log", label: "" });
  pins.login = "";
  loadPins("peer08");
  expect(pins.widgets.map((p) => p.id)).toEqual(["community", "bonus", "cancelled", "feedback", "where", "exams"]);
  localStorage.setItem("widgets:peer09", JSON.stringify([{ page: "projects", id: "exams", label: "" }]));
  localStorage.setItem("widgets:peer09:seeded", "1");
  loadPins("peer09"); // the bonus taken away: the log goes last
  expect(pins.widgets.map((p) => p.id)).toEqual(["exams", "log", "cancelled", "feedback", "where"]);
});

test("a profile given the first four gets Where once, under the evaluation log (last when the log was taken away)", () => {
  localStorage.setItem("widgets:peer10", JSON.stringify([{ page: "evaluations", id: "log", label: "" }, { page: "projects", id: "exams", label: "" }]));
  localStorage.setItem("widgets:peer10:seeded", "2");
  loadPins("peer10");
  expect(pins.widgets.map((p) => p.id)).toEqual(["log", "cancelled", "feedback", "where", "exams"]);
  localStorage.setItem("widgets:peer11", JSON.stringify([{ page: "projects", id: "exams", label: "" }]));
  localStorage.setItem("widgets:peer11:seeded", "2");
  loadPins("peer11");
  expect(pins.widgets.map((p) => p.id)).toEqual(["exams", "where", "feedback", "cancelled"]); // the log taken away: it goes last
});

test("a profile given the first six gets Cancelled evaluations once, under the evaluation log and over Feedback", () => {
  localStorage.setItem("widgets:peer13", JSON.stringify([{ page: "evaluations", id: "log", label: "" }, { page: "evaluations", id: "feedback", label: "" }, { page: "campus", id: "where", label: "" }]));
  localStorage.setItem("widgets:peer13:seeded", "4");
  loadPins("peer13");
  expect(pins.widgets.map((p) => p.id)).toEqual(["log", "cancelled", "feedback", "where"]);
});

test("a profile given the first five gets Feedback once, under the evaluation log", () => {
  localStorage.setItem("widgets:peer12", JSON.stringify([{ page: "evaluations", id: "community", label: "" }, { page: "evaluations", id: "log", label: "" }, { page: "campus", id: "where", label: "" }]));
  localStorage.setItem("widgets:peer12:seeded", "3");
  loadPins("peer12");
  expect(pins.widgets.map((p) => p.id)).toEqual(["community", "log", "cancelled", "feedback", "where"]);
});

test("Activity starts taken away; a profile that showed it (open or folded) keeps it once as its last widget", () => {
  loadPins("peer07");
  expect(hasPin("widgets", "home", "activity")).toBe(false);
  localStorage.setItem("activity:peer09", "min");
  loadPins("peer09");
  expect(pins.widgets.at(-1)).toMatchObject({ page: "home", id: "activity" });
  togglePin("widgets", { page: "home", id: "activity", label: "" }); // taken away like any widget: it stays away
  pins.login = "";
  loadPins("peer09");
  expect(hasPin("widgets", "home", "activity")).toBe(false);
  localStorage.setItem("activity:peer10", "off");
  loadPins("peer10");
  expect(hasPin("widgets", "home", "activity")).toBe(false);
});

test("a new profile starts with five starred sections; taking them away, or having starred before, stays as it is", () => {
  loadPins("peer20");
  const first = ["coalition:coal-points", "people:crossed", "campus:seats", "evaluations:by-group", "projects:projects-table"];
  expect(pins.stars.map((p) => `${p.page}:${p.id}`)).toEqual(first);
  expect(pins.stars.map((p) => p.label)).toEqual(["Coalition points", "People", "Where you sat", "Milestones and projects", "Projects"]);
  // a profile still holding the five it was first given (2026-11-12) moves to these
  localStorage.setItem("stars:peer22", JSON.stringify(["projects:projects-table", "people:circle", "campus:seats", "coalition:coal-points", "evaluations:points"]
    .map((s) => ({ page: s.split(":")[0], id: s.split(":")[1], label: "x" }))));
  pins.login = "";
  loadPins("peer22");
  expect(pins.stars.map((p) => `${p.page}:${p.id}`)).toEqual(first);
  pins.login = "";
  loadPins("peer20");
  for (const p of [...pins.stars]) togglePin("stars", p);
  pins.login = "";
  loadPins("peer20");
  expect(pins.stars).toEqual([]);
  localStorage.setItem("stars:peer21", JSON.stringify([{ page: "people", id: "who", label: "Who evaluated you" }]));
  pins.login = "";
  loadPins("peer21");
  expect(pins.stars.map((p) => p.id)).toEqual(["who"]);
});
