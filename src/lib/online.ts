export const RECONNECT_EVENT = "ia:reconnect";

let offline = false;
/** True after the browser `offline` event (or navigator.onLine === false) until `online`. */
let browserSaysOffline = false;
const listeners = new Set<(value: boolean) => void>();

export function isOffline(): boolean {
  return offline;
}

export function subscribeOffline(fn: (value: boolean) => void): () => void {
  listeners.add(fn);
  fn(offline);
  return () => {
    listeners.delete(fn);
  };
}

function emit(next: boolean) {
  if (offline === next) return;
  offline = next;
  for (const fn of listeners) fn(offline);
  if (!next && typeof window !== "undefined") {
    window.dispatchEvent(new Event(RECONNECT_EVENT));
  }
}

export function isNetworkError(err: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  if (err instanceof TypeError) return true;
  if (err instanceof DOMException && /network/i.test(err.name)) return true;
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /failed to fetch|networkerror|load failed|network request failed/i.test(msg);
}

export function noteNetworkFailure(err?: unknown) {
  if (err !== undefined && !isNetworkError(err)) return;
  emit(true);
}

export function noteNetworkOk() {
  if (browserSaysOffline) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  emit(false);
}

export function watchBrowserOnline(): () => void {
  const on = () => {
    browserSaysOffline = false;
    emit(false);
  };
  const off = () => {
    browserSaysOffline = true;
    emit(true);
  };
  window.addEventListener("online", on);
  window.addEventListener("offline", off);
  if (navigator.onLine === false) {
    browserSaysOffline = true;
    emit(true);
  }
  return () => {
    window.removeEventListener("online", on);
    window.removeEventListener("offline", off);
  };
}
