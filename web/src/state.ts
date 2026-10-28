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
