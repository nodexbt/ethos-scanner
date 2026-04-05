"use client";

import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Search,
  Loader2,
  AlertTriangle,
  Shield,
  Wallet,
  ExternalLink,
  ImagePlus,
  X,
  ClipboardPaste,
  FileText,
  Save,
  FolderOpen,
  Trash2,
  ChevronDown,
  ChevronRight,
  Copy,
  Share2,
} from "lucide-react";
import {
  type ClusterScanResult,
  type ClusterCandidate,
  type LogEntry,
  type ScanProgress,
} from "@/lib/cluster-scanner";
import { getAddressLabel } from "@/lib/known-addresses";
import { ThemeToggle } from "@/components/theme-toggle";
import { useSession, signIn, signOut } from "next-auth/react";
import { motion, AnimatePresence } from "framer-motion";
import { CandidateCard } from "@/components/results/candidate-card";
import { CandidateModal } from "@/components/results/candidate-modal";

// --- Saved Investigations ---

interface InvestigationSummary {
  id: string;
  target: string;
  targetName: string | null;
  targetAvatar: string | null;
  savedAt: number;
  strongCount: number;
  possibleCount: number;
  hasAnalysis: boolean;
  shareId: string | null;
  isPublic: boolean;
}

export default function Home() {
  const { data: session, status: sessionStatus } = useSession();
  const [walletInput, setWalletInput] = useState("");
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clusterResult, setClusterResult] = useState<ClusterScanResult | null>(null);
  const [clusterLogs, setClusterLogs] = useState<LogEntry[]>([]);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Screenshot state: address -> data URL
  const [screenshots, setScreenshots] = useState<Map<string, string>>(new Map());
  const [savedInvestigations, setSavedInvestigations] = useState<InvestigationSummary[]>([]);
  const [currentInvestigationId, setCurrentInvestigationId] = useState<string | null>(null);
  const [loginPassphrase, setLoginPassphrase] = useState("");
  const [loginError, setLoginError] = useState("");
  const [selectedCandidate, setSelectedCandidate] = useState<ClusterCandidate | null>(null);
  const [showFirstFunders, setShowFirstFunders] = useState(false);
  const [showPossible, setShowPossible] = useState(false);
  const fileInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  useEffect(() => {
    fetch("/api/investigations").then((r) => r.json()).then(setSavedInvestigations).catch(() => {});

    // Check if URL has a wallet address to load
    const path = window.location.pathname;
    const match = path.match(/^\/scan\/(0x[a-fA-F0-9]{40})$/i);
    if (match) {
      const addr = match[1].toLowerCase();
      setWalletInput(addr);
      loadCachedScan(addr);
    }
  }, []);

  const [logExpanded, setLogExpanded] = useState(true);
  const [loadingCached, setLoadingCached] = useState(false);

  const pushScanUrl = (addr: string) => {
    const url = `/scan/${addr.toLowerCase()}`;
    if (window.location.pathname !== url) {
      window.history.pushState({}, "", url);
    }
  };

  const loadCachedScan = async (addr: string) => {
    const cachedId = `scan-${addr.toLowerCase()}`;
    setLoadingCached(true);
    try {
      const resp = await fetch(`/api/investigations/${cachedId}`);
      if (resp.ok) {
        const data = await resp.json();
        setClusterResult(data.clusterResult);
        setCurrentInvestigationId(cachedId);
        setScreenshots(new Map());
        setClusterLogs([]);
        setError(null);
        setLoadingCached(false);
        pushScanUrl(addr);
        return true;
      }
    } catch {}
    setLoadingCached(false);
    return false;
  };

  const runFreshScan = async (addr: string) => {
    setScanning(true);
    setClusterResult(null);
    setClusterLogs([]);
    setScanProgress(null);
    setError(null);
    setScreenshots(new Map());
    setCurrentInvestigationId(null);
    setLogExpanded(true);

    let scanResult: ClusterScanResult | null = null;

    try {
      const resp = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: addr }),
      });

      if (!resp.ok) {
        const data = await resp.json();
        setError(data.error || "Scan failed");
        return;
      }

      const reader = resp.body?.getReader();
      if (!reader) {
        setError("Streaming not supported");
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.type === "log") {
              setClusterLogs((prev) => [...prev, msg.data]);
            } else if (msg.type === "progress") {
              setScanProgress(msg.data);
            } else if (msg.type === "result") {
              const result = msg.data as ClusterScanResult;
              result.strongCluster.forEach((c) => {
                c.signalTypes = new Set(c.signalTypes as unknown as string[]);
              });
              result.possibleCluster.forEach((c) => {
                c.signalTypes = new Set(c.signalTypes as unknown as string[]);
              });
              setClusterResult(result);
              scanResult = result;
            } else if (msg.type === "error") {
              setError(msg.data);
            }
          } catch {
            // Skip malformed lines
          }
        }
      }

      // Auto-save after scan completes
      if (scanResult) {
        const id = `scan-${addr.toLowerCase()}`;
        await fetch("/api/investigations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id,
            target: addr.toLowerCase(),
            targetName: (scanResult as ClusterScanResult).targetEthos?.displayName ?? null,
            clusterResult: scanResult,
            aiAnalysis: null,
          }),
        });
        setCurrentInvestigationId(id);
        pushScanUrl(addr);
        refreshInvestigations();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cluster scan failed");
    } finally {
      setScanning(false);
      setScanProgress(null);
    }
  };

  const startScan = async (e: React.FormEvent) => {
    e.preventDefault();
    const addr = walletInput.trim().toLowerCase();
    if (!addr || !/^0x[a-fA-F0-9]{40}$/.test(addr)) {
      setError("Please enter a valid EVM address (0x...)");
      return;
    }

    // Check if we have a cached scan
    const cached = await loadCachedScan(addr);
    if (cached) return;

    await runFreshScan(addr);
  };

  const getScoreBorderColor = (score: number): string => {
    if (score < 1200) return "ring-yellow-600";
    if (score < 1400) return "ring-gray-400";
    if (score < 1600) return "ring-sky-400";
    if (score < 1800) return "ring-blue-500";
    if (score < 2000) return "ring-blue-700";
    return "ring-green-600";
  };

  const getLogColor = (level: LogEntry["level"]) => {
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
  };

  const getExplorerAddressUrl = (address: string, chain?: string) => {
    switch (chain) {
      case "Base": return `https://basescan.org/address/${address}`;
      case "Arbitrum": return `https://arbiscan.io/address/${address}`;
      case "Optimism": return `https://optimistic.etherscan.io/address/${address}`;
      case "Polygon": return `https://polygonscan.com/address/${address}`;
      default: return `https://etherscan.io/address/${address}`;
    }
  };

  const refreshInvestigations = () => {
    fetch("/api/investigations").then((r) => r.json()).then(setSavedInvestigations).catch(() => {});
  };

  const handleSaveInvestigation = async () => {
    if (!clusterResult) return;
    const id = currentInvestigationId || `scan-${clusterResult.target}`;
    await fetch("/api/investigations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id,
        target: clusterResult.target,
        targetName: clusterResult.targetEthos?.displayName ?? null,
        clusterResult,
        screenshots: Object.fromEntries(screenshots),
        aiAnalysis: null,
      }),
    });
    setCurrentInvestigationId(id);
    refreshInvestigations();
  };

  const handleLoadInvestigation = async (inv: InvestigationSummary) => {
    const resp = await fetch(`/api/investigations/${inv.id}`);
    if (!resp.ok) return;
    const data = await resp.json();
    setClusterResult(data.clusterResult);
    setScreenshots(new Map(Object.entries(data.screenshots || {})));
    setCurrentInvestigationId(inv.id);
    setClusterLogs([]);
    setScanProgress(null);
    setWalletInput(inv.target);
    setError(null);
  };

  const handleDeleteInvestigation = async (id: string) => {
    await fetch(`/api/investigations/${id}`, { method: "DELETE" });
    refreshInvestigations();
    if (currentInvestigationId === id) setCurrentInvestigationId(null);
  };

  const handleShareInvestigation = async (id: string) => {
    const resp = await fetch(`/api/investigations/${id}`, { method: "PATCH" });
    if (!resp.ok) return;
    const { shareId } = await resp.json();
    const shareUrl = `${window.location.origin}/s/${shareId}`;
    navigator.clipboard.writeText(shareUrl);
    refreshInvestigations();
  };

  const handleScreenshotUpload = (address: string, file: File) => {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      setScreenshots((prev) => new Map(prev).set(address, dataUrl));
    };
    reader.readAsDataURL(file);
  };

  const removeScreenshot = (address: string) => {
    setScreenshots((prev) => {
      const next = new Map(prev);
      next.delete(address);
      return next;
    });
  };

  // Handle paste from clipboard for a specific wallet
  const handlePaste = (address: string) => {
    navigator.clipboard.read().then((items) => {
      for (const item of items) {
        const imageType = item.types.find((t) => t.startsWith("image/"));
        if (imageType) {
          item.getType(imageType).then((blob) => {
            handleScreenshotUpload(address, new File([blob], "screenshot.png", { type: imageType }));
          });
          return;
        }
      }
    }).catch(() => {
      // Clipboard API not available or no image
    });
  };

  const exportInvestigation = () => {
    if (!clusterResult) return;

    const allCandidates = [...clusterResult.strongCluster, ...clusterResult.possibleCluster];

    // Build the prompt text
    let prompt = `Draft a slash report for the following subject based on the evidence provided.\n\n`;

    prompt += `## Subject\n`;
    prompt += `- Wallet: ${clusterResult.target}\n`;
    if (clusterResult.targetEthos) {
      prompt += `- Ethos Profile: ${clusterResult.targetEthos.displayName}`;
      if (clusterResult.targetEthos.username) prompt += ` (@${clusterResult.targetEthos.username})`;
      prompt += `\n- Ethos Profile URL: ${clusterResult.targetEthos.profileUrl}`;
      prompt += `\n- Credibility Score: ${clusterResult.targetEthos.score}\n`;
    }
    prompt += `\n`;

    prompt += `## On-Chain Evidence\n`;
    prompt += `- Networks scanned: ${Object.keys(clusterResult.networkStats).join(", ")}\n`;
    prompt += `- Total transactions analyzed: ${Object.values(clusterResult.networkStats).reduce((s, n) => s + n.txCount, 0)}\n`;
    prompt += `- Strong cluster wallets identified: ${clusterResult.strongCluster.length}\n`;
    prompt += `- Possible cluster candidates: ${clusterResult.possibleCluster.length}\n\n`;

    if (allCandidates.length > 0) {
      prompt += `### Linked Wallets\n`;
      for (const c of allCandidates) {
        const name = c.ethosProfile
          ? `${c.ethosProfile.displayName}${c.ethosProfile.username ? ` (@${c.ethosProfile.username})` : ""}`
          : c.address;
        prompt += `\n${name}\n`;
        prompt += `- Address: ${c.address}\n`;
        prompt += `- Cluster confidence: ${c.confidence} (score: ${c.score})\n`;
        if (c.ethosProfile) {
          prompt += `- Ethos Profile URL: ${c.ethosProfile.profileUrl}\n`;
          prompt += `- Credibility Score: ${c.ethosProfile.score}\n`;
        }
        prompt += `- Active on: ${c.networks.join(", ")}\n`;
        prompt += `- Signals detected: ${c.signals.map((s) => `${s.type} (${s.score > 0 ? "+" : ""}${s.score})`).join(", ")}\n`;
        if (c.directCount > 0) {
          prompt += `- Direct transfers with subject: ${c.directCount} (in: ${c.incomingCount}, out: ${c.outgoingCount})`;
          if (c.bidirectional) prompt += ` -- bidirectional`;
          if (c.repeatTransfer) prompt += ` -- repeated`;
          prompt += `\n`;
        }
        if (c.sharedFundingSources.length > 0) prompt += `- Shared incoming senders (not first funders): ${c.sharedFundingSources.length}\n`;
        if (screenshots.has(c.address)) prompt += `- X/Twitter search screenshot attached (see image)\n`;
      }
    }

    const screenshotCount = screenshots.size;
    if (screenshotCount > 0) {
      prompt += `\n## Social Evidence\n`;
      prompt += `${screenshotCount} X/Twitter search screenshot(s) are attached alongside this prompt.\n`;
      prompt += `Examine whether multiple distinct X accounts have posted the same wallet address, which indicates coordinated behavior.\n`;
    }

    // Save prompt as text file
    const targetName = clusterResult.targetEthos?.username || clusterResult.target.slice(0, 10);
    const timestamp = new Date().toISOString().slice(0, 10);

    const promptBlob = new Blob([prompt], { type: "text/plain" });
    const promptUrl = URL.createObjectURL(promptBlob);
    const promptLink = document.createElement("a");
    promptLink.href = promptUrl;
    promptLink.download = `slash-evidence-${targetName}-${timestamp}.txt`;
    promptLink.click();
    URL.revokeObjectURL(promptUrl);

    // Save each screenshot as a separate file
    let imgIndex = 0;
    for (const [address, dataUrl] of screenshots) {
      imgIndex++;
      const candidateName = allCandidates.find((c) => c.address === address)?.ethosProfile?.username
        || address.slice(0, 10);

      // Convert data URL to blob
      const byteString = atob(dataUrl.split(",")[1]);
      const mimeType = dataUrl.split(",")[0].split(":")[1].split(";")[0];
      const ab = new ArrayBuffer(byteString.length);
      const ia = new Uint8Array(ab);
      for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
      const imgBlob = new Blob([ab], { type: mimeType });
      const ext = mimeType.split("/")[1] || "png";

      const imgUrl = URL.createObjectURL(imgBlob);
      const imgLink = document.createElement("a");
      imgLink.href = imgUrl;
      imgLink.download = `screenshot-${imgIndex}-${candidateName}.${ext}`;

      // Small delay between downloads so browser doesn't block them
      setTimeout(() => {
        imgLink.click();
        URL.revokeObjectURL(imgUrl);
      }, imgIndex * 200);
    }
  };

  const formatTime = (ms: number): string => {
    const totalSeconds = Math.max(1, Math.ceil(ms / 1000));
    if (totalSeconds < 60) return `${totalSeconds}s`;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  };

  const targetName = clusterResult?.targetEthos?.displayName || clusterResult?.target.slice(0, 10) + "...";

  // Collect all first funder addresses across all candidates to detect shared funders
  const allCandidateFirstFunderAddrs = new Set<string>();
  if (clusterResult) {
    for (const c of [...clusterResult.strongCluster, ...clusterResult.possibleCluster]) {
      for (const ff of c.firstFunders || []) {
        allCandidateFirstFunderAddrs.add(ff.funder);
      }
    }
  }

  // Resolve a wallet address to a display name (check target, candidates, then funder profiles)
  const resolveAddressName = (addr: string): string => {
    if (!clusterResult) return `${addr.slice(0, 8)}...${addr.slice(-4)}`;
    if (addr === clusterResult.target) {
      return clusterResult.targetEthos?.displayName || `${addr.slice(0, 8)}...${addr.slice(-4)}`;
    }
    for (const c of [...clusterResult.strongCluster, ...clusterResult.possibleCluster]) {
      if (c.wallets?.includes(addr) || c.address === addr) {
        return c.ethosProfile?.displayName || `${addr.slice(0, 8)}...${addr.slice(-4)}`;
      }
    }
    const funderProfile = clusterResult.funderProfiles?.[addr];
    if (funderProfile) return funderProfile.displayName;
    const knownLabel = getAddressLabel(addr);
    if (knownLabel) return knownLabel;
    return `${addr.slice(0, 8)}...${addr.slice(-4)}`;
  };

  const buildConnectionSummary = (candidate: ClusterCandidate): string[] => {
    const name = candidate.ethosProfile?.displayName || candidate.address.slice(0, 10) + "...";
    const lines: string[] = [];

    // First funder - show if meaningful
    if (candidate.firstFunders && candidate.firstFunders.length > 0 && clusterResult) {
      for (const ff of candidate.firstFunders) {
        const funderName = resolveAddressName(ff.funder);
        const isFundedByTarget = ff.funder === clusterResult.target;
        const isFundedByResult = !isFundedByTarget && [...clusterResult.strongCluster, ...clusterResult.possibleCluster]
          .some((c) => c.address !== candidate.address && (c.wallets?.includes(ff.funder) || c.address === ff.funder));

        let fundedOthers = 0;
        for (const other of [...clusterResult.strongCluster, ...clusterResult.possibleCluster]) {
          if (other.address === candidate.address) continue;
          if (other.firstFunders?.some((f) => f.funder === ff.funder)) fundedOthers++;
        }

        const exchangeLabel = ff.funderLabel || getAddressLabel(ff.funder);

        if (isFundedByTarget) {
          lines.push(`First funded by ${targetName} on ${ff.chain}.`);
        } else if (isFundedByResult) {
          lines.push(`First funded by ${funderName} (another result) on ${ff.chain}.`);
        } else if (candidate.sharedFirstFunder && ff.funder === clusterResult.targetFirstFunders?.find((f) => f.funder === ff.funder)?.funder) {
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
          .map((w) => resolveAddressName(w));
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
  };

  // Render a wallet address with its Ethos profile name if available
  const renderAddress = (addr: string, chain?: string) => {
    const name = resolveAddressName(addr);
    const isResolved = name !== `${addr.slice(0, 8)}...${addr.slice(-4)}`;
    const funderProfile = clusterResult?.funderProfiles?.[addr];
    const knownLabel = getAddressLabel(addr);
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
          href={getExplorerAddressUrl(addr, chain)}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-muted-foreground hover:underline"
        >
          {addr.slice(0, 8)}...{addr.slice(-4)} <ExternalLink className="inline h-2.5 w-2.5 opacity-50" />
        </a>
      </span>
    );
  };

  const hasResults = clusterResult !== null && !scanning;

  // Loading state
  if (sessionStatus === "loading") {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Not logged in
  const bypassAuth = process.env.NEXT_PUBLIC_BYPASS_AUTH === "true";

  if (!session && !bypassAuth) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center">
            <Shield className="h-10 w-10 mx-auto mb-2" />
            <CardTitle>Ethos Sybil Scanner</CardTitle>
            <CardDescription>
              Enter passphrase to access the scanner.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <form onSubmit={async (e) => {
              e.preventDefault();
              setLoginError("");
              const res = await signIn("credentials", {
                passphrase: loginPassphrase,
                redirect: false,
              });
              if (res?.error) setLoginError("Invalid passphrase");
            }}>
              <div className="space-y-2">
                <Input
                  type="password"
                  placeholder="Passphrase"
                  value={loginPassphrase}
                  onChange={(e) => setLoginPassphrase(e.target.value)}
                  className="h-9"
                />
                {loginError && <div className="text-xs text-red-500">{loginError}</div>}
                <Button type="submit" className="w-full" size="sm" disabled={!loginPassphrase.trim()}>
                  Sign in
                </Button>
              </div>
            </form>
            <div className="flex justify-center">
              <ThemeToggle />
            </div>
          </CardContent>
        </Card>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start sm:items-center justify-between gap-2 pb-4">
        <div className="space-y-1">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-2">
            <Shield className="h-5 w-5 sm:h-6 sm:w-6" />
            Ethos Sybil Scanner
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground hidden sm:block">
            Discover wallet clusters and sybil accounts on Ethos Network via on-chain transaction analysis.
          </p>
        </div>
        <div className="flex items-center gap-1 sm:gap-2 flex-wrap justify-end shrink-0">
          {hasResults && (
            <>
              <Button
                onClick={(e) => {
                  const wallets = [
                    clusterResult!.target,
                    ...clusterResult!.strongCluster.flatMap((c) => c.wallets || [c.address]),
                    ...clusterResult!.possibleCluster.flatMap((c) => c.wallets || [c.address]),
                  ];
                  navigator.clipboard.writeText([...new Set(wallets)].join("\n"));
                  const btn = e.currentTarget;
                  btn.dataset.copied = "true";
                  setTimeout(() => { btn.dataset.copied = "false"; }, 1500);
                }}
                size="sm" variant="secondary" className="h-7 text-xs gap-1.5 data-[copied=true]:text-green-500"
                data-copied="false"
              >
                <Wallet className="h-3.5 w-3.5 data-[copied=true]:hidden" />
                <span className="hidden sm:inline [[data-copied=true]_&]:hidden">Copy Wallets</span>
                <span className="hidden [[data-copied=true]_&]:inline">Copied!</span>
              </Button>
              <Button onClick={exportInvestigation} size="sm" variant="secondary" className="h-7 text-xs gap-1.5">
                <FileText className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Export for Slash Report</span>
              </Button>
            </>
          )}
          {session && (
            <>
              <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground">
                {session.user?.image && (
                  <img src={session.user.image} alt="" className="h-6 w-6 rounded-full" />
                )}
                <span>{session.user?.name || "Admin"}</span>
              </div>
              <Button onClick={() => signOut()} variant="ghost" size="sm" className="h-7 text-xs">
                <span className="hidden sm:inline">Sign out</span>
                <span className="sm:hidden text-xs">Exit</span>
              </Button>
            </>
          )}
          <ThemeToggle />
        </div>
      </div>

      {/* Two-column layout */}
      <div className="flex flex-col lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-6 gap-4">
        {/* Left column: Input + Log */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Wallet Cluster Scan</CardTitle>
              <CardDescription className="text-xs">
                Enter any EVM wallet address to discover related wallets across 5 chains.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <form onSubmit={startScan} className="flex gap-2">
                <div className="relative flex-1">
                  <Wallet className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="text"
                    placeholder="0x..."
                    value={walletInput}
                    onChange={(e) => setWalletInput(e.target.value)}
                    className="pl-10 h-9 font-mono"
                    disabled={scanning}
                  />
                </div>
                <Button type="submit" size="sm" disabled={scanning || !walletInput.trim()}>
                  {scanning ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Search className="h-4 w-4" />
                  )}
                </Button>
              </form>

              {error && <div className="text-xs text-red-500">{error}</div>}

              <div className="text-[10px] text-muted-foreground space-y-0.5">
                <p>Scans Ethereum, Base, Arbitrum, Optimism, and Polygon in parallel.</p>
                <p>Analyzes direct transfers, shared contracts, funding sources, timing, and amounts.</p>
              </div>
            </CardContent>
          </Card>

          {/* Scan Log */}
          {clusterLogs.length > 0 && (
            <Card>
              <CardHeader className={logExpanded ? "pb-2" : ""}>
                <button
                  onClick={() => setLogExpanded(!logExpanded)}
                  className="flex items-center gap-2 text-base font-semibold leading-none tracking-tight cursor-pointer hover:text-foreground/80 transition-colors w-full"
                >
                  {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : (logExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />)}
                  Scan Log
                  {scanning && scanProgress && (
                    <span className="text-xs font-normal text-muted-foreground ml-auto">
                      {scanProgress.percent}%
                      {scanProgress.estimatedRemaining !== null && (
                        <> &middot; ~{formatTime(scanProgress.estimatedRemaining)} left</>
                      )}
                    </span>
                  )}
                  {!scanning && clusterLogs.length > 0 && (
                    <span className="text-xs font-normal text-muted-foreground ml-auto">
                      {clusterLogs.length} entries
                    </span>
                  )}
                </button>
                {scanning && scanProgress && (
                  <div className="w-full bg-muted rounded-full h-1.5 mt-1">
                    <div
                      className="bg-primary h-1.5 rounded-full transition-all duration-500"
                      style={{ width: `${scanProgress.percent}%` }}
                    />
                  </div>
                )}
              </CardHeader>
              {logExpanded && (
                <CardContent>
                  <div className="bg-muted/50 rounded-lg p-3 max-h-[60vh] overflow-y-auto font-mono text-xs space-y-0.5">
                    {clusterLogs.map((entry, i) => (
                      <div key={i} className={getLogColor(entry.level)}>
                        {entry.message}
                      </div>
                    ))}
                    <div ref={logEndRef} />
                  </div>
                </CardContent>
              )}
            </Card>
          )}
          {/* Saved Investigations */}
          {savedInvestigations.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <FolderOpen className="h-4 w-4" />
                  Saved ({savedInvestigations.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {savedInvestigations.map((inv) => (
                  <div
                    key={inv.id}
                    className={`group flex items-center gap-2.5 rounded-md border border-border px-2.5 py-2 text-xs ${
                      currentInvestigationId === inv.id ? "border-primary bg-primary/5" : "hover:bg-muted/30"
                    }`}
                  >
                    {inv.targetAvatar && (
                      <img
                        src={inv.targetAvatar}
                        alt={inv.targetName || ""}
                        className="h-8 w-8 rounded-full shrink-0"
                      />
                    )}
                    <button
                      onClick={() => handleLoadInvestigation(inv)}
                      className="flex-1 min-w-0 text-left cursor-pointer"
                    >
                      <div className="font-medium truncate">
                        {inv.targetName || `${inv.target.slice(0, 10)}...${inv.target.slice(-6)}`}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {inv.strongCount} strong
                        {" / "}{inv.possibleCount} possible
                        {inv.isPublic && " / shared"}
                        {" / "}{new Date(inv.savedAt).toLocaleDateString()}
                      </div>
                    </button>
                    <button
                      onClick={() => handleDeleteInvestigation(inv.id)}
                      className="shrink-0 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-muted transition-opacity cursor-pointer"
                    >
                      <Trash2 className="h-3 w-3 text-muted-foreground" />
                    </button>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right column: Results */}
        <div className="space-y-4">
          {/* Loading skeleton */}
          {loadingCached && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-4"
            >
              <Card>
                <CardHeader className="pb-3">
                  <div className="h-5 w-48 bg-muted rounded animate-pulse" />
                  <div className="h-3 w-72 bg-muted rounded animate-pulse mt-2" />
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {[...Array(4)].map((_, i) => (
                      <div key={i} className="rounded-lg border border-border bg-muted/30 p-2 text-center space-y-1">
                        <div className="h-6 w-8 bg-muted rounded animate-pulse mx-auto" />
                        <div className="h-2 w-12 bg-muted rounded animate-pulse mx-auto" />
                      </div>
                    ))}
                  </div>
                  <div className="rounded-lg border border-border p-3 flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-muted animate-pulse shrink-0" />
                    <div className="space-y-1.5">
                      <div className="h-4 w-32 bg-muted rounded animate-pulse" />
                      <div className="h-3 w-48 bg-muted rounded animate-pulse" />
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-3">
                  <div className="h-5 w-40 bg-muted rounded animate-pulse" />
                </CardHeader>
                <CardContent className="space-y-2">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="rounded-lg border border-border p-3 space-y-2.5">
                      <div className="flex items-start gap-3">
                        <div className="h-10 w-10 rounded-full bg-muted animate-pulse shrink-0" />
                        <div className="flex-1 space-y-1.5">
                          <div className="h-4 w-36 bg-muted rounded animate-pulse" />
                          <div className="h-3 w-52 bg-muted rounded animate-pulse" />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <div className="h-3 w-full bg-muted rounded animate-pulse" />
                        <div className="h-3 w-3/4 bg-muted rounded animate-pulse" />
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </motion.div>
          )}

          <AnimatePresence>
          {hasResults && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-4"
            >
              {/* Overview */}
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Cluster Scan Overview</CardTitle>
                    <div className="flex items-center gap-1">
                      <Button
                        onClick={(e) => {
                          const url = `${window.location.origin}/scan/${clusterResult.target}`;
                          navigator.clipboard.writeText(url);
                          const btn = e.currentTarget;
                          btn.dataset.copied = "true";
                          setTimeout(() => { btn.dataset.copied = "false"; }, 1500);
                        }}
                        size="sm" variant="ghost" className="h-7 text-xs gap-1.5 data-[copied=true]:text-green-500"
                        data-copied="false"
                      >
                        <Share2 className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline [[data-copied=true]_&]:hidden">Share</span>
                        <span className="hidden [[data-copied=true]_&]:inline">Copied!</span>
                      </Button>
                      <Button onClick={handleSaveInvestigation} size="sm" variant="ghost" className="h-7 text-xs gap-1.5">
                        <Save className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">{currentInvestigationId ? "Update" : "Save"}</span>
                      </Button>
                      <Button
                        onClick={() => runFreshScan(clusterResult.target)}
                        size="sm" variant="ghost" className="h-7 text-xs gap-1.5"
                        disabled={scanning}
                      >
                        <Search className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Re-scan</span>
                      </Button>
                    </div>
                  </div>
                  <CardDescription className="text-xs flex items-center gap-1.5">
                    <span>Target:</span>
                    <button
                      onClick={(e) => {
                        navigator.clipboard.writeText(clusterResult.target);
                        const btn = e.currentTarget;
                        btn.dataset.copied = "true";
                        setTimeout(() => { btn.dataset.copied = "false"; }, 1500);
                      }}
                      className="font-mono hover:underline cursor-pointer inline-flex items-center gap-1 group data-[copied=true]:text-green-500"
                      title="Click to copy full address"
                      data-copied="false"
                    >
                      {clusterResult.target.slice(0, 10)}...{clusterResult.target.slice(-6)}
                      <span className="group-data-[copied=true]:hidden"><Copy className="h-2.5 w-2.5 opacity-50" /></span>
                      <span className="hidden group-data-[copied=true]:inline text-[10px] font-medium text-green-500">Copied!</span>
                    </button>
                    {clusterResult.targetEthos && (
                      <span>&middot; Ethos: {clusterResult.targetEthos.displayName} (score: {clusterResult.targetEthos.score})</span>
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div className="rounded-lg border border-border bg-muted/30 p-2 text-center">
                      <div className="text-xl font-bold">{Object.keys(clusterResult.networkStats).length}</div>
                      <div className="text-[10px] text-muted-foreground">Networks</div>
                    </div>
                    <div className="rounded-lg border border-border bg-muted/30 p-2 text-center">
                      <div className="text-xl font-bold">
                        {Object.values(clusterResult.networkStats).reduce((s, n) => s + n.txCount, 0)}
                      </div>
                      <div className="text-[10px] text-muted-foreground">Transactions</div>
                    </div>
                    <div className="rounded-lg border border-border bg-muted/30 p-2 text-center">
                      <div className="text-xl font-bold text-red-500">{clusterResult.strongCluster.length}</div>
                      <div className="text-[10px] text-red-500">Strong</div>
                    </div>
                    <div className="rounded-lg border border-border bg-muted/30 p-2 text-center">
                      <div className="text-xl font-bold text-amber-500">{clusterResult.possibleCluster.length}</div>
                      <div className="text-[10px] text-amber-500">Possible</div>
                    </div>
                  </div>

                  {clusterResult.targetEthos && (
                    <div className="rounded-lg border border-border p-3 space-y-1">
                      <div className="text-xs font-medium text-muted-foreground">Target Ethos Profile</div>
                      <div className="flex items-center gap-3">
                        {clusterResult.targetEthos.avatarUrl && (
                          <a href={clusterResult.targetEthos.profileUrl} target="_blank" rel="noopener noreferrer" className="shrink-0">
                            <img
                              src={clusterResult.targetEthos.avatarUrl}
                              alt={clusterResult.targetEthos.displayName}
                              className={`h-10 w-10 rounded-full ring-2 ${getScoreBorderColor(clusterResult.targetEthos.score)}`}
                            />
                          </a>
                        )}
                        <div className="flex-1 min-w-0">
                          <a
                            href={clusterResult.targetEthos.profileUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-sm hover:underline inline-flex items-center gap-1"
                          >
                            {clusterResult.targetEthos.displayName}
                            <ExternalLink className="h-3 w-3 opacity-50" />
                          </a>
                          <div className="text-xs text-muted-foreground">
                            {clusterResult.targetEthos.username && `@${clusterResult.targetEthos.username} · `}
                            Score: {clusterResult.targetEthos.score}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Key Findings */}
                  {(clusterResult.strongCluster.length > 0 || clusterResult.possibleCluster.length > 0) && (() => {
                    const tName = clusterResult.targetEthos?.displayName || "Target";
                    const allResults = [...clusterResult.strongCluster, ...clusterResult.possibleCluster];
                    const fundedByTarget = allResults.filter((c) => c.signals.some((s) => s.type === "funded_by_target"));
                    const sharedFF = allResults.filter((c) => c.sharedFirstFunder && !c.signals.some((s) => s.type === "funded_by_target"));
                    const invitedBy = allResults.filter((c) => c.invitedByTarget);
                    const mutualRev = allResults.filter((c) => c.mutualReviews);
                    const mutualVou = allResults.filter((c) => c.mutualVouches);
                    const withCex = allResults.filter((c) => c.sharedCexDeposits && c.sharedCexDeposits.length > 0);
                    const multiHop = allResults.filter((c) => c.signals.some((s) => s.type === "multi_hop_funding"));
                    const hasFindings = fundedByTarget.length > 0 || sharedFF.length > 0 || invitedBy.length > 0 || mutualRev.length > 0 || mutualVou.length > 0 || withCex.length > 0 || multiHop.length > 0;
                    if (!hasFindings) return null;
                    const nameLinks = (list: typeof allResults) => list.map((c, i) => {
                      const name = c.ethosProfile?.displayName || c.address.slice(0, 10) + "...";
                      const url = c.ethosProfile?.profileUrl || getExplorerAddressUrl(c.address);
                      return (
                        <span key={c.address}>
                          {i > 0 && ", "}
                          <a href={url} target="_blank" rel="noopener noreferrer" className="text-foreground font-medium hover:underline">
                            {name}
                          </a>
                        </span>
                      );
                    });
                    return (
                      <div className="rounded-lg border border-border p-3 space-y-1.5">
                        <div className="text-xs font-medium text-muted-foreground">Key Findings</div>
                        {fundedByTarget.length > 0 && (
                          <div className="text-xs text-muted-foreground flex gap-1.5">
                            <span className="shrink-0">-</span>
                            <span>{tName} first funded: {nameLinks(fundedByTarget)}</span>
                          </div>
                        )}
                        {sharedFF.length > 0 && (
                          <div className="text-xs text-muted-foreground flex gap-1.5">
                            <span className="shrink-0">-</span>
                            <span>Share the same first funder as {tName}: {nameLinks(sharedFF)}</span>
                          </div>
                        )}
                        {invitedBy.length > 0 && (
                          <div className="text-xs text-muted-foreground flex gap-1.5">
                            <span className="shrink-0">-</span>
                            <span>{tName} invited on Ethos: {nameLinks(invitedBy)}</span>
                          </div>
                        )}
                        {mutualRev.length > 0 && (
                          <div className="text-xs text-muted-foreground flex gap-1.5">
                            <span className="shrink-0">-</span>
                            <span>Mutual reviews with {tName}: {nameLinks(mutualRev)}</span>
                          </div>
                        )}
                        {mutualVou.length > 0 && (
                          <div className="text-xs text-muted-foreground flex gap-1.5">
                            <span className="shrink-0">-</span>
                            <span>Mutual vouches with {tName}: {nameLinks(mutualVou)}</span>
                          </div>
                        )}
                        {withCex.length > 0 && (
                          <div className="text-xs text-muted-foreground flex gap-1.5">
                            <span className="shrink-0">-</span>
                            <span>Share exchange deposit address: {nameLinks(withCex)}</span>
                          </div>
                        )}
                        {multiHop.length > 0 && (
                          <div className="text-xs text-muted-foreground flex gap-1.5">
                            <span className="shrink-0">-</span>
                            <span>Discovered via funding chain analysis: {nameLinks(multiHop)}</span>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Target first funders (collapsible) */}
                  {clusterResult.targetFirstFunders && clusterResult.targetFirstFunders.length > 0 && (
                    <div className="rounded-lg border border-border p-3 space-y-1.5">
                      <button
                        onClick={() => setShowFirstFunders(!showFirstFunders)}
                        className="flex items-center gap-1 text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors w-full"
                      >
                        {showFirstFunders ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        {clusterResult.targetEthos?.displayName || "Target"}&apos;s First Funders
                      </button>
                      {showFirstFunders && (
                        <div className="space-y-1 pt-1">
                          {clusterResult.targetFirstFunders.map((ff, i) => (
                            <div key={i} className="flex items-center justify-between text-xs">
                              <div className="flex items-center gap-2">
                                <span className="text-muted-foreground w-16 shrink-0">{ff.chain}</span>
                                {renderAddress(ff.funder, ff.chain)}
                              </div>
                              <span className="text-muted-foreground">{parseFloat(String(ff.value)).toFixed(4)} ETH</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
              </motion.div>

              {/* Strong Cluster */}
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.1 }}>
              <Card>
                <CardHeader className={clusterResult.strongCluster.length === 0 ? "pb-6" : "pb-3"}>
                  <CardTitle className="text-base flex items-center gap-2">
                    {clusterResult.strongCluster.length > 0 ? (
                      <>
                        <AlertTriangle className="h-5 w-5 text-red-500" />
                        {clusterResult.strongCluster.length} Strong Cluster Wallet{clusterResult.strongCluster.length !== 1 && "s"}
                      </>
                    ) : (
                      <>
                        <Shield className="h-5 w-5 text-green-500" />
                        No Strong Cluster Found
                      </>
                    )}
                  </CardTitle>
                  {clusterResult.strongCluster.length === 0 && (
                    <CardDescription className="text-xs">
                      No wallets scored high enough across multiple signal types.
                    </CardDescription>
                  )}
                </CardHeader>
                {clusterResult.strongCluster.length > 0 && (
                  <CardContent className="space-y-2">
                    {clusterResult.strongCluster.map((candidate) => (
                      <CandidateCard
                        key={candidate.address}
                        candidate={candidate}
                        result={clusterResult}
                        onClick={() => setSelectedCandidate(candidate)}
                      />
                    ))}
                  </CardContent>
                )}
              </Card>
              </motion.div>

              {/* Possible Candidates */}
              {clusterResult.possibleCluster.length > 0 && (
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.2 }}>
                <Card>
                  <CardHeader className={showPossible ? "pb-3" : ""}>
                    <button
                      onClick={() => setShowPossible(!showPossible)}
                      className="flex items-center gap-2 text-base font-semibold leading-none tracking-tight cursor-pointer hover:text-foreground/80 transition-colors w-full"
                    >
                      {showPossible ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      <AlertTriangle className="h-5 w-5 text-amber-500" />
                      {clusterResult.possibleCluster.length} Possible Candidate{clusterResult.possibleCluster.length !== 1 && "s"}
                    </button>
                  </CardHeader>
                  {showPossible && (
                  <CardContent className="space-y-2">
                    {clusterResult.possibleCluster.map((candidate) => (
                      <CandidateCard
                        key={candidate.address}
                        candidate={candidate}
                        result={clusterResult}
                        onClick={() => setSelectedCandidate(candidate)}
                      />
                    ))}
                  </CardContent>
                  )}
                </Card>
              </motion.div>
              )}

              {/* Manual Checks + Evidence Collection */}
              {(clusterResult.strongCluster.length > 0 || clusterResult.possibleCluster.length > 0) && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Search className="h-5 w-5 text-muted-foreground" />
                      X/Twitter Evidence
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Search X for each wallet address, then attach screenshots of the results. Generate an AI analysis prompt when done.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {/* Target + all candidates */}
                    {[
                      { address: clusterResult.target, label: "Target", ethosProfile: clusterResult.targetEthos, confidence: null, score: null },
                      ...[...clusterResult.strongCluster, ...clusterResult.possibleCluster].map((c) => ({
                        address: c.address,
                        label: null,
                        ethosProfile: c.ethosProfile,
                        confidence: c.confidence,
                        score: c.score,
                      })),
                    ].map((entry) => (
                      <div key={entry.address} className="rounded-lg border border-border p-2.5 space-y-2">
                        <div className="flex items-center gap-2">
                          <a
                            href={`https://x.com/search?q=%22${entry.address}%22&f=live`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 text-xs hover:underline flex-1 min-w-0"
                          >
                            <Search className="h-3 w-3 text-muted-foreground shrink-0" />
                            {entry.label ? (
                              <span className="font-medium">{entry.label}</span>
                            ) : entry.ethosProfile ? (
                              <span className="truncate">
                                {entry.ethosProfile.displayName}
                                {entry.ethosProfile.username && <span className="text-muted-foreground"> @{entry.ethosProfile.username}</span>}
                              </span>
                            ) : (
                              <span className="font-mono truncate">{entry.address.slice(0, 14)}...{entry.address.slice(-6)}</span>
                            )}
                            <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0" />
                          </a>
                          {entry.score !== null && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${
                              entry.confidence === "high" ? "bg-red-500 text-white" : "bg-amber-500 text-white"
                            }`}>
                              {entry.score}
                            </span>
                          )}
                          {!screenshots.has(entry.address) ? (
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                onClick={() => handlePaste(entry.address)}
                                className="p-1.5 rounded hover:bg-muted transition-colors cursor-pointer"
                                title="Paste screenshot from clipboard"
                              >
                                <ClipboardPaste className="h-3.5 w-3.5 text-muted-foreground" />
                              </button>
                              <button
                                onClick={() => fileInputRefs.current.get(entry.address)?.click()}
                                className="p-1.5 rounded hover:bg-muted transition-colors cursor-pointer"
                                title="Upload screenshot"
                              >
                                <ImagePlus className="h-3.5 w-3.5 text-muted-foreground" />
                              </button>
                              <input
                                ref={(el) => { if (el) fileInputRefs.current.set(entry.address, el); }}
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (file) handleScreenshotUpload(entry.address, file);
                                  e.target.value = "";
                                }}
                              />
                            </div>
                          ) : (
                            <button
                              onClick={() => removeScreenshot(entry.address)}
                              className="p-1.5 rounded hover:bg-muted transition-colors cursor-pointer shrink-0"
                              title="Remove screenshot"
                            >
                              <X className="h-3.5 w-3.5 text-muted-foreground" />
                            </button>
                          )}
                        </div>
                        {screenshots.has(entry.address) && (
                          <div className="relative">
                            <img
                              src={screenshots.get(entry.address)}
                              alt={`X search results for ${entry.address}`}
                              className="rounded border border-border w-full max-h-48 object-cover object-top"
                            />
                            <div className="absolute top-1 right-1 bg-green-500 text-white text-[9px] px-1.5 py-0.5 rounded-full font-medium">
                              attached
                            </div>
                          </div>
                        )}
                      </div>
                    ))}

                    <div className="text-[10px] text-muted-foreground">
                      Click the search icon to open X, then paste or upload a screenshot. If 2+ accounts posted the same address, it&apos;s likely a sybil cluster.
                    </div>

                  </CardContent>
                </Card>
              )}
            </motion.div>
          )}
          </AnimatePresence>

          {/* Empty state */}
          {!scanning && !hasResults && !loadingCached && (
            <div className="hidden lg:flex items-center justify-center h-64 text-muted-foreground text-sm">
              Enter a wallet address and scan to discover related wallets
            </div>
          )}
        </div>
      </div>

      {/* Candidate Detail Modal */}
      <AnimatePresence>
        {selectedCandidate && clusterResult && (
          <CandidateModal
            candidate={selectedCandidate}
            result={clusterResult}
            onClose={() => setSelectedCandidate(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
