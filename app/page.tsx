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
} from "lucide-react";
import {
  type ClusterScanResult,
  type ClusterCandidate,
  type LogEntry,
  type ScanProgress,
} from "@/lib/cluster-scanner";
import { ThemeToggle } from "@/components/theme-toggle";
import { useSession, signIn, signOut } from "next-auth/react";

// --- Saved Investigations ---

interface InvestigationSummary {
  id: string;
  target: string;
  targetName: string | null;
  savedAt: number;
  strongCount: number;
  possibleCount: number;
  hasAnalysis: boolean;
  screenshotCount: number;
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
  const fileInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  useEffect(() => {
    fetch("/api/investigations").then((r) => r.json()).then(setSavedInvestigations).catch(() => {});
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [clusterLogs]);

  const startScan = async (e: React.FormEvent) => {
    e.preventDefault();
    const addr = walletInput.trim();
    if (!addr || !/^0x[a-fA-F0-9]{40}$/.test(addr)) {
      setError("Please enter a valid EVM address (0x...)");
      return;
    }

    setScanning(true);
    setClusterResult(null);
    setClusterLogs([]);
    setScanProgress(null);
    setError(null);

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
              // Restore Sets from arrays
              const result = msg.data as ClusterScanResult;
              result.strongCluster.forEach((c) => {
                c.signalTypes = new Set(c.signalTypes as unknown as string[]);
              });
              result.possibleCluster.forEach((c) => {
                c.signalTypes = new Set(c.signalTypes as unknown as string[]);
              });
              setClusterResult(result);
            } else if (msg.type === "error") {
              setError(msg.data);
            }
          } catch {
            // Skip malformed lines
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cluster scan failed");
    } finally {
      setScanning(false);
      setScanProgress(null);
    }
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

  const getExplorerAddressUrl = (address: string) => {
    return `https://etherscan.io/address/${address}`;
  };

  const refreshInvestigations = () => {
    fetch("/api/investigations").then((r) => r.json()).then(setSavedInvestigations).catch(() => {});
  };

  const handleSaveInvestigation = async () => {
    if (!clusterResult) return;
    const id = currentInvestigationId || `inv-${Date.now()}`;
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
        if (c.sharedFundingSources.length > 0) prompt += `- Shared funding sources: ${c.sharedFundingSources.length}\n`;
        if (c.timeProximityHits > 0) prompt += `- Transaction timing correlations: ${c.timeProximityHits}\n`;
        if (c.similarAmountHits > 0) prompt += `- Similar transaction amounts: ${c.similarAmountHits}\n`;
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
                  className="h-9 text-sm"
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
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between pb-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Shield className="h-6 w-6" />
            Ethos Sybil Scanner
          </h1>
          <p className="text-sm text-muted-foreground">
            Discover wallet clusters and sybil accounts on Ethos Network via on-chain transaction analysis.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasResults && (
            <Button onClick={exportInvestigation} size="sm" variant="secondary" className="h-7 text-xs gap-1.5">
              <FileText className="h-3.5 w-3.5" />
              Export for Slash Report
            </Button>
          )}
          {session && (
            <>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {session.user?.image && (
                  <img src={session.user.image} alt="" className="h-6 w-6 rounded-full" />
                )}
                <span>{session.user?.name || "Admin"}</span>
              </div>
              <Button onClick={() => signOut()} variant="ghost" size="sm" className="h-7 text-xs">
                Sign out
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
                    className="pl-10 h-9 text-sm font-mono"
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
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  {scanning && <Loader2 className="h-4 w-4 animate-spin" />}
                  Scan Log
                  {scanning && scanProgress && (
                    <span className="text-xs font-normal text-muted-foreground ml-auto">
                      {scanProgress.percent}%
                      {scanProgress.estimatedRemaining !== null && (
                        <> &middot; ~{formatTime(scanProgress.estimatedRemaining)} left</>
                      )}
                    </span>
                  )}
                </CardTitle>
                {scanning && scanProgress && (
                  <div className="w-full bg-muted rounded-full h-1.5 mt-1">
                    <div
                      className="bg-primary h-1.5 rounded-full transition-all duration-500"
                      style={{ width: `${scanProgress.percent}%` }}
                    />
                  </div>
                )}
              </CardHeader>
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
                    className={`group flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs ${
                      currentInvestigationId === inv.id ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                    }`}
                  >
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
                        {inv.hasAnalysis && " / report"}
                        {inv.screenshotCount > 0 && ` / ${inv.screenshotCount} img`}
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
          {hasResults && (
            <>
              {/* Overview */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Cluster Scan Overview</CardTitle>
                    <Button onClick={handleSaveInvestigation} size="sm" variant="ghost" className="h-7 text-xs gap-1.5">
                      <Save className="h-3.5 w-3.5" />
                      {currentInvestigationId ? "Update" : "Save"}
                    </Button>
                  </div>
                  <CardDescription className="text-xs">
                    Target: {clusterResult.target.slice(0, 10)}...{clusterResult.target.slice(-6)}
                    {clusterResult.targetEthos && (
                      <> &middot; Ethos: {clusterResult.targetEthos.displayName} (score: {clusterResult.targetEthos.score})</>
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-4 gap-2">
                    <div className="rounded-lg border bg-muted/30 p-2 text-center">
                      <div className="text-xl font-bold">{Object.keys(clusterResult.networkStats).length}</div>
                      <div className="text-[10px] text-muted-foreground">Networks</div>
                    </div>
                    <div className="rounded-lg border bg-muted/30 p-2 text-center">
                      <div className="text-xl font-bold">
                        {Object.values(clusterResult.networkStats).reduce((s, n) => s + n.txCount, 0)}
                      </div>
                      <div className="text-[10px] text-muted-foreground">Transactions</div>
                    </div>
                    <div className="rounded-lg border bg-muted/30 p-2 text-center">
                      <div className="text-xl font-bold text-red-500">{clusterResult.strongCluster.length}</div>
                      <div className="text-[10px] text-red-500">Strong</div>
                    </div>
                    <div className="rounded-lg border bg-muted/30 p-2 text-center">
                      <div className="text-xl font-bold text-amber-500">{clusterResult.possibleCluster.length}</div>
                      <div className="text-[10px] text-amber-500">Possible</div>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="text-xs font-medium text-muted-foreground">Per-network breakdown</div>
                    {Object.entries(clusterResult.networkStats).map(([network, stats]) => (
                      <div key={network} className="flex items-center justify-between text-xs py-1 border-b border-muted last:border-0">
                        <span className="font-medium">{network}</span>
                        <span className="text-muted-foreground">
                          {stats.txCount} txs &middot; {stats.directWallets} direct &middot; {stats.contractClusters} contracts
                        </span>
                      </div>
                    ))}
                  </div>

                  {clusterResult.targetEthos && (
                    <div className="rounded-lg border p-3 space-y-1">
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

                  {/* Target first funders */}
                  {clusterResult.targetFirstFunders && clusterResult.targetFirstFunders.length > 0 && (
                    <div className="rounded-lg border p-3 space-y-1.5">
                      <div className="text-xs font-medium text-muted-foreground">Target First Funders</div>
                      {clusterResult.targetFirstFunders.map((ff, i) => (
                        <div key={i} className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground w-16 shrink-0">{ff.chain}</span>
                            <a
                              href={getExplorerAddressUrl(ff.funder)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-mono hover:underline"
                            >
                              {ff.funder.slice(0, 10)}...{ff.funder.slice(-6)} <ExternalLink className="inline h-2.5 w-2.5 opacity-50" />
                            </a>
                          </div>
                          <span className="text-muted-foreground">{ff.value} ETH</span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Strong Cluster */}
              <Card>
                <CardHeader className="pb-3">
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
                      <div
                        key={candidate.address}
                        onClick={() => setSelectedCandidate(candidate)}
                        className="rounded-lg border bg-red-500/5 border-red-500/20 p-3 space-y-2 cursor-pointer hover:border-red-500/50 transition-colors"
                      >
                        <div className="flex items-start gap-3">
                          {candidate.ethosProfile?.avatarUrl && (
                            <a href={candidate.ethosProfile.profileUrl} target="_blank" rel="noopener noreferrer" className="shrink-0">
                              <img
                                src={candidate.ethosProfile.avatarUrl}
                                alt={candidate.ethosProfile.displayName}
                                className={`h-10 w-10 rounded-full ring-2 ${getScoreBorderColor(candidate.ethosProfile.score)}`}
                              />
                            </a>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 flex-wrap">
                                {candidate.ethosProfile ? (
                                  <a
                                    href={candidate.ethosProfile.profileUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="font-medium text-sm hover:underline inline-flex items-center gap-1"
                                  >
                                    {candidate.ethosProfile.displayName}
                                    <ExternalLink className="h-3 w-3 opacity-50" />
                                  </a>
                                ) : (
                                  <a
                                    href={getExplorerAddressUrl(candidate.address)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="font-mono text-sm hover:underline inline-flex items-center gap-1"
                                  >
                                    {candidate.address.slice(0, 10)}...{candidate.address.slice(-6)}
                                    <ExternalLink className="h-3 w-3 opacity-50" />
                                  </a>
                                )}
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-red-500 text-white">
                                  score: {candidate.score}
                                </span>
                              </div>
                              <div className="text-[10px] text-muted-foreground shrink-0">
                                {candidate.networks.join(", ")}
                              </div>
                            </div>
                            {candidate.ethosProfile && (
                              <div className="text-xs text-muted-foreground mt-0.5">
                                {candidate.ethosProfile.username && `@${candidate.ethosProfile.username} · `}
                                Ethos score: {candidate.ethosProfile.score}
                                {" · "}
                                <a
                                  href={getExplorerAddressUrl(candidate.address)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="font-mono hover:underline"
                                >
                                  {candidate.address.slice(0, 6)}...{candidate.address.slice(-4)}
                                </a>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {candidate.signals.map((signal, i) => (
                            <span
                              key={i}
                              className={`text-[10px] px-1.5 py-0.5 rounded-full border ${
                                signal.score > 0
                                  ? "bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-400"
                                  : "bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-400"
                              }`}
                            >
                              {signal.type} ({signal.score > 0 ? "+" : ""}{signal.score})
                            </span>
                          ))}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          direct={candidate.directCount} in={candidate.incomingCount} out={candidate.outgoingCount}
                          {candidate.bidirectional && " · bidirectional"}
                          {candidate.repeatTransfer && " · repeat"}
                          {candidate.sharedFundingSources.length > 0 && ` · ${candidate.sharedFundingSources.length} shared funder(s)`}
                          {candidate.timeProximityHits > 0 && ` · ${candidate.timeProximityHits} timing hits`}
                          {candidate.similarAmountHits > 0 && ` · ${candidate.similarAmountHits} amount matches`}
                        </div>
                      </div>
                    ))}
                  </CardContent>
                )}
              </Card>

              {/* Possible Candidates */}
              {clusterResult.possibleCluster.length > 0 && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <AlertTriangle className="h-5 w-5 text-amber-500" />
                      {clusterResult.possibleCluster.length} Possible Candidate{clusterResult.possibleCluster.length !== 1 && "s"}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {clusterResult.possibleCluster.map((candidate) => (
                      <div
                        key={candidate.address}
                        onClick={() => setSelectedCandidate(candidate)}
                        className="rounded-lg border bg-amber-500/5 border-amber-500/20 p-3 space-y-1.5 cursor-pointer hover:border-amber-500/50 transition-colors"
                      >
                        <div className="flex items-start gap-3">
                          {candidate.ethosProfile?.avatarUrl && (
                            <a href={candidate.ethosProfile.profileUrl} target="_blank" rel="noopener noreferrer" className="shrink-0">
                              <img
                                src={candidate.ethosProfile.avatarUrl}
                                alt={candidate.ethosProfile.displayName}
                                className={`h-10 w-10 rounded-full ring-2 ${getScoreBorderColor(candidate.ethosProfile.score)}`}
                              />
                            </a>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 flex-wrap">
                                {candidate.ethosProfile ? (
                                  <a
                                    href={candidate.ethosProfile.profileUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="font-medium text-sm hover:underline inline-flex items-center gap-1"
                                  >
                                    {candidate.ethosProfile.displayName}
                                    <ExternalLink className="h-3 w-3 opacity-50" />
                                  </a>
                                ) : (
                                  <a
                                    href={getExplorerAddressUrl(candidate.address)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="font-mono text-sm hover:underline inline-flex items-center gap-1"
                                  >
                                    {candidate.address.slice(0, 10)}...{candidate.address.slice(-6)}
                                    <ExternalLink className="h-3 w-3 opacity-50" />
                                  </a>
                                )}
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-amber-500 text-white">
                                  score: {candidate.score}
                                </span>
                              </div>
                              <div className="text-[10px] text-muted-foreground shrink-0">
                                {candidate.networks.join(", ")}
                              </div>
                            </div>
                            {candidate.ethosProfile && (
                              <div className="text-xs text-muted-foreground mt-0.5">
                                {candidate.ethosProfile.username && `@${candidate.ethosProfile.username} · `}
                                Ethos score: {candidate.ethosProfile.score}
                                {" · "}
                                <a
                                  href={getExplorerAddressUrl(candidate.address)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="font-mono hover:underline"
                                >
                                  {candidate.address.slice(0, 6)}...{candidate.address.slice(-4)}
                                </a>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {candidate.signals.map((signal, i) => (
                            <span
                              key={i}
                              className="text-[10px] px-1.5 py-0.5 rounded-full border bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-400"
                            >
                              {signal.type} ({signal.score > 0 ? "+" : ""}{signal.score})
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
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
                      <div key={entry.address} className="rounded-lg border p-2.5 space-y-2">
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
                              className="rounded border w-full max-h-48 object-cover object-top"
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
            </>
          )}

          {/* Empty state */}
          {!scanning && !hasResults && (
            <div className="hidden lg:flex items-center justify-center h-64 text-muted-foreground text-sm">
              Enter a wallet address and scan to discover related wallets
            </div>
          )}
        </div>
      </div>

      {/* Candidate Detail Modal */}
      {selectedCandidate && clusterResult && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setSelectedCandidate(null)}
        >
          <div
            className="bg-background border rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-start gap-3 p-5 border-b sticky top-0 bg-background rounded-t-xl z-10">
              {selectedCandidate.ethosProfile?.avatarUrl && (
                <img
                  src={selectedCandidate.ethosProfile.avatarUrl}
                  alt={selectedCandidate.ethosProfile.displayName}
                  className={`h-12 w-12 rounded-full ring-2 ${getScoreBorderColor(selectedCandidate.ethosProfile.score)}`}
                />
              )}
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-lg">
                  {selectedCandidate.ethosProfile?.displayName || `${selectedCandidate.address.slice(0, 12)}...${selectedCandidate.address.slice(-6)}`}
                </div>
                <div className="text-sm text-muted-foreground">
                  {selectedCandidate.ethosProfile?.username && `@${selectedCandidate.ethosProfile.username} · `}
                  {selectedCandidate.confidence === "high" ? "Strong" : "Possible"} match · Score: {selectedCandidate.score}
                </div>
              </div>
              <button
                onClick={() => setSelectedCandidate(null)}
                className="shrink-0 p-2 rounded-lg hover:bg-muted transition-colors cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-5 space-y-5">
              {/* Profile Links */}
              <div className="flex flex-wrap gap-2">
                {selectedCandidate.ethosProfile && (
                  <a
                    href={selectedCandidate.ethosProfile.profileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs border rounded-md px-2.5 py-1.5 hover:bg-muted/50 transition-colors"
                  >
                    Ethos Profile <ExternalLink className="h-3 w-3 opacity-50" />
                  </a>
                )}
                <a
                  href={getExplorerAddressUrl(selectedCandidate.address)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs border rounded-md px-2.5 py-1.5 hover:bg-muted/50 transition-colors font-mono"
                >
                  {selectedCandidate.address.slice(0, 8)}...{selectedCandidate.address.slice(-6)} <ExternalLink className="h-3 w-3 opacity-50" />
                </a>
              </div>

              {/* Connection to Target */}
              <div>
                <h3 className="text-sm font-semibold mb-2">Connection to {clusterResult.targetEthos?.displayName || clusterResult.target.slice(0, 10) + "..."}</h3>
                <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                  {/* Direct transfers */}
                  {selectedCandidate.directCount > 0 && (
                    <div className="space-y-1">
                      <div className="text-xs font-medium">Direct Transfers</div>
                      <div className="text-xs text-muted-foreground">
                        {selectedCandidate.directCount} transfer{selectedCandidate.directCount !== 1 && "s"} detected
                        {" "}({selectedCandidate.incomingCount} incoming, {selectedCandidate.outgoingCount} outgoing)
                        {selectedCandidate.bidirectional && (
                          <span className="ml-1 text-amber-500 font-medium">-- funds flow both ways</span>
                        )}
                        {selectedCandidate.repeatTransfer && (
                          <span className="ml-1 text-amber-500 font-medium">-- repeated pattern</span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Shared contracts */}
                  {selectedCandidate.sharedContracts.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-xs font-medium">Shared Contract Interactions</div>
                      <div className="text-xs text-muted-foreground">
                        Both wallets interacted with {selectedCandidate.sharedContracts.length} of the same contract{selectedCandidate.sharedContracts.length !== 1 && "s"}:
                      </div>
                      <div className="space-y-0.5">
                        {selectedCandidate.sharedContracts.map((addr) => (
                          <a
                            key={addr}
                            href={getExplorerAddressUrl(addr)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block text-xs font-mono text-muted-foreground hover:underline"
                          >
                            {addr.slice(0, 14)}...{addr.slice(-8)} <ExternalLink className="inline h-2.5 w-2.5 opacity-50" />
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* First funders */}
                  {selectedCandidate.firstFunders && selectedCandidate.firstFunders.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-xs font-medium flex items-center gap-1.5">
                        First Funder{selectedCandidate.firstFunders.length > 1 ? "s" : ""}
                        {selectedCandidate.sharedFirstFunder && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-500 text-white font-medium">same as target</span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        The first wallet to send ETH to this address on each chain:
                      </div>
                      {selectedCandidate.firstFunders.map((ff, i) => (
                        <div key={i} className="flex items-center justify-between text-xs border rounded px-2 py-1.5">
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground w-16 shrink-0">{ff.chain}</span>
                            <a
                              href={getExplorerAddressUrl(ff.funder)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-mono hover:underline"
                            >
                              {ff.funder.slice(0, 10)}...{ff.funder.slice(-6)} <ExternalLink className="inline h-2.5 w-2.5 opacity-50" />
                            </a>
                          </div>
                          <span className="text-muted-foreground">{ff.value} ETH</span>
                        </div>
                      ))}
                      {selectedCandidate.sharedFirstFunder && clusterResult.targetFirstFunders && clusterResult.targetFirstFunders.length > 0 && (
                        <div className="text-xs text-red-500 dark:text-red-400 font-medium mt-1">
                          The target wallet was also first funded by the same address -- this is a strong sybil indicator.
                        </div>
                      )}
                    </div>
                  )}

                  {/* Shared funding sources */}
                  {selectedCandidate.sharedFundingSources.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-xs font-medium">Shared Funding Sources</div>
                      <div className="text-xs text-muted-foreground">
                        Both wallets received funds from {selectedCandidate.sharedFundingSources.length} of the same source{selectedCandidate.sharedFundingSources.length !== 1 && "s"}:
                      </div>
                      <div className="space-y-0.5">
                        {selectedCandidate.sharedFundingSources.map((addr) => (
                          <a
                            key={addr}
                            href={getExplorerAddressUrl(addr)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block text-xs font-mono text-muted-foreground hover:underline"
                          >
                            {addr.slice(0, 14)}...{addr.slice(-8)} <ExternalLink className="inline h-2.5 w-2.5 opacity-50" />
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Timing */}
                  {selectedCandidate.timeProximityHits > 0 && (
                    <div className="space-y-1">
                      <div className="text-xs font-medium">Transaction Timing</div>
                      <div className="text-xs text-muted-foreground">
                        {selectedCandidate.timeProximityHits} transaction{selectedCandidate.timeProximityHits !== 1 && "s"} occurred within a close time window of the target&apos;s transactions, suggesting coordinated activity.
                      </div>
                    </div>
                  )}

                  {/* Amount similarity */}
                  {selectedCandidate.similarAmountHits > 0 && (
                    <div className="space-y-1">
                      <div className="text-xs font-medium">Similar Amounts</div>
                      <div className="text-xs text-muted-foreground">
                        {selectedCandidate.similarAmountHits} outgoing transaction{selectedCandidate.similarAmountHits !== 1 && "s"} matched similar amounts (within 10%) to the target&apos;s transactions.
                      </div>
                    </div>
                  )}

                  {/* No connections found */}
                  {selectedCandidate.directCount === 0 &&
                    selectedCandidate.sharedContracts.length === 0 &&
                    selectedCandidate.sharedFundingSources.length === 0 &&
                    selectedCandidate.timeProximityHits === 0 &&
                    selectedCandidate.similarAmountHits === 0 && (
                    <div className="text-xs text-muted-foreground">No specific connection details available.</div>
                  )}
                </div>
              </div>

              {/* Signals Breakdown */}
              <div>
                <h3 className="text-sm font-semibold mb-2">Signal Breakdown</h3>
                <div className="space-y-1.5">
                  {selectedCandidate.signals.map((signal, i) => (
                    <div key={i} className="flex items-center justify-between text-xs border rounded-md px-3 py-2">
                      <span className="font-medium">{signal.type.replace(/_/g, " ")}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">{signal.details}</span>
                        <span className={`font-bold ${signal.score > 0 ? "text-red-500" : "text-green-500"}`}>
                          {signal.score > 0 ? "+" : ""}{signal.score}
                        </span>
                      </div>
                    </div>
                  ))}
                  <div className="flex items-center justify-between text-xs font-semibold border-t pt-2 mt-1 px-1">
                    <span>Total Score</span>
                    <span>{selectedCandidate.score}</span>
                  </div>
                </div>
              </div>

              {/* Network Activity */}
              <div>
                <h3 className="text-sm font-semibold mb-2">Active Networks</h3>
                <div className="flex flex-wrap gap-1.5">
                  {selectedCandidate.networks.map((network) => (
                    <span key={network} className="text-xs border rounded-md px-2.5 py-1">
                      {network}
                    </span>
                  ))}
                </div>
              </div>

              {/* Ethos Profile Details */}
              {selectedCandidate.ethosProfile && (
                <div>
                  <h3 className="text-sm font-semibold mb-2">Ethos Profile</h3>
                  <div className="rounded-lg border bg-muted/30 p-3 space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Credibility Score</span>
                      <span className="font-medium">{selectedCandidate.ethosProfile.score}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Profile ID</span>
                      <span className="font-medium">{selectedCandidate.ethosProfile.profileId}</span>
                    </div>
                    {selectedCandidate.ethosProfile.username && (
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">X/Twitter</span>
                        <span className="font-medium">@{selectedCandidate.ethosProfile.username}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
