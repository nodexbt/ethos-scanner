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
} from "@/lib/db/monitoring";

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

function profileHref(p: { profileId: number; username: string | null }): string {
  return p.username
    ? `https://app.ethos.network/profile/x/${p.username}`
    : `https://app.ethos.network/profile/${p.profileId}`;
}

function ProfileName({ p }: { p: ProfileSummary & { profileId: number } }) {
  const label = p.displayName?.trim() || (p.username ? `@${p.username}` : `#${p.profileId}`);
  const sub = p.username && p.displayName ? `@${p.username}` : null;
  return (
    <a
      href={profileHref(p)}
      target="_blank"
      rel="noopener noreferrer"
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
    </a>
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

function ScoreGainersCard({ rows }: { rows: ScoreMover[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Top score gainers</CardTitle>
        <CardDescription className="text-xs">Last 24h</CardDescription>
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

function XpGainersCard({ rows }: { rows: XpGainer[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Top XP gainers</CardTitle>
        <CardDescription className="text-xs">Last 24h</CardDescription>
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
}: {
  title: string;
  rows: ActivitySpike[];
  unit: string;
  emptyLabel: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription className="text-xs">Last 24h</CardDescription>
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

function NewProfilesCard({ rows, total }: { rows: NewProfile[]; total: number }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">New profiles</CardTitle>
        <CardDescription className="text-xs">
          {total} created today · showing {rows.length} most recent
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        const res = await fetch("/api/monitoring/summary");
        if (!res.ok) throw new Error(`Failed to load: ${res.status}`);
        const json = (await res.json()) as MonitoringSummary;
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session]);

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
        <div className="p-4">
          <h1 className="text-xl font-semibold">Monitoring</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Score movers, XP gainers, and activity spikes across Ethos in the last 24h.
            {data && (
              <>
                {" "}Baseline date: <span className="font-mono">{data.today}</span>.
              </>
            )}
          </p>
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
          <div className="grid gap-4 md:grid-cols-2">
            <ScoreGainersCard rows={data.topScoreGainers} />
            <XpGainersCard rows={data.topXpGainers} />
            <SpikeCard
              title="Most reviews authored"
              rows={data.topReviewers}
              unit="reviews"
              emptyLabel="review activity"
            />
            <SpikeCard
              title="Most vouches given"
              rows={data.topVouchers}
              unit="vouches"
              emptyLabel="vouch activity"
            />
            <SpikeCard
              title="Most invitations accepted"
              rows={data.topAcceptedInviters}
              unit="accepted"
              emptyLabel="invitation activity"
            />
            <SpikeCard
              title="Most attestations added"
              rows={data.topAttestationAdders}
              unit="attestations"
              emptyLabel="attestation activity"
            />
            <div className="md:col-span-2">
              <NewProfilesCard rows={data.newProfiles} total={data.newProfileCount} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
