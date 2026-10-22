import {
  packAgeDays,
  type HkBasemapManifest,
  type HkLocalMeta,
} from "./hkBasemapManifest";

/** Silent Wi‑Fi refresh only when local pack is at least this old (same Release still applies age gate). */
export const HK_UPDATE_MIN_AGE_DAYS = 7;

/** Show 更新地圖 nudge when pack is at least this old (same Release still applies age gate). */
export const HK_NUDGE_AGE_DAYS = 30;

export type HkManifestIdentity = Pick<HkBasemapManifest, "version" | "sha256">;

export function isNewUser(local: HkLocalMeta | null): boolean {
  return local == null;
}

/** True when local pack is missing or differs from remote by sha256 and/or version. */
export function packOutOfDate(
  local: HkLocalMeta | null,
  manifest: HkManifestIdentity,
): boolean {
  if (!local) return true;
  if (local.sha256.toLowerCase() !== manifest.sha256.toLowerCase()) return true;
  if (local.version !== manifest.version) return true;
  return false;
}

/** Age-only silent gate (kept for callers that have no manifest yet). */
export function shouldSilentUpdate(local: HkLocalMeta | null, now = new Date()): boolean {
  if (!local) return false;
  return packAgeDays(local.builtAt, now) >= HK_UPDATE_MIN_AGE_DAYS;
}

/** Age-only nudge gate (kept for callers that have no manifest yet). */
export function shouldNudge(local: HkLocalMeta | null, now = new Date()): boolean {
  if (!local) return false;
  return packAgeDays(local.builtAt, now) >= HK_NUDGE_AGE_DAYS;
}

/**
 * Silent Wi‑Fi path when remote Release differs (any age) OR pack age ≥ 7d.
 * Caller must still gate with `canSilentDownloadNow()` — never silent on cellular.
 */
export function shouldSilentUpdateForManifest(
  local: HkLocalMeta | null,
  manifest: HkManifestIdentity,
  now = new Date(),
): boolean {
  if (!local) return false;
  if (packOutOfDate(local, manifest)) return true;
  return shouldSilentUpdate(local, now);
}

/**
 * Nudge path when remote Release differs (any age — do not wait 30d) OR pack age ≥ 30d.
 * On mismatch + Wi‑Fi, prefer silent download; on mismatch + cellular, nudge immediately.
 */
export function shouldNudgeForManifest(
  local: HkLocalMeta | null,
  manifest: HkManifestIdentity,
  now = new Date(),
): boolean {
  if (!local) return false;
  if (packOutOfDate(local, manifest)) return true;
  return shouldNudge(local, now);
}

type NetworkConnection = {
  type?: string;
  effectiveType?: string;
  saveData?: boolean;
};

/**
 * Wi‑Fi detection for silent auto-update only.
 *
 * Prefer `navigator.connection?.type === 'wifi'` when Network Information API exists.
 * If missing: treat as allowed-for-silent-update only when online AND `saveData !== true`
 * AND type/effectiveType is not obviously cellular / slow-2g / 2g / 3g.
 * If still unknown, skip silent update (wait for nudge button or next chance) —
 * never burn cellular silently.
 *
 * Manual 更新地圖 and new-user paths ignore this and always download when online.
 */
export function isWifiPreferred(nav: Navigator = navigator): boolean {
  if (typeof nav.onLine === "boolean" && !nav.onLine) return false;

  const conn = (nav as Navigator & { connection?: NetworkConnection }).connection;
  if (!conn) {
    // Unknown connection API → do not silent-update on cellular by accident.
    return false;
  }

  const type = (conn.type ?? "").toLowerCase();
  if (type === "wifi") return true;
  if (type === "cellular" || type === "wimax" || type === "bluetooth") return false;

  if (conn.saveData === true) return false;

  const effective = (conn.effectiveType ?? "").toLowerCase();
  if (
    effective === "slow-2g" ||
    effective === "2g" ||
    effective === "3g" ||
    type === "cellular"
  ) {
    return false;
  }

  // type empty / "unknown" / "none" / ethernet without wifi label → skip silent
  if (!type || type === "unknown" || type === "none") return false;

  // ethernet / other non-cellular with no saveData → allow silent
  if (type === "ethernet" || type === "other") return true;

  return false;
}

export function canSilentDownloadNow(nav: Navigator = navigator): boolean {
  return isWifiPreferred(nav);
}

export function canForcedDownloadNow(nav: Navigator = navigator): boolean {
  return typeof nav.onLine !== "boolean" || nav.onLine;
}
