import { expect, test } from "vitest";
import { dragScroll, settle } from "./behave";

test("dragging near an edge scrolls that way, faster the closer it gets; the band counts as the top", () => {
  expect(dragScroll(500, 72, 900)).toBe(0);
  expect(dragScroll(860, 72, 900)).toBeGreaterThan(0);
  expect(dragScroll(899, 72, 900)).toBeGreaterThan(dragScroll(860, 72, 900));
  expect(dragScroll(100, 72, 900)).toBeLessThan(0);
  expect(dragScroll(40, 72, 900)).toBeLessThan(dragScroll(100, 72, 900));
  expect(dragScroll(-1, 72, 900)).toBe(0); // the pointer left the window
});

test("charts and figures draw in the first time a page is drawn in the session; after that, at once", () => {
  const seen: Element[] = [];
  (window as any).IntersectionObserver = class { observe(el: Element) { seen.push(el); } unobserve() {} disconnect() {} };
  const main = document.createElement("main");
  main.dataset.page = "web-coalition";
  main.innerHTML = '<figure class="vchart"></figure>';
  settle(main);
  expect(seen.length).toBe(1);
  expect(main.querySelector(".vchart")!.classList.contains("in")).toBe(false); // waits to be seen, then draws in
  main.innerHTML = '<figure class="vchart"></figure>'; // a filter changed: the page drawn again
  settle(main);
  expect(seen.length).toBe(1);
  expect(main.querySelector(".vchart")!.classList.contains("in")).toBe(true);
  main.dataset.page = "web-campus"; // another page, for the first time
  main.innerHTML = '<div class="module"></div>';
  settle(main);
  expect(seen.length).toBe(2);
});
