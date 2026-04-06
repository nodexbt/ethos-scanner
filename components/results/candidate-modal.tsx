"use client";

import { X, ExternalLink } from "lucide-react";
import { motion } from "framer-motion";
import { type ClusterCandidate, type ClusterScanResult } from "@/lib/cluster-scanner";
import {
  getScoreBorderColor,
  getExplorerAddressUrl,
  resolveAddressName,
  buildConnectionSummary,
} from "@/lib/scan-utils";
import { AddressDisplay } from "./address-display";
import { safeExternalUrl } from "@/lib/utils";

interface CandidateModalProps {
  candidate: ClusterCandidate;
  result: ClusterScanResult;
  onClose: () => void;
}

export function CandidateModal({ candidate, result, onClose }: CandidateModalProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ duration: 0.2 }}
        className="bg-background border border-border rounded-xl shadow-2xl w-full max-w-2xl max-h-[95vh] sm:max-h-[85vh] overflow-y-auto mx-2 sm:mx-0"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start gap-3 p-5 border-b sticky top-0 bg-background rounded-t-xl z-10">
          {candidate.ethosProfile?.avatarUrl && (
            <img
              src={candidate.ethosProfile.avatarUrl}
              alt={candidate.ethosProfile.displayName}
              className={`h-12 w-12 rounded-full ring-2 ${getScoreBorderColor(candidate.ethosProfile.score)}`}
            />
          )}
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-lg">
              {candidate.ethosProfile?.displayName || `${candidate.address.slice(0, 12)}...${candidate.address.slice(-6)}`}
            </div>
            <div className="text-sm text-muted-foreground">
              {candidate.ethosProfile?.username && `@${candidate.ethosProfile.username} · `}
              {candidate.confidence === "high" ? "Strong" : "Possible"} match · Score: {candidate.score}
            </div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 p-2 rounded-lg hover:bg-muted transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Profile links */}
          <div className="flex flex-wrap gap-2">
            {candidate.ethosProfile && (
              <a
                href={safeExternalUrl(candidate.ethosProfile.profileUrl)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs border border-border rounded-md px-2.5 py-1.5 hover:bg-muted/50 transition-colors"
              >
                Ethos Profile <ExternalLink className="h-3 w-3 opacity-50" />
              </a>
            )}
            {(candidate.wallets || [candidate.address]).map((wallet) => (
              <a
                key={wallet}
                href={getExplorerAddressUrl(wallet, candidate.networks[0])}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs border border-border rounded-md px-2.5 py-1.5 hover:bg-muted/50 transition-colors font-mono"
              >
                {wallet.slice(0, 8)}...{wallet.slice(-6)} <ExternalLink className="h-3 w-3 opacity-50" />
              </a>
            ))}
          </div>

          {/* Summary */}
          <div>
            <h3 className="text-sm font-semibold mb-2">Summary</h3>
            <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1">
              {buildConnectionSummary(candidate, result).map((line, i) => (
                <div key={i} className="flex gap-1.5 text-xs text-muted-foreground">
                  <span className="shrink-0">-</span>
                  <span>{line}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Connection details */}
          <div>
            <h3 className="text-sm font-semibold mb-2">Connection Details</h3>
            <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
              {/* Direct transfers */}
              {candidate.directCount > 0 && (
                <div className="space-y-1">
                  <div className="text-xs font-medium">Direct Transfers</div>
                  <div className="text-xs text-muted-foreground">
                    {candidate.directCount} transfer{candidate.directCount !== 1 && "s"} detected
                    {" "}({candidate.incomingCount} incoming, {candidate.outgoingCount} outgoing)
                    {candidate.bidirectional && (
                      <span className="ml-1 text-amber-500 font-medium">-- funds flow both ways</span>
                    )}
                    {candidate.repeatTransfer && (
                      <span className="ml-1 text-amber-500 font-medium">-- repeated pattern</span>
                    )}
                  </div>
                </div>
              )}

              {/* First funders */}
              {candidate.firstFunders && candidate.firstFunders.length > 0 && (
                <div className="space-y-1">
                  <div className="text-xs font-medium flex items-center gap-1.5">
                    First Funder{candidate.firstFunders.length > 1 ? "s" : ""}
                    {candidate.sharedFirstFunder && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-500 text-white font-medium">same as target</span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    The first wallet to send ETH to this address on each chain:
                  </div>
                  {candidate.firstFunders.map((ff, i) => (
                    <div key={i} className="flex items-center justify-between text-xs border border-border rounded px-2 py-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground w-16 shrink-0">{ff.chain}</span>
                        <AddressDisplay address={ff.funder} chain={ff.chain} result={result} />
                      </div>
                      <span className="text-muted-foreground shrink-0">{parseFloat(String(ff.value)).toFixed(4)} ETH</span>
                    </div>
                  ))}
                  {candidate.sharedFirstFunder && result.targetFirstFunders && result.targetFirstFunders.length > 0 && (
                    <div className="text-xs text-red-500 dark:text-red-400 font-medium mt-1">
                      The target wallet was also first funded by the same address -- this is a strong sybil indicator.
                    </div>
                  )}
                </div>
              )}

              {/* Shared incoming senders */}
              {candidate.sharedFundingSources.length > 0 && (() => {
                const firstFunderAddrs = new Set(
                  (candidate.firstFunders || []).map((f) => f.funder)
                );
                const targetFFAddrs = new Set(
                  (result.targetFirstFunders || []).map((f) => f.funder)
                );
                const senders = candidate.sharedFundingSources;
                const isFirstFunder = (addr: string) => firstFunderAddrs.has(addr) || targetFFAddrs.has(addr);
                const MAX_SHOWN = 5;

                return (
                  <div className="space-y-1">
                    <div className="text-xs font-medium">Shared Incoming Senders</div>
                    <div className="text-xs text-muted-foreground">
                      {senders.length} address{senders.length !== 1 && "es"} sent tokens to both the target and this wallet. This does not mean they funded the wallet — it only indicates shared incoming transaction sources.
                    </div>
                    <div className="space-y-0.5">
                      {senders.slice(0, MAX_SHOWN).map((addr) => (
                        <div key={addr} className="flex items-center gap-1.5 text-xs">
                          <AddressDisplay address={addr} result={result} />
                          {isFirstFunder(addr) && (
                            <span className="text-[9px] px-1 py-0.5 rounded bg-red-500/20 text-red-500 font-medium">first funder</span>
                          )}
                        </div>
                      ))}
                      {senders.length > MAX_SHOWN && (
                        <div className="text-[10px] text-muted-foreground">
                          + {senders.length - MAX_SHOWN} more shared sender{senders.length - MAX_SHOWN !== 1 && "s"}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Ethos social connections */}
              {(candidate.invitedByTarget || candidate.invitedTarget || candidate.mutualReviews || candidate.mutualVouches) && (
                <div className="space-y-1">
                  <div className="text-xs font-medium">Ethos Social Connections</div>
                  <div className="text-xs text-muted-foreground space-y-0.5">
                    {candidate.invitedByTarget && (
                      <div>Invited by {result.targetEthos?.displayName || "the target"} on Ethos.</div>
                    )}
                    {candidate.invitedTarget && (
                      <div>Invited {result.targetEthos?.displayName || "the target"} on Ethos.</div>
                    )}
                    {candidate.mutualReviews && (
                      <div>Mutual reviews: both reviewed each other on Ethos.</div>
                    )}
                    {candidate.mutualVouches && (
                      <div>Mutual vouches: both vouched for each other on Ethos.</div>
                    )}
                  </div>
                </div>
              )}

              {/* Shared CEX deposit addresses */}
              {candidate.sharedCexDeposits && candidate.sharedCexDeposits.length > 0 && (
                <div className="space-y-1">
                  <div className="text-xs font-medium">Shared Exchange Deposit Addresses</div>
                  <div className="text-xs text-muted-foreground">
                    This wallet and other cluster members deposited to the same exchange address. CEX deposit addresses are unique per account, so this strongly suggests the same exchange account.
                  </div>
                  <div className="space-y-1.5">
                    {candidate.sharedCexDeposits.map((dep, i) => (
                      <div key={i} className="text-xs border border-border rounded px-2.5 py-2 space-y-1">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-border bg-muted/30 font-medium">{dep.exchange}</span>
                            <a
                              href={getExplorerAddressUrl(dep.depositAddress, dep.network)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-mono text-muted-foreground hover:underline"
                            >
                              {dep.depositAddress.slice(0, 10)}...{dep.depositAddress.slice(-6)} <ExternalLink className="inline h-2.5 w-2.5 opacity-50" />
                            </a>
                          </div>
                          <span className="text-muted-foreground">{dep.network}</span>
                        </div>
                        <div className="text-muted-foreground">
                          Also used by: {dep.wallets
                            .filter((w) => !(candidate.wallets || [candidate.address]).includes(w))
                            .map((w) => resolveAddressName(w, result))
                            .join(", ")}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* No connections found */}
              {candidate.directCount === 0 &&
                candidate.sharedFundingSources.length === 0 &&
                !candidate.invitedByTarget &&
                !candidate.invitedTarget &&
                !candidate.mutualReviews &&
                !candidate.mutualVouches && (
                <div className="text-xs text-muted-foreground">No specific connection details available.</div>
              )}
            </div>
          </div>

          {/* Network activity */}
          <div>
            <h3 className="text-sm font-semibold mb-2">Active Networks</h3>
            <div className="flex flex-wrap gap-1.5">
              {candidate.networks.map((network) => (
                <span key={network} className="text-xs border border-border rounded-md px-2.5 py-1">
                  {network}
                </span>
              ))}
            </div>
          </div>

          {/* Ethos profile details */}
          {candidate.ethosProfile && (
            <div>
              <h3 className="text-sm font-semibold mb-2">Ethos Profile</h3>
              <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Credibility Score</span>
                  <span className="font-medium">{candidate.ethosProfile.score}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Profile ID</span>
                  <span className="font-medium">{candidate.ethosProfile.profileId}</span>
                </div>
                {candidate.ethosProfile.username && (
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">X/Twitter</span>
                    <span className="font-medium">@{candidate.ethosProfile.username}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
