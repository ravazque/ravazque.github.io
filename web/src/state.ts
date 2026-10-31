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

export const settings = store;

/** Sections a student keeps, in this browser and per login: starred ones (shortcuts in the star menu) and widgets
 * (shown under Profile). A star keeps its section's title in the language it was seen in until its page shows again. */
export type Pin = { page: string; id: string; label: string; wide?: boolean; side?: "left" | "right" };
export const pins = reactive({ login: "", stars: [] as Pin[], widgets: [] as Pin[] });

function readPins(key: string): Pin[] {
  try {
    const v = JSON.parse(store.get(key) || "[]");
    return Array.isArray(v) ? v.filter((p) => p && typeof p.page === "string" && typeof p.id === "string").map((p) => ({
      page: p.page, id: p.id, label: String(p.label || ""),
      ...(typeof p.wide === "boolean" ? { wide: p.wide } : {}), ...(p.side === "left" || p.side === "right" ? { side: p.side } : {}) })) : [];
  } catch { return []; }
}

export function loadPins(login: string) {
  if (pins.login === login) return;
  Object.assign(pins, { login, stars: readPins(`stars:${login}`), widgets: readPins(`widgets:${login}`) });
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
