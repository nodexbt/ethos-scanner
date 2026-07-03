import { type ClusterScanResult, type ClusterCandidate } from "./cluster-scanner";
import { getAddressLabel } from "./known-addresses";

export function getScoreBorderColor(score: number): string {
  if (score < 1200) return "ring-yellow-600";
  if (score < 1400) return "ring-gray-400";
  if (score < 1600) return "ring-sky-400";
  if (score < 1800) return "ring-blue-500";
  if (score < 2000) return "ring-blue-700";
  return "ring-green-600";
}

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

export function buildConnectionSummary(
  candidate: ClusterCandidate,
  result: ClusterScanResult | null
): string[] {
  const targetName = result?.targetEthos?.displayName || result?.target.slice(0, 10) + "...";
  const name = candidate.ethosProfile?.displayName || candidate.address.slice(0, 10) + "...";
  const lines: string[] = [];

  // First funder
  if (candidate.firstFunders && candidate.firstFunders.length > 0 && result) {
    for (const ff of candidate.firstFunders) {
      const funderName = resolveAddressName(ff.funder, result);
      const isFundedByTarget = (result.targetWallets ?? [result.target]).includes(ff.funder);
      const isFundedByResult = !isFundedByTarget && [...result.strongCluster, ...result.possibleCluster]
        .some((c) => c.address !== candidate.address && (c.wallets?.includes(ff.funder) || c.address === ff.funder));

      let fundedOthers = 0;
      for (const other of [...result.strongCluster, ...result.possibleCluster]) {
        if (other.address === candidate.address) continue;
        if (other.firstFunders?.some((f) => f.funder === ff.funder)) fundedOthers++;
      }

      const exchangeLabel = ff.funderLabel || getAddressLabel(ff.funder);

      if (isFundedByTarget) {
        lines.push(`First funded by ${targetName} on ${ff.chain}.`);
      } else if (isFundedByResult) {
        lines.push(`First funded by ${funderName} (another result) on ${ff.chain}.`);
      } else if (candidate.sharedFirstFunder && ff.funder === result.targetFirstFunders?.find((f) => f.funder === ff.funder)?.funder) {
        if (exchangeLabel) {
          lines.push(`Same ${exchangeLabel} withdrawal address as ${targetName} on ${ff.chain} (likely same ${exchangeLabel} account).`);
        } else {
          lines.push(`Same first funder as ${targetName} on ${ff.chain}.`);
        }
      } else if (fundedOthers > 0) {
        if (exchangeLabel) {
          lines.push(`First funded by the same ${exchangeLabel} address on ${ff.chain} as ${fundedOthers} other result${fundedOthers > 1 ? "s" : ""} (likely same ${exchangeLabel} account).`);
        } else {
          lines.push(`First funded by ${funderName} on ${ff.chain}, which also funded ${fundedOthers} other result${fundedOthers > 1 ? "s" : ""}.`);
        }
      }
    }
  } else if (candidate.sharedFirstFunder) {
    lines.push(`Same first funder as ${targetName} on at least one chain.`);
  }

  // Direct transfers
  if (candidate.directCount > 0) {
    const parts: string[] = [];
    if (candidate.incomingCount > 0 && candidate.outgoingCount > 0) {
      parts.push(`Sent ${candidate.outgoingCount} and received ${candidate.incomingCount} transaction${candidate.directCount > 1 ? "s" : ""} with ${targetName}`);
    } else if (candidate.outgoingCount > 0) {
      parts.push(`Sent ${candidate.outgoingCount} transaction${candidate.outgoingCount > 1 ? "s" : ""} to ${targetName}`);
    } else {
      parts.push(`Received ${candidate.incomingCount} transaction${candidate.incomingCount > 1 ? "s" : ""} from ${targetName}`);
    }
    if (candidate.bidirectional) parts.push("funds flow both ways");
    if (candidate.repeatTransfer) parts.push("repeated pattern");
    lines.push(parts.join(", ") + ".");
  }

  // Shared incoming senders
  if (candidate.sharedFundingSources.length > 0) {
    lines.push(`${candidate.sharedFundingSources.length} address${candidate.sharedFundingSources.length > 1 ? "es" : ""} sent tokens to both ${name} and ${targetName}.`);
  }

  // Shared CEX deposit addresses
  if (candidate.sharedCexDeposits && candidate.sharedCexDeposits.length > 0) {
    for (const dep of candidate.sharedCexDeposits) {
      const others = dep.wallets
        .filter((w) => !(candidate.wallets || [candidate.address]).includes(w))
        .map((w) => resolveAddressName(w, result));
      if (others.length > 0) {
        lines.push(`Same ${dep.exchange} deposit address as ${others.slice(0, 3).join(", ")}${others.length > 3 ? ` and ${others.length - 3} more` : ""} (likely same ${dep.exchange} account).`);
      }
    }
  }

  // Multi-hop funding
  if (candidate.signals.some((s) => s.type === "multi_hop_funding")) {
    const detail = candidate.signals.find((s) => s.type === "multi_hop_funding")?.details || "";
    lines.push(`Discovered via multi-hop funding analysis: ${detail}.`);
  }

  // Ethos social signals
  if (candidate.invitedByTarget && candidate.invitedTarget) {
    lines.push(`Mutual invitation: ${targetName} invited ${name} and ${name} invited ${targetName} on Ethos.`);
  } else if (candidate.invitedByTarget) {
    lines.push(`Invited by ${targetName} on Ethos.`);
  } else if (candidate.invitedTarget) {
    lines.push(`Invited ${targetName} on Ethos.`);
  }

  if (candidate.mutualReviews) {
    lines.push(`${name} and ${targetName} reviewed each other on Ethos.`);
  }

  if (candidate.mutualVouches) {
    lines.push(`${name} and ${targetName} vouched for each other on Ethos.`);
  }

  return lines;
}

export function formatTime(ms: number): string {
  const totalSeconds = Math.max(1, Math.ceil(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
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
