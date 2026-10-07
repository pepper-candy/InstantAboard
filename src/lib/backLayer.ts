type LayerTag = "search" | "peek" | "detail";

type CloseWatcherLike = {
  onclose: ((ev?: Event) => void) | null;
  destroy: () => void;
};

type Entry = {
  tag: LayerTag;
  onClose: () => void;
  watcher: CloseWatcherLike | null;
};

const stack: Entry[] = [];
const listeners = new Set<() => void>();
let ignorePop = 0;
let popBound = false;

function bump(): void {
  listeners.forEach((fn) => fn());
}

function hasCloseWatcher(): boolean {
  return typeof window !== "undefined" && "CloseWatcher" in window;
}

function makeWatcher(): CloseWatcherLike | null {
  if (!hasCloseWatcher()) return null;
  const Ctor = (window as unknown as { CloseWatcher: new () => CloseWatcherLike }).CloseWatcher;
  try {
    return new Ctor();
  } catch {
    return null;
  }
}

function bindPop(): void {
  if (popBound || typeof window === "undefined") return;
  popBound = true;
  window.addEventListener("popstate", () => {
    if (ignorePop > 0) {
      ignorePop -= 1;
      return;
    }
    const top = stack[stack.length - 1];
    if (!top || top.watcher) return;
    stack.pop();
    top.onClose();
    bump();
  });
}

function removeEntry(entry: Entry): boolean {
  const i = stack.lastIndexOf(entry);
  if (i < 0) return false;
  stack.splice(i, 1);
  return true;
}

/** Open a panel layer. Call from the user-activation handler that opens it. */
export function openLayer(onClose: () => void, tag: LayerTag): () => void {
  const watcher = makeWatcher();
  const entry: Entry = { tag, onClose, watcher };
  if (watcher) {
    watcher.onclose = () => {
      if (!removeEntry(entry)) return;
      onClose();
      bump();
    };
    stack.push(entry);
    bump();
    return () => {
      if (!removeEntry(entry)) return;
      watcher.onclose = null;
      watcher.destroy();
      onClose();
      bump();
    };
  }
  bindPop();
  const n = (typeof history.state?.iaLayer === "number" ? history.state.iaLayer : 0) + 1;
  history.pushState({ ...history.state, iaLayer: n }, "");
  stack.push(entry);
  bump();
  return () => {
    if (stack[stack.length - 1] !== entry) return;
    history.back();
  };
}

export function closeTopLayer(): boolean {
  const top = stack[stack.length - 1];
  if (!top) return false;
  if (top.watcher) {
    if (!removeEntry(top)) return false;
    top.watcher.onclose = null;
    top.watcher.destroy();
    top.onClose();
    bump();
    return true;
  }
  history.back();
  return true;
}

export function dismissAllLayers(): void {
  const entries = stack.splice(0, stack.length);
  const hist = entries.filter((e) => !e.watcher).length;
  for (const entry of [...entries].reverse()) {
    if (entry.watcher) {
      entry.watcher.onclose = null;
      entry.watcher.destroy();
    }
    entry.onClose();
  }
  bump();
  if (hist > 0) {
    ignorePop += hist;
    history.go(-hist);
  }
}

export function getTopLayer(): LayerTag | null {
  return stack[stack.length - 1]?.tag ?? null;
}

export function subscribeLayers(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}
