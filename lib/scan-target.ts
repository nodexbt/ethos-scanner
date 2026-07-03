import {
  fetchProfile,
  getWalletAddresses,
  isEthereumAddress,
  type EthosProfile,
} from "./ethos";
import { getSupabase } from "./db/supabase";
import { getContractFlags } from "./wallet-classify";

/** Most profiles have 1-2 attested wallets; cap the scan fan-out so a
    profile with many attestations can't multiply Alchemy volume
    unboundedly. */
export const MAX_WALLETS_PER_SCAN = 5;

export interface ResolvedScanTarget {
  /** null = unattested wallet; scan proceeds as a single-address scan. */
  profileId: number | null;
  /** Personal EOA wallets to actually scan (lowercased), capped at
      MAX_WALLETS_PER_SCAN. Smart-contract wallets are excluded — their
      history is protocol activity, not the person's. */
  wallets: string[];
  /** Every attested wallet incl. smart wallets, for self-exclusion during
      the scan (so a candidate isn't flagged for touching the user's own
      smart wallet). Absent for unattested single-address scans. */
  allWallets?: string[];
  primaryWallet: string;
  /** `scan-p<profileId>` for profiles, legacy `scan-<address>` otherwise. */
  investigationId: string;
  ethos?: {
    displayName: string;
    username: string | null;
    avatarUrl: string;
    score: number;
  };
}

export function investigationIdFor(
  profileId: number | null,
  primaryWallet: string
): string {
  return profileId !== null ? `scan-p${profileId}` : `scan-${primaryWallet}`;
}

/**
 * Normalize free-form scan input to a lookup identifier:
 * - raw 0x address → itself
 * - x.com / twitter.com / app.ethos.network profile URLs → handle or profile id
 * - "@handle" or bare handle → handle
 * Returns null for input that can't be an address, handle, or known URL.
 */
export function parseScanInput(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (isEthereumAddress(trimmed)) return trimmed.toLowerCase();

  // URL forms. Try URL parsing for anything with a slash or dot-domain.
  const urlMatch = trimmed.match(/^(?:https?:\/\/)?([^/\s]+)(\/[^\s]*)?$/);
  if (urlMatch && urlMatch[2]) {
    const host = urlMatch[1].toLowerCase();
    const path = urlMatch[2].split(/[?#]/)[0];
    if (host === "x.com" || host === "twitter.com" || host === "www.x.com" || host === "www.twitter.com") {
      const m = path.match(/^\/([A-Za-z0-9_]{1,15})\/?$/);
      return m ? m[1] : null;
    }
    if (host === "app.ethos.network" || host === "ethos.network" || host === "www.ethos.network") {
      const byX = path.match(/^\/profile\/x\/([A-Za-z0-9_]{1,15})\/?$/);
      if (byX) return byX[1];
      const byId = path.match(/^\/profile\/(\d+)\/?$/);
      if (byId) return byId[1];
      return null;
    }
    return null;
  }

  // "@handle" or bare handle
  const handle = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  if (/^[A-Za-z0-9_]{1,15}$/.test(handle)) return handle;
  return null;
}

async function toResolvedTarget(
  profile: EthosProfile | null,
  fallbackAddress: string | null
): Promise<ResolvedScanTarget | null> {
  if (profile && profile.profileId) {
    const allWallets = getWalletAddresses(profile);

    // Exclude smart-contract wallets from the scanned set — they're
    // provisioned (e.g. the Ethos/Privy proxy) rather than personally
    // controlled, and scanning them pollutes the cluster with shared
    // protocol counterparties. Fall back to on-chain classification for
    // wallets not yet in the mirror.
    const flags = await getContractFlags(allWallets);
    const eoas = allWallets.filter((w) => !flags.get(w));

    // Scan EOAs; if the profile somehow has only smart wallets, fall back to
    // scanning them so the profile is still coverable.
    let wallets = eoas.length > 0 ? eoas : allWallets;

    // Keep the queried address first when it's an EOA, so "scan this address"
    // always leads with the address the user asked for.
    if (fallbackAddress && !flags.get(fallbackAddress) && wallets.includes(fallbackAddress)) {
      wallets = [fallbackAddress, ...wallets.filter((w) => w !== fallbackAddress)];
    }
    wallets = wallets.slice(0, MAX_WALLETS_PER_SCAN);
    if (wallets.length === 0) {
      // Profile exists but has no attested wallet we can parse; fall back
      // to the queried address if we have one.
      if (!fallbackAddress) return null;
      wallets = [fallbackAddress];
    }
    return {
      profileId: profile.profileId,
      wallets,
      allWallets,
      primaryWallet: wallets[0],
      investigationId: investigationIdFor(profile.profileId, wallets[0]),
      ethos: {
        displayName: profile.displayName,
        username: profile.username,
        avatarUrl: profile.avatarUrl,
        score: profile.score,
      },
    };
  }

  if (fallbackAddress) {
    return {
      profileId: null,
      wallets: [fallbackAddress],
      primaryWallet: fallbackAddress,
      investigationId: investigationIdFor(null, fallbackAddress),
    };
  }

  return null;
}

/**
 * Verify that `address` is one of `profileId`'s attested wallets, and
 * return the profile's full wallet list if so (null otherwise). Checks
 * the locally-mirrored profile_addresses table first (cheap), falling
 * back to the live Ethos API for attestations newer than the nightly
 * sync. Used to validate `scan-p<profileId>` investigation writes so a
 * client can't save under another profile's key.
 */
export async function verifyProfileWallet(
  profileId: number,
  address: string
): Promise<string[] | null> {
  const addr = address.toLowerCase();

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("profile_addresses")
      .select("address")
      .eq("profile_id", profileId);
    if (!error && data) {
      const wallets = data
        .map((row: { address: string }) => row.address?.toLowerCase())
        .filter(Boolean);
      if (wallets.includes(addr)) return wallets;
    }
  } catch {
    // Fall through to the live API.
  }

  try {
    const profile = await fetchProfile(String(profileId));
    if (profile && profile.profileId === profileId) {
      const wallets = getWalletAddresses(profile);
      if (wallets.includes(addr)) return wallets;
    }
  } catch {
    // Unverifiable — treat as not owned.
  }
  return null;
}

/**
 * Resolve free-form scan input (address, @handle, x.com / Ethos profile
 * URL) to the profile and full attested-wallet set to scan. Uses the live
 * Ethos API rather than the locally-mirrored tables so fresh attestations
 * are picked up immediately. An address with no Ethos profile still
 * resolves (profileId null) — scanning arbitrary wallets stays supported.
 */
export async function resolveScanTarget(
  input: string
): Promise<ResolvedScanTarget | null> {
  const identifier = parseScanInput(input);
  if (!identifier) return null;

  const isAddress = isEthereumAddress(identifier);
  let profile: EthosProfile | null = null;
  try {
    profile = await fetchProfile(identifier);
  } catch {
    profile = null;
  }
  return await toResolvedTarget(profile, isAddress ? identifier : null);
}
