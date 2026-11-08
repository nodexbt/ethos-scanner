import type { InvestigationRow } from "@/lib/db/investigations";

/**
 * What a shared link (/s/<id>, no session) is allowed to see. The stored row
 * carries more than the share page renders: the scan log names every wallet
 * the scan touched, `usage` is admin-only in the signed-in UI, and
 * twitter_evidence is investigator notes. Only the result itself, the target
 * and when it was scanned go out; the stored id and share id stay server-side.
 */
export interface PublicSharePayload {
  target: string;
  targetName: string | null;
  updatedAt: string | null;
  clusterResult: unknown;
}

export function publicSharePayload(row: InvestigationRow): PublicSharePayload {
  const cr = row.clusterResult;
  let clusterResult: unknown = cr;
  if (cr && typeof cr === "object") {
    // `logs` is a required field of ClusterScanResult, so keep the key.
    const { usage: _usage, ...rest } = cr as Record<string, unknown>;
    void _usage;
    clusterResult = { ...rest, logs: [] };
  }
  return {
    target: row.target,
    targetName: row.targetName,
    updatedAt: row.updatedAt,
    clusterResult,
  };
}
