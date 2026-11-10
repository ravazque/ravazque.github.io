// The view of each period (/api/me/view), kept in this tab for the hour, by login: another page, or coming back to the
// app, draws at once with no skeleton. A finished refresh or a report handed back clears it (Dashboard.fetchView).
export const viewCache = new Map<string, { v: any; at: number }>();
export const VIEW_TTL = 3_600_000;
