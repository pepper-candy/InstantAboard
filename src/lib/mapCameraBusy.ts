/**
 * Automated camera busy (locate spin) — SSR-safe, no Leaflet.
 * Busy wraps prep + move for flyVisible / fitVisibleBounds only.
 * Manual user pan/zoom never touches this.
 */

/** Prep + pre-sim wall-clock cap (Adrian). Reveal best-known if prep overruns. */
export const AUTOMATED_HARD_MS = 2000;
/** Busy safety: prep + max fly (~2.5s) + slack — spin until settle, never stuck forever. */
const AUTOMATED_BUSY_HARD_MS = 5000;
/** Matches globals.css `ia-spin` duration (full 360°). */
const IA_SPIN_MS = 700;
/** Treat as already on a cardinal (0/90/180/270) — skip settle. */
const SETTLE_EPS_DEG = 0.75;
/** Locationally equivalent stops for a 4-fold symmetric locate icon. */
const CARDINAL_DEG = [0, 90, 180, 270] as const;

let automatedBusy = false;
const busyListeners = new Set<(busy: boolean) => void>();
let busyHardTimer: ReturnType<typeof setTimeout> | null = null;

/** Bumps on each flyVisible / fitVisibleBounds so an in-flight rAF lerp aborts. */
let flyVisibleGen = 0;

/** Cancels an in-flight cardinal settle (new press / remount). */
let settleGen = 0;
let settleCleanup: (() => void) | null = null;

const RECENTER_BTN = '.map-tools button.recenter[aria-label="Recenter"]';

function queryRecenterIcon(): { btn: HTMLButtonElement; icon: SVGElement } | null {
  if (typeof document === "undefined") return null;
  const btn = document.querySelector<HTMLButtonElement>(RECENTER_BTN);
  if (!btn) return null;
  const icon = btn.querySelector<SVGElement>(".icon-md");
  if (!icon) return null;
  return { btn, icon };
}

/** Current clockwise rotation in [0, 360). */
function readRotationDeg(el: Element): number {
  const tr = getComputedStyle(el).transform;
  if (!tr || tr === "none") return 0;
  let a = 1;
  let b = 0;
  if (tr.startsWith("matrix3d(")) {
    const v = tr.slice(9, -1).split(",").map((x) => Number(x.trim()));
    a = v[0] ?? 1;
    b = v[1] ?? 0;
  } else if (tr.startsWith("matrix(")) {
    const v = tr.slice(7, -1).split(",").map((x) => Number(x.trim()));
    a = v[0] ?? 1;
    b = v[1] ?? 0;
  } else {
    return 0;
  }
  let deg = (Math.atan2(b, a) * 180) / Math.PI;
  deg %= 360;
  if (deg < 0) deg += 360;
  return deg;
}

function prefersReducedMotion(): boolean {
  return (
    typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function clearIconSpinStyles(icon: SVGElement) {
  icon.style.animation = "";
  icon.style.transition = "";
  icon.style.transform = "";
  icon.style.transformOrigin = "";
}

function cancelIconSettle() {
  settleGen += 1;
  settleCleanup?.();
  settleCleanup = null;
}

function paintBusyChrome(busy: boolean, btn: HTMLButtonElement, icon: SVGElement) {
  document.documentElement.dataset.iaCamBusy = busy ? "1" : "0";
  btn.classList.toggle("is-busy", busy);
  if (busy) btn.setAttribute("aria-busy", "true");
  else btn.removeAttribute("aria-busy");
  icon.classList.toggle("icon-spin", busy);
}

/** True if θ is within eps of 0/90/180/270 (0 wraps at 360). */
function nearCardinal(angle: number): boolean {
  for (const c of CARDINAL_DEG) {
    if (Math.abs(angle - c) <= SETTLE_EPS_DEG) return true;
  }
  return angle >= 360 - SETTLE_EPS_DEG;
}

/**
 * Next clockwise cardinal in absolute degrees ahead of θ, so CSS can lerp forward.
 * e.g. 45→90, 95→180, 350→360 (≡0). Assumes not already near a cardinal.
 */
function nextClockwiseCardinalDeg(angle: number): number {
  return (Math.floor(angle / 90) + 1) * 90;
}

/**
 * After busy clears: keep turning clockwise at ia-spin speed to the nearest
 * upcoming cardinal (0/90/180/270), then stop. Freezes computed angle first so
 * clearing CSS animation classes cannot jump backward.
 */
function settleIconSpinToCardinal(icon: SVGElement, btn: HTMLButtonElement) {
  cancelIconSettle();
  const gen = settleGen;

  const finish = () => {
    if (gen !== settleGen) return;
    settleCleanup = null;
    clearIconSpinStyles(icon);
    paintBusyChrome(false, btn, icon);
  };

  const angle = readRotationDeg(icon);
  const alreadySettled = nearCardinal(angle);

  // Freeze current pose, then drop infinite-spin selectors (React may also drop them).
  icon.style.transformOrigin = "50% 50%";
  icon.style.animation = "none";
  icon.style.transition = "none";
  icon.style.transform = alreadySettled ? "" : `rotate(${angle}deg)`;
  void icon.getBoundingClientRect();
  paintBusyChrome(false, btn, icon);

  if (alreadySettled || prefersReducedMotion()) {
    clearIconSpinStyles(icon);
    return;
  }

  const target = nextClockwiseCardinalDeg(angle);
  const remaining = target - angle;
  const durationMs = Math.max(16, (remaining / 360) * IA_SPIN_MS);

  const onEnd = (ev: TransitionEvent) => {
    if (ev.target !== icon || (ev.propertyName && ev.propertyName !== "transform")) return;
    if (gen !== settleGen) return;
    icon.removeEventListener("transitionend", onEnd);
    finish();
  };

  const safety = window.setTimeout(() => {
    if (gen !== settleGen) return;
    icon.removeEventListener("transitionend", onEnd);
    finish();
  }, durationMs + 80);

  settleCleanup = () => {
    window.clearTimeout(safety);
    icon.removeEventListener("transitionend", onEnd);
  };

  // Continue forward (clockwise) to next cardinal — never reverse.
  requestAnimationFrame(() => {
    if (gen !== settleGen) return;
    icon.style.transition = `transform ${durationMs}ms linear`;
    icon.style.transform = `rotate(${target}deg)`;
  });
  icon.addEventListener("transitionend", onEnd);
}

/**
 * Imperative locate-spin paint (no React). Recenter button only — icon class, no chrome fade.
 * Survives until emit(false) / hard clear. Mirrored in HomeMap via useSyncExternalStore.
 * Animation kicks only on idle→busy; re-sync while busy must not restart ia-spin.
 * Busy→false settles clockwise to the next cardinal before dropping spin styles.
 */
export function syncAutomatedCameraBusyDom(busy: boolean) {
  if (typeof document === "undefined") return;
  const pair = queryRecenterIcon();
  if (!pair) {
    document.documentElement.dataset.iaCamBusy = busy ? "1" : "0";
    return;
  }
  const { btn, icon } = pair;

  if (!busy) {
    settleIconSpinToCardinal(icon, btn);
    return;
  }

  // Busy=true: cancel any in-flight cardinal settle from a prior finish.
  cancelIconSettle();

  const spinAlreadyLive =
    document.documentElement.dataset.iaCamBusy === "1" ||
    btn.classList.contains("is-busy") ||
    icon.classList.contains("icon-spin");

  paintBusyChrome(true, btn, icon);

  if (!spinAlreadyLive) {
    // Start ia-spin once on this press tick so the glyph moves before React re-render.
    clearIconSpinStyles(icon);
    icon.style.animation = "none";
    void icon.getBoundingClientRect();
    icon.style.animation = "";
  }
  // Already spinning / mid-flight re-prime: keep classes, do not restart animation.
}

function emitAutomatedBusy(busy: boolean) {
  if (automatedBusy === busy) return;
  automatedBusy = busy;
  syncAutomatedCameraBusyDom(busy);
  for (const cb of busyListeners) cb(busy);
}

export function getAutomatedCameraBusy(): boolean {
  return automatedBusy;
}

/**
 * Subscribe to automated camera busy (prep + fly/fit).
 * Does not sync-fire on subscribe (compatible with useSyncExternalStore).
 * Manual pan/zoom never sets busy.
 */
export function subscribeAutomatedCameraBusy(cb: (busy: boolean) => void): () => void {
  busyListeners.add(cb);
  return () => {
    busyListeners.delete(cb);
  };
}

function clearBusyHardTimer() {
  if (busyHardTimer != null) {
    clearTimeout(busyHardTimer);
    busyHardTimer = null;
  }
}

function armBusyHardClear(gen: number) {
  clearBusyHardTimer();
  busyHardTimer = setTimeout(() => {
    busyHardTimer = null;
    if (gen !== flyVisibleGen) return;
    emitAutomatedBusy(false);
  }, AUTOMATED_BUSY_HARD_MS);
}

/**
 * Sync busy=true for locate press → spin before React effect reaches flyVisible.
 * Re-paints DOM if already busy (React can strip is-busy) but does not restart spin.
 * Short pending clear if no fly/fit starts; beginAutomated re-arms for the real move.
 */
export function primeAutomatedCameraBusy() {
  const alreadyBusy = automatedBusy;
  automatedBusy = true;
  // Same input tick paint; sync skips animation restart when already spinning.
  syncAutomatedCameraBusyDom(true);
  if (!alreadyBusy) {
    for (const cb of busyListeners) cb(true);
  }
  clearBusyHardTimer();
  const gen = flyVisibleGen;
  busyHardTimer = setTimeout(() => {
    busyHardTimer = null;
    if (gen !== flyVisibleGen) return;
    emitAutomatedBusy(false);
  }, AUTOMATED_HARD_MS);
}

/** Next gen for a new flyVisible / fitVisibleBounds call. */
export function nextFlyVisibleGen(): number {
  return ++flyVisibleGen;
}

export function currentFlyVisibleGen(): number {
  return flyVisibleGen;
}

/** Start a gen: busy=true, arm busy hard clear (prep overrun still uses AUTOMATED_HARD_MS). */
export function beginAutomated(gen: number) {
  emitAutomatedBusy(true);
  armBusyHardClear(gen);
}

/** Clear busy when this gen finishes or is superseded only if still current. */
export function finishAutomated(gen: number) {
  if (gen !== flyVisibleGen) return;
  clearBusyHardTimer();
  emitAutomatedBusy(false);
}
