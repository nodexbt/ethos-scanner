"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Loader2, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { HumanVerifiedBadge } from "@/components/ui/human-verified-badge";
import { AppHeader } from "@/components/app-header";
import type {
  MonitoringSummary,
  ProfileSummary,
  ScoreMover,
  XpGainer,
  ActivitySpike,
  NewProfile,
  InvestigatedMover,
  WatchlistEntry,
} from "@/lib/db/monitoring";
import { Star } from "lucide-react";

function formatRelative(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

function ProfileName({ p }: { p: ProfileSummary & { profileId: number } }) {
  const label = p.displayName?.trim() || (p.username ? `@${p.username}` : `#${p.profileId}`);
  const sub = p.username && p.displayName ? `@${p.username}` : null;
  return (
    <Link
      href={`/monitoring/${p.profileId}`}
      className="inline-flex items-center gap-2 hover:underline min-w-0 group"
    >
      {p.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={p.avatarUrl}
          alt=""
          className="h-6 w-6 rounded-full shrink-0 ring-1 ring-border"
        />
      ) : (
        <div className="h-6 w-6 rounded-full shrink-0 bg-muted" />
      )}
      <span className="inline-flex items-center gap-1.5 min-w-0">
        <span className="font-medium truncate">{label}</span>
        {p.humanVerified && <HumanVerifiedBadge size={12} />}
        {sub && <span className="text-xs text-muted-foreground truncate">{sub}</span>}
      </span>
    </Link>
  );
}

function Row({ left, right }: { left: React.ReactNode; right: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <div className="min-w-0 flex-1">{left}</div>
      <div className="shrink-0 text-xs text-muted-foreground font-mono">{right}</div>
    </div>
  );
}

function EmptySlot({ label }: { label: string }) {
  return (
    <div className="text-xs text-muted-foreground py-2">No {label} in the last 24h.</div>
  );
}

function LastRunCard({ run }: { run: MonitoringSummary["lastRun"] }) {
  if (!run) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Last run</CardTitle>
          <CardDescription className="text-xs">
            No runs recorded yet. First run will happen at the next 03:00 UTC cron.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }
  const ok = run.status === "success";
  const Icon = ok ? CheckCircle2 : XCircle;
  return (
    <Card>
      <div className="flex items-center gap-3 p-4">
        <Icon
          className={`h-5 w-5 shrink-0 ${ok ? "text-green-500" : "text-destructive"}`}
        />
        <div className="min-w-0 flex-1">
          <div className="text-base font-semibold leading-tight">Last run</div>
          <div className="text-xs text-muted-foreground">
            {formatRelative(run.startedAt)}
            {run.durationMs != null && ` · ${Math.round(run.durationMs / 1000)}s`}
            {run.rowsWritten != null && ` · ${run.rowsWritten.toLocaleString()} rows`}
          </div>
        </div>
      </div>
      {!ok && run.errorMessage && (
        <div className="px-4 pb-4 text-xs text-destructive whitespace-pre-wrap">
          {run.errorMessage}
        </div>
      )}
    </Card>
  );
}

function ScoreGainersCard({ rows, rangeLabel }: { rows: ScoreMover[]; rangeLabel: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Top score gainers</CardTitle>
        <CardDescription className="text-xs">{rangeLabel}</CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        {rows.length === 0 ? (
          <EmptySlot label="score gainers" />
        ) : (
          rows.map((r) => (
            <Row
              key={r.profileId}
              left={<ProfileName p={r} />}
              right={
                <span>
                  {r.scoreStart ?? "?"} → {r.scoreEnd ?? "?"}
                  {r.scoreDelta != null && <span className="text-green-500"> (+{r.scoreDelta})</span>}
                </span>
              }
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}

function XpGainersCard({ rows, rangeLabel }: { rows: XpGainer[]; rangeLabel: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Top XP gainers</CardTitle>
        <CardDescription className="text-xs">{rangeLabel}</CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        {rows.length === 0 ? (
          <EmptySlot label="XP gainers" />
        ) : (
          rows.map((r) => (
            <Row
              key={r.profileId}
              left={<ProfileName p={r} />}
              right={
                <span>
                  +{r.xpGained.toLocaleString()}
                  {r.xpSpent > 0 && (
                    <span className="text-muted-foreground"> · -{r.xpSpent.toLocaleString()}</span>
                  )}
                </span>
              }
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}

function SpikeCard({
  title,
  rows,
  unit,
  emptyLabel,
  rangeLabel,
}: {
  title: string;
  rows: ActivitySpike[];
  unit: string;
  emptyLabel: string;
  rangeLabel: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription className="text-xs">{rangeLabel}</CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        {rows.length === 0 ? (
          <EmptySlot label={emptyLabel} />
        ) : (
          rows.map((r) => (
            <Row
              key={r.profileId}
              left={<ProfileName p={r} />}
              right={
                <span>
                  {r.count} {unit}
                </span>
              }
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}

function WatchlistCard({ rows }: { rows: WatchlistEntry[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base inline-flex items-center gap-1.5">
          <Star className="h-4 w-4 fill-amber-500 text-amber-500" />
          Your watchlist
        </CardTitle>
        <CardDescription className="text-xs">
          {rows.length === 0
            ? "Pin profiles from their detail page to track them here."
            : `${rows.length} watched · today's activity shown when present`}
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        {rows.length === 0 ? (
          <EmptySlot label="watched profiles" />
        ) : (
          rows.map((r) => {
            const signals: string[] = [];
            if (r.today) {
              if (r.today.scoreDelta != null && r.today.scoreDelta !== 0) {
                signals.push(
                  `${r.today.scoreDelta > 0 ? "+" : ""}${r.today.scoreDelta} score`
                );
              }
              if (r.today.xpGained > 0)
                signals.push(`+${r.today.xpGained.toLocaleString()} xp`);
              if (r.today.reviewsAuthored > 0)
                signals.push(`${r.today.reviewsAuthored} reviews`);
              if (r.today.vouchesGiven > 0)
                signals.push(`${r.today.vouchesGiven} vouches`);
            }
            return (
              <Row
                key={r.profileId}
                left={<ProfileName p={r} />}
                right={
                  <span className="text-muted-foreground">
                    {signals.length ? signals.join(" · ") : "no activity today"}
                  </span>
                }
              />
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

function InvestigatedMoversCard({ rows }: { rows: InvestigatedMover[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Previously investigated</CardTitle>
        <CardDescription className="text-xs">
          Profiles with an existing sybil scan that also had activity today
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        {rows.length === 0 ? (
          <EmptySlot label="investigated profiles with activity" />
        ) : (
          rows.map((r) => {
            const signals: string[] = [];
            if (r.scoreDelta != null && r.scoreDelta !== 0) {
              signals.push(`${r.scoreDelta > 0 ? "+" : ""}${r.scoreDelta} score`);
            }
            if (r.xpGained > 0) signals.push(`+${r.xpGained.toLocaleString()} xp`);
            if (r.reviewsAuthored > 0) signals.push(`${r.reviewsAuthored} reviews`);
            if (r.vouchesGiven > 0) signals.push(`${r.vouchesGiven} vouches`);
            return (
              <Row
                key={r.profileId}
                left={<ProfileName p={r} />}
                right={
                  <span className="inline-flex items-center gap-2">
                    <span>{signals.join(" · ") || "—"}</span>
                    <span className="text-[10px] uppercase tracking-wide bg-muted px-1.5 py-0.5 rounded">
                      scanned
                    </span>
                  </span>
                }
              />
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

const RANGE_OPTIONS: { days: number; label: string }[] = [
  { days: 1, label: "1d" },
  { days: 7, label: "7d" },
  { days: 30, label: "30d" },
  { days: 90, label: "90d" },
];

function rangeLabel(days: number): string {
  return RANGE_OPTIONS.find((r) => r.days === days)?.label ?? `${days}d`;
}

function NewProfilesCard({
  rows,
  total,
  rangeLabel,
}: {
  rows: NewProfile[];
  total: number;
  rangeLabel: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">New profiles</CardTitle>
        <CardDescription className="text-xs">
          {total} created in the last {rangeLabel} · showing {rows.length} most recent
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        {rows.length === 0 ? (
          <EmptySlot label="new profiles" />
        ) : (
          rows.map((r) => (
            <Row
              key={r.profileId}
              left={<ProfileName p={r} />}
              right={<span>{formatRelative(r.createdAt)}</span>}
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}

export default function MonitoringPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [data, setData] = useState<MonitoringSummary | null>(null);
  const [watchlist, setWatchlist] = useState<WatchlistEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState(1);

  useEffect(() => {
    if (status === "loading") return;
    if (!session) {
      router.replace("/");
    }
  }, [session, status, router]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        // Fetch both in parallel. Summary failure is fatal; watchlist
        // failure just hides the card.
        const [sRes, wRes] = await Promise.all([
          fetch(`/api/monitoring/summary?range=${range}`),
          fetch("/api/monitoring/watchlist"),
        ]);
        if (!sRes.ok) throw new Error(`Failed to load summary: ${sRes.status}`);
        const summary = (await sRes.json()) as MonitoringSummary;
        const wl = wRes.ok ? ((await wRes.json()) as WatchlistEntry[]) : [];
        if (!cancelled) {
          setData(summary);
          setWatchlist(wl);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session, range]);

  if (status === "loading" || !session) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-7xl mx-auto">
      <AppHeader />

      <Card className="mb-4">
        <div className="p-4 flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-semibold">Monitoring</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Score movers, XP gainers, and activity spikes across Ethos.
              {data && (
                <>
                  {" "}Baseline date: <span className="font-mono">{data.today}</span>.
                </>
              )}
            </p>
          </div>
          <div className="inline-flex items-center gap-1 bg-card/70 backdrop-blur-sm border border-border rounded-lg p-1 shrink-0">
            {RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.days}
                onClick={() => setRange(opt.days)}
                className={`text-xs px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                  range === opt.days
                    ? "bg-muted text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {loading && !data && (
        <div className="flex justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 text-sm text-destructive py-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {data && (
        <div className="space-y-4">
          <LastRunCard run={data.lastRun} />
          {watchlist && <WatchlistCard rows={watchlist} />}
          <div className="grid gap-4 md:grid-cols-2">
            <ScoreGainersCard rows={data.topScoreGainers} rangeLabel={rangeLabel(range)} />
            <XpGainersCard rows={data.topXpGainers} rangeLabel={rangeLabel(range)} />
            <SpikeCard
              title="Most reviews authored"
              rows={data.topReviewers}
              unit="reviews"
              emptyLabel="review activity"
              rangeLabel={rangeLabel(range)}
            />
            <SpikeCard
              title="Most vouches given"
              rows={data.topVouchers}
              unit="vouches"
              emptyLabel="vouch activity"
              rangeLabel={rangeLabel(range)}
            />
            <SpikeCard
              title="Most reviews received"
              rows={data.topReviewsReceived}
              unit="received"
              emptyLabel="review-received activity"
              rangeLabel={rangeLabel(range)}
            />
            <SpikeCard
              title="Most vouches received"
              rows={data.topVouchesReceived}
              unit="received"
              emptyLabel="vouch-received activity"
              rangeLabel={rangeLabel(range)}
            />
            <SpikeCard
              title="Most invitations accepted"
              rows={data.topAcceptedInviters}
              unit="accepted"
              emptyLabel="invitation activity"
              rangeLabel={rangeLabel(range)}
            />
            <SpikeCard
              title="Most attestations added"
              rows={data.topAttestationAdders}
              unit="attestations"
              emptyLabel="attestation activity"
              rangeLabel={rangeLabel(range)}
            />
            <div className="md:col-span-2">
              <InvestigatedMoversCard rows={data.investigatedMovers} />
            </div>
            <div className="md:col-span-2">
              <NewProfilesCard rows={data.newProfiles} total={data.newProfileCount} rangeLabel={rangeLabel(range)} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
