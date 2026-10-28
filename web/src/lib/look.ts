// The look the reader picks: theme (system, light, dark) and accent (the intra's blue or their coalition's colour).
import { INTRA, applyAccent } from "../legacy/accent.js";
import { settings } from "../state";

export type Theme = "auto" | "light" | "dark";

export function applyTheme(v: string | null): Theme {
  const t: Theme = v === "light" || v === "dark" ? v : "auto";
  if (t === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  return t;
}

export function setTheme(t: Theme) {
  settings.set("theme", t);
  applyTheme(t);
}

/** The accent in use: the coalition's only when chosen and known (and plain hex: it reaches CSS). */
export function applyAccentChoice(choice: string | null, coalition: string | null | undefined): "intra" | "coalition" {
  const coal = coalition && /^#[0-9a-f]{3,6}$/i.test(coalition) ? coalition : "";
  const pick = choice === "coalition" && coal ? "coalition" : "intra";
  const color = pick === "coalition" ? coal : INTRA;
  applyAccent(color);
  recolorFavicon(color);
  return pick;
}

function recolorFavicon(color: string) {
  fetch("/favicon.svg").then((r) => r.text()).then((svg) => {
    const url = "data:image/svg+xml," + encodeURIComponent(svg.replace(/(id="lit"[^>]*fill=")#[0-9a-f]+/i, `$1${color}`));
    document.querySelectorAll<HTMLLinkElement>('link[rel="icon"][type="image/svg+xml"]').forEach((l) => { l.href = url; });
  }).catch(() => {});
}
