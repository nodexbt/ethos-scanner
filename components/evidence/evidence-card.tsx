"use client";

import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Search,
  ExternalLink,
  ImagePlus,
  X,
  ClipboardPaste,
  Zap,
  Loader2,
  Heart,
  MessageCircle,
  Repeat2,
  AlertTriangle,
} from "lucide-react";
import { type ClusterScanResult } from "@/lib/cluster-scanner";
import { HumanVerifiedBadge } from "@/components/ui/human-verified-badge";
import { EthosScoreIcon } from "@/components/ui/ethos-score-icon";
import Link from "next/link";
import type { TwitterTweet, TwitterSearchResult } from "@/app/api/twitter/search/route";

type Tweet = TwitterTweet;

type TweetResultEntry = {
  tweets: Tweet[];
  rawCount: number;
  ethosCount: number;
};

interface EvidenceCardProps {
  result: ClusterScanResult;
  screenshots: Map<string, string>;
  onScreenshotUpload: (address: string, file: File) => void;
  onScreenshotRemove: (address: string) => void;
  onPaste: (address: string) => void;
  /** Address → tweet search result map persisted with the investigation.
   * Loaded on mount; mutated through onTwitterEvidenceChange. */
  initialTwitterEvidence?: Record<string, unknown>;
  onTwitterEvidenceChange?: (next: Record<string, TweetResultEntry>) => void;
}

function formatRelative(createdAt: string): string {
  const t = new Date(createdAt).getTime();
  if (!Number.isFinite(t)) return "";
  const diff = Date.now() - t;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

function TweetCount({ icon: Icon, n }: { icon: typeof Heart; n: number }) {
  if (!n) return null;
  return (
    <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
      <Icon className="h-2.5 w-2.5" />
      {n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n}
    </span>
  );
}

function AuthorPill({
  profile,
  handle,
  fallbackName,
}: {
  profile: NonNullable<Tweet["ethos"]>;
  handle: string;
  fallbackName: string;
}) {
  return (
    <Link
      href={`/monitoring/${profile.profileId}`}
      className="inline-flex items-center gap-1 hover:underline"
    >
      {profile.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={profile.avatarUrl} alt="" className="h-4 w-4 rounded-full" />
      ) : null}
      <span className="font-medium text-[11px]">{profile.displayName || fallbackName}</span>
      <span className="text-muted-foreground text-[10px]">@{handle}</span>
      {profile.humanVerified && <HumanVerifiedBadge size={9} />}
      {profile.score != null && (
        <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold bg-muted px-1 rounded tabular-nums">
          {profile.score}
          <EthosScoreIcon size={7} />
        </span>
      )}
    </Link>
  );
}

function TweetList({
  tweets,
  rawCount,
  ethosCount,
}: {
  tweets: Tweet[];
  rawCount: number;
  ethosCount: number;
}) {
  if (tweets.length === 0) {
    return (
      <div className="text-[11px] text-muted-foreground italic py-2">
        No tweets found mentioning this address.
      </div>
    );
  }
  const nonEthosCount = Math.max(0, tweets.length - ethosCount);
  return (
    <div className="space-y-2 max-h-80 overflow-y-auto">
      <div className="text-[10px] text-muted-foreground italic">
        {tweets.length} tweet{tweets.length === 1 ? "" : "s"}
        {ethosCount > 0 && ` · ${ethosCount} from Ethos profile${ethosCount === 1 ? "" : "s"}`}
        {nonEthosCount > 0 && ` · ${nonEthosCount} non-Ethos`}
      </div>
      {tweets.map((t) => {
        const avatarSrc = t.ethos?.avatarUrl ?? t.author.profilePicture ?? null;
        const displayName =
          t.ethos?.displayName || t.author.name || t.author.userName;
        return (
        <div
          key={t.id}
          className="rounded border border-border/50 bg-muted/20 p-2 hover:bg-muted/40 transition-colors"
        >
          <div className="flex items-start gap-2">
            {avatarSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatarSrc}
                alt=""
                className="h-6 w-6 rounded-full shrink-0"
              />
            ) : (
              <div className="h-6 w-6 rounded-full bg-muted shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1 text-[11px] flex-wrap">
                {t.ethos ? (
                  <Link
                    href={`/monitoring/${t.ethos.profileId}`}
                    className="font-medium truncate hover:underline"
                  >
                    {displayName}
                  </Link>
                ) : (
                  <span className="font-medium truncate">{displayName}</span>
                )}
                <a
                  href={`https://x.com/${t.author.userName}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground truncate hover:underline"
                >
                  @{t.author.userName}
                </a>
                {t.ethos ? (
                  <>
                    {t.ethos.humanVerified && <HumanVerifiedBadge size={10} />}
                    {t.ethos.score != null && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold bg-muted px-1 rounded tabular-nums">
                        {t.ethos.score}
                        <EthosScoreIcon size={8} />
                      </span>
                    )}
                  </>
                ) : (
                  <span className="text-[9px] text-muted-foreground bg-muted/60 px-1 rounded">
                    non-Ethos
                  </span>
                )}
                <span className="text-muted-foreground">·</span>
                <a
                  href={t.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:underline"
                >
                  {formatRelative(t.createdAt)}
                </a>
                {t.isReply && (
                  <span className="text-[9px] text-muted-foreground bg-muted px-1 rounded">
                    reply
                  </span>
                )}
              </div>
              <a
                href={t.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-xs mt-0.5 whitespace-pre-wrap wrap-break-word hover:underline"
              >
                {t.text}
              </a>
              {(t.likeCount || t.replyCount || t.retweetCount) ? (
                <div className="flex items-center gap-3 mt-1.5">
                  <TweetCount icon={MessageCircle} n={t.replyCount} />
                  <TweetCount icon={Repeat2} n={t.retweetCount} />
                  <TweetCount icon={Heart} n={t.likeCount} />
                </div>
              ) : null}
            </div>
          </div>
        </div>
        );
      })}
    </div>
  );
}

export function EvidenceCard({
  result,
  screenshots,
  onScreenshotUpload,
  onScreenshotRemove,
  onPaste,
  initialTwitterEvidence,
  onTwitterEvidenceChange,
}: EvidenceCardProps) {
  const fileInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const [tweetResults, setTweetResults] = useState<Map<string, TweetResultEntry>>(() => {
    // Hydrate from the saved investigation if present.
    const m = new Map<string, TweetResultEntry>();
    if (initialTwitterEvidence) {
      for (const [addr, raw] of Object.entries(initialTwitterEvidence)) {
        const r = raw as Partial<TweetResultEntry> | undefined;
        if (!r) continue;
        m.set(addr, {
          tweets: Array.isArray(r.tweets) ? (r.tweets as Tweet[]) : [],
          rawCount: typeof r.rawCount === "number" ? r.rawCount : 0,
          ethosCount: typeof r.ethosCount === "number" ? r.ethosCount : 0,
        });
      }
    }
    return m;
  });

  // Surface changes back to the parent so they can be saved alongside the
  // investigation. Sent as a plain object for JSON serialisation.
  useEffect(() => {
    if (!onTwitterEvidenceChange) return;
    onTwitterEvidenceChange(Object.fromEntries(tweetResults));
  }, [tweetResults, onTwitterEvidenceChange]);
  const [searching, setSearching] = useState<Set<string>>(new Set());
  const [searchErrors, setSearchErrors] = useState<Map<string, string>>(new Map());
  const [scanningAll, setScanningAll] = useState(false);

  const allCandidates = [...result.strongCluster, ...result.possibleCluster];
  if (allCandidates.length === 0) return null;

  const entries = [
    { address: result.target, label: "Target" as string | null, ethosProfile: result.targetEthos, confidence: null as string | null, score: null as number | null },
    ...allCandidates.map((c) => ({
      address: c.address,
      label: null as string | null,
      ethosProfile: c.ethosProfile,
      confidence: c.confidence as string | null,
      score: c.score as number | null,
    })),
  ];

  // Map address → cluster-member profile_id so the cross-cluster summary
  // can label each tweeted wallet by its owner's display name if it
  // belongs to a profiled cluster member.
  const addressToClusterProfileId = new Map<string, number>();
  for (const e of entries) {
    if (e.ethosProfile?.profileId) {
      addressToClusterProfileId.set(e.address.toLowerCase(), e.ethosProfile.profileId);
    }
  }

  // Aggregate Ethos-author tweets across all rows by author profile so
  // we can render a single flat "who tweeted which cluster wallets" list.
  // Non-Ethos tweets are intentionally excluded — without a profile we
  // can't anchor the cross-cluster signal.
  const byAuthor = new Map<
    number,
    {
      profile: NonNullable<Tweet["ethos"]>;
      authorName: string;
      authorHandle: string;
      walletAddresses: Set<string>;
      tweets: { address: string; tweet: Tweet }[];
    }
  >();
  for (const [address, { tweets }] of tweetResults) {
    for (const t of tweets) {
      if (!t.ethos) continue;
      const pid = t.ethos.profileId;
      let bucket = byAuthor.get(pid);
      if (!bucket) {
        bucket = {
          profile: t.ethos,
          authorName: t.ethos.displayName || t.author.name || t.author.userName,
          authorHandle: t.author.userName,
          walletAddresses: new Set(),
          tweets: [],
        };
        byAuthor.set(pid, bucket);
      }
      bucket.walletAddresses.add(address.toLowerCase());
      bucket.tweets.push({ address, tweet: t });
    }
  }

  const scanAll = async () => {
    if (scanningAll) return;
    setScanningAll(true);
    let first = true;
    for (const entry of entries) {
      if (tweetResults.has(entry.address)) continue;
      // Pacing: twitterapi.io's sliding-window rate limit means rapid
      // back-to-back requests get rejected even with server-side
      // retries. 1500ms between calls keeps an unsupervised scan-all
      // reliable on a typical 10-15-candidate cluster.
      if (!first) await new Promise((r) => setTimeout(r, 1500));
      first = false;
      await runAutoSearch(entry.address);
    }
    setScanningAll(false);
  };

  const runAutoSearch = async (address: string) => {
    setSearching((s) => new Set(s).add(address));
    setSearchErrors((m) => {
      const next = new Map(m);
      next.delete(address);
      return next;
    });
    try {
      const res = await fetch(`/api/twitter/search?q=${encodeURIComponent(address)}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed: ${res.status}`);
      }
      const data = (await res.json()) as TwitterSearchResult;
      setTweetResults((m) =>
        new Map(m).set(address, {
          tweets: data.tweets,
          rawCount: data.rawCount,
          ethosCount: data.ethosCount,
        })
      );
    } catch (err) {
      setSearchErrors((m) =>
        new Map(m).set(address, err instanceof Error ? err.message : "Search failed")
      );
    } finally {
      setSearching((s) => {
        const next = new Set(s);
        next.delete(address);
        return next;
      });
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Search className="h-5 w-5 text-muted-foreground" />
              X/Twitter Evidence
            </CardTitle>
            <CardDescription className="text-xs mt-1">
              Auto-search X for each wallet, filter to Ethos-registered authors, and surface
              cross-cluster mention patterns.
            </CardDescription>
          </div>
          <button
            onClick={scanAll}
            disabled={scanningAll}
            className="inline-flex items-center gap-1.5 text-xs bg-primary text-primary-foreground rounded-md px-2.5 py-1.5 hover:bg-primary/90 transition-colors disabled:opacity-60 disabled:cursor-wait cursor-pointer shrink-0"
          >
            {scanningAll ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Zap className="h-3 w-3" />
            )}
            {scanningAll ? "Scanning…" : "Scan all candidates"}
          </button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {byAuthor.size > 0 && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 space-y-2">
            <div className="text-xs font-semibold flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
              Cross-cluster Twitter mentions ({byAuthor.size})
            </div>
            <div className="space-y-1.5">
              {[...byAuthor.values()]
                .sort((a, b) => b.walletAddresses.size - a.walletAddresses.size || b.tweets.length - a.tweets.length)
                .map((a) => {
                  const wallets = [...a.walletAddresses].map((addr) => {
                    const pid = addressToClusterProfileId.get(addr);
                    const entry = pid
                      ? entries.find((e) => e.ethosProfile?.profileId === pid)
                      : entries.find((e) => e.address.toLowerCase() === addr);
                    return {
                      address: addr,
                      label:
                        entry?.label ||
                        entry?.ethosProfile?.displayName ||
                        `${addr.slice(0, 8)}…${addr.slice(-6)}`,
                    };
                  });
                  return (
                    <div key={a.profile.profileId} className="flex items-start gap-2 text-xs">
                      <AuthorPill profile={a.profile} handle={a.authorHandle} fallbackName={a.authorName} />
                      <span className="text-muted-foreground text-[11px] shrink-0">tweeted</span>
                      <span className="text-[11px] flex flex-wrap gap-1">
                        {wallets.map((w) => (
                          <span key={w.address} className="font-medium">
                            {w.label}
                          </span>
                        )).reduce<React.ReactNode[]>((acc, el, i) => {
                          if (i > 0) acc.push(<span key={`s${i}`} className="text-muted-foreground">,</span>);
                          acc.push(el);
                          return acc;
                        }, [])}
                      </span>
                    </div>
                  );
                })}
            </div>
          </div>
        )}
        {entries.map((entry) => {
          const isSearching = searching.has(entry.address);
          const result = tweetResults.get(entry.address);
          const error = searchErrors.get(entry.address);
          return (
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
                    <span className="truncate inline-flex items-center gap-1">
                      {entry.ethosProfile.displayName}
                      {entry.ethosProfile.humanVerified && <HumanVerifiedBadge size={12} />}
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
                <button
                  onClick={() => runAutoSearch(entry.address)}
                  disabled={isSearching}
                  className="p-1.5 rounded hover:bg-muted transition-colors cursor-pointer disabled:cursor-wait shrink-0"
                  title="Auto-search X via API"
                >
                  {isSearching ? (
                    <Loader2 className="h-3.5 w-3.5 text-muted-foreground animate-spin" />
                  ) : (
                    <Zap className="h-3.5 w-3.5 text-amber-500" />
                  )}
                </button>
                {!screenshots.has(entry.address) ? (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => onPaste(entry.address)}
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
                        if (file) onScreenshotUpload(entry.address, file);
                        e.target.value = "";
                      }}
                    />
                  </div>
                ) : (
                  <button
                    onClick={() => onScreenshotRemove(entry.address)}
                    className="p-1.5 rounded hover:bg-muted transition-colors cursor-pointer shrink-0"
                    title="Remove screenshot"
                  >
                    <X className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                )}
              </div>
              {error && (
                <div className="text-[11px] text-destructive">{error}</div>
              )}
              {result && (
                <TweetList
                  tweets={result.tweets}
                  rawCount={result.rawCount}
                  ethosCount={result.ethosCount}
                />
              )}
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
          );
        })}

        <div className="text-[10px] text-muted-foreground">
          ⚡ Auto-search via API (costs ~$0.0002 per query). If 2+ accounts posted the same address, it&apos;s likely a sybil cluster.
        </div>
      </CardContent>
    </Card>
  );
}
