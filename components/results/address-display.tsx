"use client";

import { ExternalLink } from "lucide-react";
import { type ClusterScanResult } from "@/lib/cluster-scanner";
import { resolveAddressName, getExplorerAddressUrl } from "@/lib/scan-utils";
import { getAddressLabel } from "@/lib/known-addresses";

interface AddressDisplayProps {
  address: string;
  chain?: string;
  result: ClusterScanResult | null;
}

export function AddressDisplay({ address, chain, result }: AddressDisplayProps) {
  const name = resolveAddressName(address, result);
  const isResolved = name !== `${address.slice(0, 8)}...${address.slice(-4)}`;
  const funderProfile = result?.funderProfiles?.[address];
  const knownLabel = getAddressLabel(address);

  return (
    <span className="inline-flex items-center gap-1.5">
      {isResolved && funderProfile && (
        <a href={funderProfile.profileUrl} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">
          {name}
        </a>
      )}
      {isResolved && !funderProfile && knownLabel && (
        <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-border bg-muted/30 font-medium">{knownLabel}</span>
      )}
      {isResolved && !funderProfile && !knownLabel && (
        <span className="font-medium">{name}</span>
      )}
      <a
        href={getExplorerAddressUrl(address, chain)}
        target="_blank"
        rel="noopener noreferrer"
        className="font-mono text-muted-foreground hover:underline"
      >
        {address.slice(0, 8)}...{address.slice(-4)} <ExternalLink className="inline h-2.5 w-2.5 opacity-50" />
      </a>
    </span>
  );
}
