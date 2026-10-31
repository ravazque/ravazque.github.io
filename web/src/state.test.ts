import { beforeEach, expect, test } from "vitest";
import { hasPin, loadPins, moveWidget, pins, relabelStars, setWidget, togglePin } from "./state";

beforeEach(() => { localStorage.clear(); pins.login = ""; });

test("stars and widgets are kept per login, in the order they were added, and a second toggle takes one away", () => {
  loadPins("peer01");
  togglePin("stars", { page: "campus", id: "seats", label: "Where you sat" });
  togglePin("stars", { page: "people", id: "who", label: "Who evaluated you" });
  togglePin("widgets", { page: "projects", id: "exams", label: "" });
  togglePin("stars", { page: "campus", id: "seats", label: "Where you sat" });
  expect(pins.stars.map((p) => p.id)).toEqual(["who"]);
  expect(hasPin("widgets", "projects", "exams")).toBe(true);
  pins.login = "";
  loadPins("peer02");
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
  loadPins("peer04");
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
