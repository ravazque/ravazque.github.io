// The report's original lives in this browser (IndexedDB); the server keeps a signed copy for an hour and takes it
// back only with its signature.

export type Copy = { sig: string; body: ArrayBuffer };
export interface Shelf { get(login: string): Promise<Copy | undefined>; put(login: string, c: Copy): Promise<void>; del(login: string): Promise<void> }

function req<T>(r: IDBRequest<T>) {
  return new Promise<T>((ok, ko) => { r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
}

/** The browser's own shelf ("logbook", as v1 named it, so a copy saved by v1 is still found). */
export const idbShelf: Shelf = {
  async get(login) { return req((await db()).transaction("reports").objectStore("reports").get(login)) as Promise<Copy | undefined>; },
  async put(login, c) { await req((await db()).transaction("reports", "readwrite").objectStore("reports").put(c, login)); },
  async del(login) { await req((await db()).transaction("reports", "readwrite").objectStore("reports").delete(login)); },
};

function db() {
  return new Promise<IDBDatabase>((ok, ko) => {
    const r = indexedDB.open("logbook", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("reports");
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
  });
}

type Fetch = (path: string, init?: RequestInit) => Promise<Response>;

/** Keeps the server's current copy here, unless this browser already holds those exact bytes. */
export async function keepCopy(shelf: Shelf, login: string, fetcher: Fetch): Promise<void> {
  const r = await fetcher("/api/me/report.json");
  if (!r.ok) return;
  const sig = r.headers.get("X-Report-Sig") || "";
  const mine = await shelf.get(login).catch(() => undefined);
  if (mine?.sig === sig) return;
  await shelf.put(login, { sig, body: await r.arrayBuffer() }).catch(() => {});
}

/** Hands this browser's copy back to the server; false (and the copy forgotten) when it is refused or missing. */
export async function restore(shelf: Shelf, login: string, csrf: string, fetcher: Fetch): Promise<boolean> {
  const mine = await shelf.get(login).catch(() => undefined);
  if (!mine) return false;
  const r = await fetcher("/api/me/report", { method: "POST", body: mine.body,
    headers: { "X-CSRF-Token": csrf, "X-Report-Sig": mine.sig, "Content-Type": "application/json" } });
  if (r.ok) return true;
  await shelf.del(login).catch(() => {});
  return false;
}

export const forget = (shelf: Shelf, login: string) => shelf.del(login).catch(() => {});
