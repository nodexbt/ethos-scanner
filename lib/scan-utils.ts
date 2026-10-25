import { type ClusterScanResult, type ClusterCandidate, type Signal } from "./cluster-scanner";
import { getAddressLabel } from "./known-addresses";

export function getExplorerAddressUrl(address: string, chain?: string): string {
  switch (chain) {
    case "Base": return `https://basescan.org/address/${address}`;
    case "Arbitrum": return `https://arbiscan.io/address/${address}`;
    case "Optimism": return `https://optimistic.etherscan.io/address/${address}`;
    case "Polygon": return `https://polygonscan.com/address/${address}`;
    default: return `https://etherscan.io/address/${address}`;
  }
}

export function resolveAddressName(addr: string, result: ClusterScanResult | null): string {
  if (!result) return `${addr.slice(0, 8)}...${addr.slice(-4)}`;
  if ((result.targetWallets ?? [result.target]).includes(addr)) {
    return result.targetEthos?.displayName || `${addr.slice(0, 8)}...${addr.slice(-4)}`;
  }
  for (const c of [...result.strongCluster, ...result.possibleCluster]) {
    if (c.wallets?.includes(addr) || c.address === addr) {
      return c.ethosProfile?.displayName || `${addr.slice(0, 8)}...${addr.slice(-4)}`;
    }
  }
  const funderProfile = result.funderProfiles?.[addr];
  if (funderProfile) return funderProfile.displayName;
  const knownLabel = getAddressLabel(addr);
  if (knownLabel) return knownLabel;
  return `${addr.slice(0, 8)}...${addr.slice(-4)}`;
}

export function formatTime(ms: number): string {
  const totalSeconds = Math.max(1, Math.ceil(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

/**
 * "0.0036 ETH" for a first-funding transfer. Uses the symbol Alchemy
 * recorded with the transfer; results saved before that was stored fall
 * back to the symbol Alchemy reports for the chain's native token.
 * Returns null when the amount is unknown (e.g. a funder inferred from a
 * funding chain rather than read from the wallet's own history).
 */
export function formatFunderAmount(ff: { chain: string; value: number | string; asset?: string | null }): string | null {
  const value = parseFloat(String(ff.value));
  if (!Number.isFinite(value) || value <= 0) return null;
  const symbol = ff.asset || (ff.chain === "Polygon" ? "MATIC" : "ETH");
  return `${value.toFixed(4)} ${symbol}`;
}

export function getLogColor(level: string): string {
  switch (level) {
    case "success":
      return "text-green-600 dark:text-green-400";
    case "warn":
      return "text-amber-600 dark:text-amber-400 font-medium";
    case "error":
      return "text-red-600 dark:text-red-400";
    default:
      return "text-muted-foreground";
  }
}


/** Plain-language names for signal types, for the breakdown in the UI. */
export const SIGNAL_LABELS: Record<string, string> = {
  funded_by_target: "First funded by the target",
  funded_by_cluster: "First funded by a linked wallet",
  shared_first_funder: "Same first funder as the target",
  shared_exchange_funder: "Same exchange withdrawal address",
  shared_cex_deposit: "Shared exchange deposit address",
  multi_hop_funding: "Funded by one of the target's funders",
  shared_incoming_sender: "Shared incoming sender",
  direct_transfer: "Direct transfer with the target",
  repeat_transfer: "Repeated transfers",
  bidirectional: "Funds flow both ways",
  invited_by_target: "Invited by the target on Ethos",
  invited_target: "Invited the target on Ethos",
  mutual_reviews: "Mutual Ethos reviews",
  mutual_vouches: "Mutual Ethos vouches",
};

/** "0x1234…abcd" */
export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** How the scanned profile is named in sentences. */
export function targetLabel(result: ClusterScanResult): string {
  return result.targetEthos?.displayName || shortAddress(result.target);
}

/** Signals that add points, strongest first. */
export function scoringSignals(candidate: ClusterCandidate): Signal[] {
  return candidate.signals.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
}

export interface SignalText {
  /** Heading in the evidence dialog. */
  title: string;
  /** One-sentence explanation under the heading. */
  detail: string;
  /** Compact form for list rows. */
  short: string;
}

const firstNumber = (s?: string) => Number((s?.match(/\d+/) ?? ["0"])[0]);
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1) + (/[.!?]$/.test(s) ? "" : ".");

/** Plain-English wording for a scoring signal, replacing raw details like "senders=4". */
export function describeSignal(s: Signal, candidate: ClusterCandidate, result: ClusterScanResult): SignalText {
  const t = targetLabel(result);
  switch (s.type) {
    case "funded_by_target": {
      const targetWallets = result.targetWallets ?? [result.target];
      const ff = candidate.firstFunders?.find((f) => targetWallets.includes(f.funder));
      return {
        title: `First funded by ${t}`,
        short: `First funded by ${t}`,
        detail: `${t}'s wallet sent this wallet its first-ever transaction${ff ? ` on ${ff.chain}` : ""}.`,
      };
    }
    case "funded_by_cluster":
      return {
        title: "First funded by another linked wallet",
        short: "First funded by a linked wallet",
        detail: "Its first-ever transaction came from a wallet that is also in these results.",
      };
    case "shared_first_funder":
      return {
        title: `Same first funder as ${t}`,
        short: `Same first funder as ${t}`,
        detail: s.details?.startsWith("first funded by")
          ? sentence(s.details.replace("the target", t))
          : "Both wallets were first funded by the same address.",
      };
    case "shared_exchange_funder": {
      const exchange = s.details?.match(/^same (.+) withdrawal address$/)?.[1] ?? "exchange";
      return {
        title: `Same ${exchange} withdrawal address`,
        short: `Same ${exchange} funder`,
        detail: `Both were first funded from the same ${exchange} withdrawal address. Weaker than a private funder, because exchange hot wallets fund many unrelated people.`,
      };
    }
    case "shared_cex_deposit": {
      const exchange = candidate.sharedCexDeposits?.[0]?.exchange ?? "exchange";
      return {
        title: `Deposits to the same ${exchange} account`,
        short: "Same exchange account",
        detail: `Sent funds to the same ${exchange} deposit address as another wallet in these results. Deposit addresses are unique to one customer.`,
      };
    }
    case "multi_hop_funding":
      return {
        title: "Found through a funding chain",
        short: "Funding chain",
        detail: s.details ? sentence(s.details.replace("the target", t)) : `Received funds from an address that also funded ${t}.`,
      };
    case "shared_incoming_sender": {
      const n = firstNumber(s.details) || candidate.sharedFundingSources.length;
      return {
        title: `${n} sender${n === 1 ? "" : "s"} in common`,
        short: `${n} shared sender${n === 1 ? "" : "s"}`,
        detail: `${n === 1 ? "One address has" : `${n} addresses have`} sent funds to both ${t} and this wallet. On its own this does not show who controls either.`,
      };
    }
    default: {
      const label = SIGNAL_LABELS[s.type] ?? s.type;
      return { title: label, short: label, detail: s.details ? sentence(s.details) : "" };
    }
  }
}

/** Scoring signal types in the order "How they connect" lists them. */
export const CONNECTION_TYPES = [
  "funded_by_target",
  "funded_by_cluster",
  "shared_first_funder",
  "shared_cex_deposit",
  "shared_exchange_funder",
  "multi_hop_funding",
  "shared_incoming_sender",
] as const;

/** Phrase completing "<count> …" in the "How they connect" panel. */
export function connectionPhrase(type: string, t: string): string {
  switch (type) {
    case "funded_by_target": return `first funded by ${t}`;
    case "funded_by_cluster": return "first funded by another linked wallet";
    case "shared_first_funder": return `share ${t}'s first funder`;
    case "shared_cex_deposit": return "use the same exchange account";
    case "shared_exchange_funder": return "share an exchange withdrawal funder";
    case "multi_hop_funding": return "found through a funding chain";
    case "shared_incoming_sender": return `share senders with ${t}`;
    default: return SIGNAL_LABELS[type] ?? type;
  }
}

/** Mirrors confidenceFor() in lib/cluster-scanner.ts. Keep in sync. */
export const STRONG_RULE =
  "Strong: first funded by the target or its cluster, or 15+ points across two or more signal types. Possible: 8+ points. Signals at 0 points are shown for context and do not change the total.";
