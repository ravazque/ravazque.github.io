import { expect, test } from "vitest";
import { Fmt } from "../fmt";
import { evaluatedBy, firstMore, shortName, whoDetails } from "./people";

test("a name shows its first two words", () => {
  expect(shortName("Álvaro Cerezo Fernández")).toBe("Álvaro Cerezo");
  expect(shortName("  Jaime   Vidal ")).toBe("Jaime Vidal");
  expect(shortName("Cher")).toBe("Cher");
  expect(shortName(null)).toBe("");
});

test("the projects a person evaluated you on, newest first, each with the seat they used when it was looked up", () => {
  const ev = (login: string, project: string, begin: string, checked: boolean, host: string | null) =>
    ({ corrector: { login }, project, begin, other_host_checked: checked, other_host: host });
  const received = [ev("peer01", "libft", "2026-03-01 10:00", false, null), ev("peer02", "minishell", "2026-10-20 12:00", true, "c1r1s1"),
    ev("peer01", "ft_printf", "2026-10-25 16:00", true, "c3r2s4"), ev("peer01", "get_next_line", "2026-10-28 09:00", true, null)];
  const lines = evaluatedBy(new Fmt("en"), received, "peer01").split("\n");
  expect(lines.slice(1)).toEqual(["get_next_line · 28 Oct 2026 · not logged", "ft_printf · 25 Oct 2026 · c3r2s4", "libft · 1 Mar 2026 · –"]);
  expect(evaluatedBy(new Fmt("en"), received, "peer09")).toBe("");
});

test("details name the first project and how many more", () => {
  const f = new Fmt("en");
  expect(firstMore(f, ["libft (x2)", "ft_printf", "so_long"])).toBe("libft (x2) +2 more");
  expect(firstMore(f, ["libft"])).toBe("libft");
  expect(firstMore(f, [])).toBe("–");
});

test("details open a floating list on click: the first project and how many more, then every evaluation", () => {
  const html = whoDetails(new Fmt("en"), ["libft (x2)", "ft_printf"], "Project · day · their seat\nlibft · 1 Mar 2026 · –\nft_printf · 2 Mar 2026 · c1r1s1");
  expect(html).toMatch(/^<details class="pop who-pop" data-float><summary>libft \(x2\) \+1 more<\/summary>/);
  expect(html.match(/<li>/g)).toHaveLength(2);
  expect(html).toContain("<b>Project · day · their seat</b>");
  expect(whoDetails(new Fmt("en"), [], "")).toBe("–");
  expect(whoDetails(new Fmt("en"), ["libft"], "")).toBe("libft");
});
