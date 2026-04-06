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
