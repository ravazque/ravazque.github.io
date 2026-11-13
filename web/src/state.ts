// What every screen shares: the language and its formatter, the session, the status of the extraction, and the calls
// to the server (session cookie; the CSRF token on every change).
import { reactive, shallowRef } from "vue";
import { Fmt, type Lang } from "./fmt";
import { offline, offlineAnswer } from "./offline";

export type User = { login: string; name: string; has_image: boolean; coalition_color: string; csrf: string; owner: boolean; can_publish: boolean };
export type SessionInfo = {
  user: User | null; contact_email: string; issues_url: string; controller: string; consent_version: number; consent_updated: string;
  dev: boolean; dev_logins: { label: string; href: string }[] | null;
};
export type Status = {
  state: string; progress: number; message?: string; last?: string; next_refresh_in: number; has_report: boolean; consent: boolean; published?: string; frozen?: boolean;
};

const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

function pickLang(): Lang {
  const saved = store.get("lang");
  if (saved === "en" || saved === "es") return saved;
  for (const l of navigator.languages || [navigator.language]) if (l?.toLowerCase().startsWith("es")) return "es"; else if (l?.toLowerCase().startsWith("en")) return "en";
  return "en";
}

export const fmt = shallowRef(new Fmt(pickLang()));
document.documentElement.lang = fmt.value.lang;

export function setLang(lang: Lang) {
  store.set("lang", lang);
  fmt.value = new Fmt(lang);
  document.documentElement.lang = lang;
}

export const state = reactive({
  session: null as SessionInfo | null,
  status: null as Status | null,
  leaving: false,
});

export class HttpError extends Error {
  constructor(readonly status: number, readonly body: any) { super(`HTTP ${status}`); }
}

export async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  if (offline) {
    const answer = init.method && init.method !== "GET" ? null : offlineAnswer(path);
    if (answer === null) throw new HttpError(404, { error: "offline" });
    return answer as T;
  }
  const headers = new Headers(init.headers);
  if (init.method && init.method !== "GET" && state.session?.user) headers.set("X-CSRF-Token", state.session.user.csrf);
  const r = await fetch(path, { credentials: "same-origin", ...init, headers });
  const text = await r.text();
  let body: any = text;
  try { body = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!r.ok) throw new HttpError(r.status, body);
  return body as T;
}

export async function loadSession(): Promise<SessionInfo> {
  state.session = await api<SessionInfo>("/api/session");
  return state.session;
}

/** Milliseconds to the next quarter of the hour (:00, :15, :30, :45), when the server refreshes the coalitions. */
export const untilQuarter = (d: Date) => 900_000 - (d.getTime() % 900_000);

export const settings = store;

/** Sections a student keeps, in this browser and per login: starred ones (shortcuts in the star menu) and widgets
 * (shown under Profile). A star keeps its section's title in the language it was seen in until its page shows again. */
export type Pin = { page: string; id: string; label: string; wide?: boolean; side?: "left" | "right" };
export const pins = reactive({ login: "", stars: [] as Pin[], widgets: [] as Pin[] });

/** What a profile starts with: given once, so that taking one away stays that way. */
// The first widgets, in the order they were offered, each with the one it goes under (the one before it unless said);
// `widgets:<login>:seeded` says how far down this list a profile was offered: "1" the first three, one more per number
const pin = (page: string, id: string): Pin => ({ page, id, label: "" });
const FIRST_WIDGETS: [Pin, Pin | null][] = [[pin("evaluations", "community"), null], [pin("campus", "rhythm"), pin("evaluations", "community")],
  [pin("coalition", "bonus"), pin("campus", "rhythm")], [pin("evaluations", "log"), pin("coalition", "bonus")], [pin("campus", "where"), pin("evaluations", "log")],
  [pin("evaluations", "feedback"), pin("evaluations", "log")], [pin("evaluations", "cancelled"), pin("evaluations", "log")]];

/** The sections a new profile finds starred (owner, 2026-11-13), each with its title's text: only where nothing was ever
 * starred in this browser, so taking them away stays that way. A profile still holding exactly the five it was given the
 * day before (OLD_STARS) moves to these. */
const FIRST_STARS: [string, string, string][] = [["coalition", "coal-points", "nav.coal"], ["people", "crossed", "nav.crossed"],
  ["campus", "seats", "nav.seats"], ["evaluations", "by-group", "stats.group_section"], ["projects", "projects-table", "nav.projects_table"]];
const OLD_STARS = "projects:projects-table,people:circle,campus:seats,coalition:coal-points,evaluations:points";

function readPins(key: string): Pin[] {
  try {
    const v = JSON.parse(store.get(key) || "[]");
    // Activity moved to Profile, where it always shows: an old star of it could never be taken away
    return Array.isArray(v) ? v.filter((p) => p && typeof p.page === "string" && typeof p.id === "string" && !(p.page === "projects" && p.id === "activity")).map((p) => ({
      page: p.page, id: p.id, label: String(p.label || ""),
      ...(typeof p.wide === "boolean" ? { wide: p.wide } : {}), ...(p.side === "left" || p.side === "right" ? { side: p.side } : {}) })) : [];
  } catch { return []; }
}

export function loadPins(login: string) {
  if (pins.login === login) return;
  const key = `widgets:${login}`;
  let widgets = readPins(key);
  const seeded = store.get(`${key}:seeded`), same = (a: Pin, b: Pin) => a.page === b.page && a.id === b.id;
  const offered = seeded ? +seeded + 2 : 0, now = String(FIRST_WIDGETS.length - 2);
  const place = (list: Pin[], [d, under]: [Pin, Pin | null]) => { // once, under the one it goes under (last without it)
    if (list.some((w) => same(w, d))) return;
    const at = under ? list.findIndex((w) => same(w, under)) : -1;
    list.splice(at < 0 ? list.length : at + 1, 0, d);
  };
  if (!seeded) {
    const first: Pin[] = [];
    FIRST_WIDGETS.forEach((e) => place(first, e));
    widgets = [...first.filter((d) => !widgets.some((w) => same(w, d))), ...widgets];
  } else FIRST_WIDGETS.slice(offered).forEach((e) => place(widgets, e)); // added since this profile was seeded
  // Activity is a widget (taken away to begin with); a profile that showed it, open ("") or folded ("min"), keeps it once
  const a = store.get(`activity:${login}`), moved = a === "" || a === "min";
  if (moved && !widgets.some((w) => w.page === "home" && w.id === "activity")) widgets.push(pin("home", "activity"));
  if (moved) store.set(`activity:${login}`, "widget");
  if (seeded !== now || moved) {
    store.set(`${key}:seeded`, now);
    store.set(key, JSON.stringify(widgets));
  }
  if (store.get(`stars:${login}`) === null || readPins(`stars:${login}`).map((p) => `${p.page}:${p.id}`).join() === OLD_STARS) store.set(`stars:${login}`, JSON.stringify(FIRST_STARS.map(([page, id, k]) => ({ page, id, label: fmt.value.t(k) }))));
  Object.assign(pins, { login, stars: readPins(`stars:${login}`), widgets });
}

export function hasPin(kind: "stars" | "widgets", page: string, id: string) {
  return pins[kind].some((p) => p.page === page && p.id === id);
}

/** Adds the section if it is not kept yet, else takes it away; the list keeps the order things were added in. */
export function togglePin(kind: "stars" | "widgets", pin: Pin) {
  if (!pins.login) return;
  pins[kind] = hasPin(kind, pin.page, pin.id) ? pins[kind].filter((p) => !(p.page === pin.page && p.id === pin.id)) : [...pins[kind], pin];
  store.set(`${kind}:${pins.login}`, JSON.stringify(pins[kind]));
}

/** A widget moved to another place in the list (indexes before the move). */
export function moveWidget(from: number, to: number) {
  const w = [...pins.widgets];
  if (from < 0 || from >= w.length || to < 0 || to > w.length) return;
  const [item] = w.splice(from, 1);
  w.splice(to > from ? to - 1 : to, 0, item);
  pins.widgets = w;
  store.set(`widgets:${pins.login}`, JSON.stringify(w));
}

/** A widget's size (wide: both columns) or column (side; none: the next free place). */
export function setWidget(page: string, id: string, patch: { wide?: boolean; side?: "left" | "right" | null }) {
  pins.widgets = pins.widgets.map((p) => {
    if (p.page !== page || p.id !== id) return p;
    const next: Pin = { ...p, ...("wide" in patch ? { wide: patch.wide } : {}) };
    if ("side" in patch) { if (patch.side) next.side = patch.side; else delete next.side; }
    return next;
  });
  store.set(`widgets:${pins.login}`, JSON.stringify(pins.widgets));
}

/** Keeps starred titles in the current language once their page is drawn. */
export function relabelStars(page: string, labels: Map<string, string>) {
  let changed = false;
  pins.stars = pins.stars.map((p) => (p.page === page && labels.has(p.id) && labels.get(p.id) !== p.label ? ((changed = true), { ...p, label: labels.get(p.id)! }) : p));
  if (changed) store.set(`stars:${pins.login}`, JSON.stringify(pins.stars));
}
