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

test("a page draws in only on its first visit, each part when it comes into view; once left, it shows at once", () => {
  const watched: Element[] = [];
  const made: ((entries: any[]) => void)[] = []; // the draw-in's observer is the first made (the section index makes its own)
  (window as any).IntersectionObserver = class { constructor(cb: any) { made.push(cb); } observe(el: Element) { watched.push(el); } unobserve() {} disconnect() {} };
  const see = (entries: any[]) => made[0](entries);
  const main = document.createElement("main");
  const draw = (page: string, html: string) => { main.dataset.page = page; main.innerHTML = html; settle(main); return [...main.querySelectorAll(".vchart, .module")] as HTMLElement[]; };
  const two = '<section id="a"><figure class="vchart"></figure></section><section id="b"><figure class="vchart"></figure></section>';
  let [a, b] = draw("web-evaluations", two);
  expect(watched.filter((el) => el.matches(".vchart"))).toEqual([a, b]); // first visit: both wait to be seen, hidden only because they are marked
  expect(a.dataset.anim && !a.classList.contains("in")).toBeTruthy();
  see([{ isIntersecting: true, target: a }]); // you scrolled to the first one
  expect(a.classList.contains("in")).toBe(true);
  [a, b] = draw("web-evaluations", two); // a filter changed on the same visit
  expect(a.dataset.anim).toBeUndefined(); // seen: at once, no draw-in again
  expect(b.dataset.anim).toBeTruthy(); // not seen yet: still to come
  draw("web-campus", '<section id="c"><div class="module"></div></section>'); // another page: Evaluations counts as seen
  [a, b] = draw("web-evaluations", two);
  expect([a.dataset.anim, b.dataset.anim, a.classList.contains("in"), b.classList.contains("in")]).toEqual([undefined, undefined, true, true]);
});
