// The local report-tool's single-file report: the views come embedded in the page (#offline-data) and the app reads
// them instead of asking a server. Nothing is sent anywhere.
export type OfflineData = { login: string; generated: string; views: Record<string, unknown>; default_period: string; today: unknown };

const el = typeof document !== "undefined" ? document.getElementById("offline-data") : null;
export const offline: OfflineData | null = el?.textContent ? JSON.parse(el.textContent) : null;

/** The answer the server would give, from the embedded data; null when the page asks for something it cannot do. */
export function offlineAnswer(path: string): unknown {
  const o = offline!;
  const u = new URL(path, "http://offline");
  switch (u.pathname) {
    case "/api/session":
      return { user: { login: o.login, name: o.login, has_image: false, coalition_color: "", csrf: "", owner: false, can_publish: false },
        contact_email: "", issues_url: "", controller: "", consent_version: 0, consent_updated: "", dev: false, dev_logins: null };
    case "/api/me/status":
      return { state: "done", progress: 1, last: o.generated, next_refresh_in: 3600, has_report: true, consent: true };
    case "/api/me/view":
      return o.views[u.searchParams.get("period") || o.default_period] || o.views[o.default_period];
    case "/api/me/today":
      return o.today;
  }
  return null;
}
