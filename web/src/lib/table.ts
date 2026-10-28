// Tables as markup: every cell carries its sort value so the browser re-sorts without a request.
import type { Fmt } from "../fmt";
import { esc } from "./h";

export type Col<R> = {
  k: string; t: string; s?: string; num?: boolean; hide?: boolean; ph?: boolean; nw?: boolean; cls?: string;
  f?: (r: R) => string; sv?: (r: R) => unknown;
};

type Opts<R> = {
  label: string; sort?: [string, 1 | -1]; empty?: string; sticky?: boolean; detail?: (r: R) => string;
  group?: { key: (r: R) => string; order: string[]; label: (g: string) => string }; id?: string;
};

const cmp = (a: unknown, b: unknown) => (typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b)));

export function table<R extends Record<string, any>>(f: Fmt, cols: Col<R>[], input: R[], o: Opts<R>): string {
  const sv = (c: Col<R>, r: R) => (c.sv ? c.sv(r) : r[c.k]);
  let rows = [...input];
  if (o.sort) {
    const col = cols.find((c) => c.k === o.sort![0])!;
    const dir = o.sort[1];
    const filled = rows.filter((r) => sv(col, r) !== null && sv(col, r) !== undefined);
    rows = [...filled.sort((a, b) => cmp(sv(col, a), sv(col, b)) * dir), ...rows.filter((r) => sv(col, r) === null || sv(col, r) === undefined)];
  }
  if (o.group) {
    const g = o.group;
    const at = (r: R) => (g.order.includes(g.key(r)) ? g.order.indexOf(g.key(r)) : 99);
    rows = rows.map((r, i) => [r, i] as const).sort((a, b) => at(a[0]) - at(b[0]) || a[1] - b[1]).map(([r]) => r);
  }
  const cls = (c: Col<R>) => [c.num && "num", c.nw && "nowrap", c.hide && "narrow-hide", c.ph && "phone-hide", c.cls].filter(Boolean).join(" ");
  const cell = (c: Col<R>, r: R) => {
    const v = c.f ? c.f(r) : esc(r[c.k] ?? "");
    const s = sv(c, r);
    return `<td class="${cls(c)}" data-v="${esc(s ?? "")}">${v}</td>`;
  };
  const th = (c: Col<R>) => {
    const aria = o.sort && c.k === o.sort[0] ? ` aria-sort="${o.sort[1] > 0 ? "ascending" : "descending"}"` : "";
    const title = c.s ? `<span class="th-l">${esc(c.t)}</span><span class="th-s" aria-hidden="true">${esc(c.s)}</span>` : esc(c.t);
    const name = c.s ? ` aria-label="${esc(c.t)}" title="${esc(c.t)}"` : "";
    return `<th scope="col" class="${cls(c)}"${aria}><button type="button" data-num="${c.num ? 1 : 0}"${name}>${title}</button></th>`;
  };
  const line = (r: R) => "<tr>" + cols.map((c) => cell(c, r)).join("") + "</tr>";
  let body: string;
  if (!rows.length) body = `<tbody><tr><td class="empty" colspan="${cols.length}">${esc(o.empty || f.t("empty.period"))}</td></tr></tbody>`;
  else if (o.detail || o.group) {
    const parts: string[] = [];
    let prev: string | symbol = Symbol();
    for (const r of rows) {
      if (o.group) {
        const g = o.group.key(r);
        if (g !== prev) {
          parts.push(`<tbody class="group"><tr><th scope="rowgroup" colspan="${cols.length}">${esc(o.group.label(g))}</th></tr></tbody>`);
          prev = g;
        }
      }
      const d = o.detail ? o.detail(r) : "";
      parts.push(d ? `<tbody class="pair">${line(r)}<tr class="detail"><td colspan="${cols.length}">${d}</td></tr></tbody>` : `<tbody>${line(r)}</tbody>`);
    }
    body = parts.join("");
  } else body = "<tbody>" + rows.map(line).join("") + "</tbody>";
  return `<table${o.id ? ` id="${o.id}"` : ""} class="${o.sticky ? "sticky-first" : ""}" aria-label="${esc(o.label)}">`
    + `<thead><tr>${cols.map(th).join("")}</tr></thead>${body}</table>`;
}

export const facts = (rows: [string, string][]) => rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join("");

/** Rows as CSV (RFC 4180), for the downloads and their previews. */
export function csv(rows: unknown[][]): string {
  const q = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(q).join(",")).join("\n") + "\n";
}

/** CSV text (RFC 4180: quoted fields, doubled quotes, line breaks inside quotes) as rows of fields. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (c === '"') quoted = false; else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}
