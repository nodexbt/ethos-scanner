import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Returns the input URL only if it's a safe http(s) URL. Rejects
 * javascript:, data:, file:, and other potentially dangerous schemes.
 * Used for rendering external URLs (e.g. Ethos profile links) that
 * come from API responses we don't fully control.
 */
export function safeExternalUrl(url: string | null | undefined): string | undefined {
  if (!url || typeof url !== "string") return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString();
    }
  } catch {
    // fall through
  }
  return undefined;
}

export function nanoid(length: number = 10): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  for (let i = 0; i < length; i++) {
    result += chars[array[i] % chars.length];
  }
  return result;
}

/** "just now", "5 min ago", "3 hours ago", "2 days ago", "3 months ago". */
export function formatRelativeTime(input: string | number | Date): string {
  const ms = Date.now() - new Date(input).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

/**
 * The one rule for a scan's address: /scan/x/<handle> when the handle is
 * known, else /scan/p/<profileId>, else /scan/<wallet>. Ids never go on the
 * handle route, where an all-digit X handle would be ambiguous.
 */
export function scanPath(p: { username?: string | null; profileId?: number | null; wallet?: string | null }): string {
  if (p.username) return `/scan/x/${p.username}`;
  if (p.profileId != null) return `/scan/p/${p.profileId}`;
  if (p.wallet) return `/scan/${p.wallet.toLowerCase()}`;
  return "/scanner";
}

/** scanPath for a profile record that may be missing. */
export function scanHref(p: { username: string | null; profileId: number } | null | undefined): string {
  return p ? scanPath(p) : "/scanner";
}

/** Saved-scan key: `scan-p<profileId>` for profiles, legacy `scan-<address>` otherwise. */
export function investigationIdFor(profileId: number | null | undefined, wallet: string): string {
  return profileId != null ? `scan-p${profileId}` : `scan-${wallet.toLowerCase()}`;
}

/** The address of a saved scan from its key. */
export function pathForInvestigationId(id: string): string {
  const profileId = id.match(/^scan-p(\d+)$/)?.[1];
  return profileId ? `/scan/p/${profileId}` : `/scan/${id.slice("scan-".length)}`;
}
