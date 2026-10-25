"use client";

import { useCallback, useMemo, useState } from "react";
import { type ClusterCandidate, type ClusterScanResult } from "@/lib/cluster-scanner";
import { connectionPhrase, targetLabel } from "@/lib/scan-utils";
import { DegradedBanner } from "./degraded-banner";
import { ResultHeader, type ResultActions } from "./result-header";
import { LinkList } from "./link-list";
import { HowTheyConnect, TargetFirstFunders } from "./connection-summary";
import { ConnectionsCard } from "./connections-card";
import { ResearchDisclaimer } from "./research-disclaimer";
import { CandidateModal } from "./candidate-modal";

/**
 * A complete scan result: profile header, linked profiles, how they
 * connect, and the evidence dialog. Shared by the signed-in scanner and
 * the public share page, which differ only in the actions they pass.
 */
export function ResultView({
  result,
  scannedAt,
  scanning = false,
  isAdmin = false,
  saveNotice,
  investigationId,
  actions,
  onScanProfile,
}: {
  result: ClusterScanResult;
  scannedAt?: string | null;
  scanning?: boolean;
  isAdmin?: boolean;
  /** Why this result wasn't saved, if it wasn't. */
  saveNotice?: string | null;
  /** Enables second-degree connections from other saved scans. */
  investigationId?: string | null;
  actions?: ResultActions;
  /** Start a scan of another profile (@handle or address). */
  onScanProfile?: (input: string) => void;
}) {
  // The filter belongs to one result: switching targets drops it without
  // a reset effect.
  const [filterState, setFilterState] = useState<{ target: string; type: string } | null>(null);
  const filter = filterState?.target === result.target ? filterState.type : null;
  const setFilter = (type: string | null) => setFilterState(type ? { target: result.target, type } : null);

  const matches = useCallback(
    (c: ClusterCandidate) => !filter || c.signals.some((s) => s.type === filter && s.score > 0),
    [filter]
  );
  const strong = useMemo(() => result.strongCluster.filter(matches), [result, matches]);
  const possible = useMemo(() => result.possibleCluster.filter(matches), [result, matches]);
  const visible = useMemo(() => [...strong, ...possible], [strong, possible]);

  // Last opened candidate is kept while the dialog animates closed.
  const [modalCandidate, setModalCandidate] = useState<ClusterCandidate | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const openCandidate = useCallback((c: ClusterCandidate) => {
    setModalCandidate(c);
    setModalOpen(true);
  }, []);
  const modalIndex = modalCandidate ? visible.findIndex((c) => c.address === modalCandidate.address) : -1;
  const step = (delta: number) => {
    if (visible.length === 0 || modalIndex < 0) return;
    setModalCandidate(visible[(modalIndex + delta + visible.length) % visible.length]);
  };

  const filterLabel = filter
    ? `${visible.length} ${connectionPhrase(filter, targetLabel(result))}`
    : null;

  return (
    <div className="space-y-4">
      <DegradedBanner degraded={result.degraded} notice={saveNotice} />
      <ResultHeader result={result} scannedAt={scannedAt} scanning={scanning} isAdmin={isAdmin} actions={actions} />

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <LinkList
          result={result}
          strong={strong}
          possible={possible}
          filterLabel={filterLabel}
          onClearFilter={() => setFilter(null)}
          onSelect={openCandidate}
        />
        <aside className="min-w-0 space-y-4">
          <HowTheyConnect result={result} filter={filter} onFilter={setFilter} />
          <TargetFirstFunders result={result} />
          {investigationId && !scanning && (
            <ConnectionsCard investigationId={investigationId} scanning={scanning} onScanProfile={onScanProfile} />
          )}
          <ResearchDisclaimer />
        </aside>
      </div>

      {modalCandidate && (
        <CandidateModal
          candidate={modalCandidate}
          open={modalOpen}
          result={result}
          onClose={() => setModalOpen(false)}
          position={modalIndex >= 0 ? { index: modalIndex, total: visible.length } : null}
          onPrev={() => step(-1)}
          onNext={() => step(1)}
          onScanProfile={
            onScanProfile
              ? (input) => {
                  setModalOpen(false);
                  onScanProfile(input);
                }
              : undefined
          }
        />
      )}
    </div>
  );
}
