// HTML built as text: every value goes through esc, markup only from these builders.
const ENT: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export const esc = (v: unknown): string => (v === null || v === undefined ? "" : String(v).replace(/[&<>"']/g, (c) => ENT[c]));

/** A tooltip and its native fallback (a blocked script still leaves the browser's own). */
export const tipAttr = (tip: string) => ` data-tip="${esc(tip)}" title="${esc(tip)}"`;

export const pct = (v: number, top: number) => (top ? `${((100 * v) / top).toFixed(2)}%` : "0%");

export const SAFE_COLOR = /^#[0-9a-fA-F]{3,8}$/;
export const safeColor = (c: unknown) => (typeof c === "string" && SAFE_COLOR.test(c) ? c : "var(--neutral)");

export const initials = (s: unknown) =>
  String(s || "?").split(/[\s._-]+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

export const avatar = (p: { name?: string | null; login?: string; image?: string | null } | null | undefined) => {
  const x = p || {};
  const img = x.image ? `<img loading="lazy" src="${esc(x.image)}" alt="">` : "";
  return `<span class="avatar" data-i="${esc(initials(x.name || x.login))}" aria-hidden="true">${img}</span>`;
};

export const badge = (text: unknown, kind = "") => `<span class="badge${kind ? " " + kind : ""}">${esc(text)}</span>`;

export const ARROW = '<span class="arr">➜</span>';
