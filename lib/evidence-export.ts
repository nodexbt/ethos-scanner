import { type ClusterScanResult } from "@/lib/cluster-scanner";
import { describeSignal, scoringSignals } from "@/lib/scan-utils";

/** Stored X search evidence, keyed by wallet address. */
export type TwitterEvidence = Record<string, { tweets?: { url: string; author?: { userName?: string } }[] } | undefined>;

/**
 * The slash-report prompt for a scan: subject, on-chain evidence per linked
 * profile, and any stored X posts that mention the wallets. Pure, so it can
 * be tested without a browser.
 */
export function buildEvidencePrompt(result: ClusterScanResult, twitterEvidence: TwitterEvidence | null): string {
  const all = [...result.strongCluster, ...result.possibleCluster];
  let prompt = `Draft a slash report for the following subject based on the evidence provided.\n\n`;
  prompt += `## Subject\n- Wallet: ${result.target}\n`;
  if (result.targetEthos) {
    prompt += `- Ethos Profile: ${result.targetEthos.displayName}`;
    if (result.targetEthos.username) prompt += ` (@${result.targetEthos.username})`;
    prompt += `\n- Ethos Profile URL: ${result.targetEthos.profileUrl}`;
    prompt += `\n- Credibility Score: ${result.targetEthos.score}\n`;
  }
  prompt += `\n## On-Chain Evidence\n`;
  prompt += `- Networks scanned: ${Object.keys(result.networkStats).join(", ")}\n`;
  prompt += `- Total transactions analyzed: ${Object.values(result.networkStats).reduce((s, n) => s + n.txCount, 0)}\n`;
  prompt += `- Strong links: ${result.strongCluster.length}\n`;
  prompt += `- Possible links: ${result.possibleCluster.length}\n\n`;
  if (all.length > 0) {
    prompt += `### Linked Profiles\n`;
    for (const c of all) {
      const name = c.ethosProfile
        ? `${c.ethosProfile.displayName}${c.ethosProfile.username ? ` (@${c.ethosProfile.username})` : ""}`
        : c.address;
      prompt += `\n${name}\n- Address: ${c.address}\n`;
      prompt += `- Link: ${c.confidence === "high" ? "strong" : "possible"} (link strength ${c.score})\n`;
      if (c.ethosProfile) {
        prompt += `- Ethos Profile URL: ${c.ethosProfile.profileUrl}\n`;
        prompt += `- Credibility Score: ${c.ethosProfile.score}\n`;
      }
      prompt += `- Active on: ${c.networks.join(", ")}\n`;
      const scored = scoringSignals(c);
      if (scored.length > 0) prompt += `- Why linked: ${scored.map((s) => `${describeSignal(s, c, result).title} (+${s.score})`).join("; ")}\n`;
      if (c.directCount > 0) {
        // Counts are from the subject's side: outgoing = the subject sent.
        prompt += `- Direct transfers with subject (context, not scored): ${c.directCount} (subject sent ${c.outgoingCount}, received ${c.incomingCount})\n`;
      }
      if (c.sharedFundingSources.length > 0) prompt += `- Shared incoming senders (not first funders): ${c.sharedFundingSources.length}\n`;
    }
  }

  const mentions = Object.entries(twitterEvidence ?? {})
    .map(([address, ev]) => ({ address, tweets: ev?.tweets ?? [] }))
    .filter((m) => m.tweets.length > 0);
  if (mentions.length > 0) {
    prompt += `\n## Social Evidence\n`;
    prompt += `X posts that mention these wallets. Several distinct accounts posting the same address can indicate coordination.\n`;
    for (const m of mentions) {
      const authors = [...new Set(m.tweets.map((t) => t.author?.userName).filter(Boolean))];
      prompt += `\n- ${m.address}: ${m.tweets.length} post${m.tweets.length === 1 ? "" : "s"}${authors.length ? ` by @${authors.join(", @")}` : ""}\n`;
      for (const t of m.tweets.slice(0, 5)) prompt += `  - ${t.url}\n`;
    }
  }
  return prompt;
}

/** Save the prompt as a text file. */
export function downloadEvidence(result: ClusterScanResult, twitterEvidence: TwitterEvidence | null): void {
  const name = result.targetEthos?.username || result.target.slice(0, 10);
  const url = URL.createObjectURL(new Blob([buildEvidencePrompt(result, twitterEvidence)], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `slash-evidence-${name}-${new Date().toISOString().slice(0, 10)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}
