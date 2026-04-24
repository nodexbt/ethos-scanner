"use client";

import { useEffect, useState, use } from "react";
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
import { Loader2, AlertTriangle, ArrowLeft, ExternalLink } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { HumanVerifiedBadge } from "@/components/ui/human-verified-badge";
import { Sparkline } from "@/components/ui/sparkline";
import type { ProfileDetail } from "@/lib/db/monitoring";

function fmtDate(isoDate: string): string {
  const [, m, d] = isoDate.split("-");
  return `${m}/${d}`;
}

function ethosProfileUrl(p: { profileId: number; username: string | null }): string {
  return p.username
    ? `https://app.ethos.network/profile/x/${p.username}`
    : `https://app.ethos.network/profile/${p.profileId}`;
}

interface PageParams {
  params: Promise<{ profileId: string }>;
}

export default function ProfileDetailPage({ params }: PageParams) {
  const { profileId: profileIdRaw } = use(params);
  const profileId = Number(profileIdRaw);

  const { data: session, status } = useSession();
  const router = useRouter();

  const [data, setData] = useState<ProfileDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === "loading") return;
    if (!session) router.replace("/");
  }, [session, status, router]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/monitoring/profile/${profileId}`);
        if (!res.ok) throw new Error(`Failed to load: ${res.status}`);
        const json = (await res.json()) as ProfileDetail;
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
  }, [session, profileId]);

  if (status === "loading" || !session) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const profile = data?.profile;
  const days = data?.days ?? [];

  const scorePoints = days.map((d) => d.scoreEnd);
  const xpPoints = days.map((d) => (d.xpTotalEnd != null ? Number(d.xpTotalEnd) : null));

  const total = <T extends keyof typeof days[number]>(key: T) =>
    days.reduce((sum, d) => sum + (Number(d[key] ?? 0) || 0), 0);

  const totalsRow = {
    reviewsAuthored: total("reviewsAuthored"),
    vouchesGiven: total("vouchesGiven"),
    vouchesReceived: total("vouchesReceived"),
    invitationsSent: total("invitationsSent"),
    invitationsAccepted: total("invitationsAccepted"),
    attestationsAdded: total("attestationsAdded"),
    slashesAuthored: total("slashesAuthored"),
    xpGained: total("xpGained"),
    xpSpent: total("xpSpent"),
  };

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-7xl mx-auto">
      <AppHeader />

      <div className="mb-4">
        <Link
          href="/monitoring"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to monitoring
        </Link>
      </div>

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
          {/* Profile header */}
          <Card>
            <div className="p-4 flex items-center gap-4">
              {profile?.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={profile.avatarUrl}
                  alt=""
                  className="h-14 w-14 rounded-full ring-2 ring-border shrink-0"
                />
              ) : (
                <div className="h-14 w-14 rounded-full bg-muted shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-lg truncate">
                    {profile?.displayName?.trim() ||
                      (profile?.username ? `@${profile.username}` : `#${profileId}`)}
                  </span>
                  {profile?.humanVerified && <HumanVerifiedBadge size={14} />}
                  {profile?.username && (
                    <span className="text-sm text-muted-foreground">@{profile.username}</span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Profile #{profileId}
                  {profile?.score != null && ` · Score ${profile.score}`}
                  {profile?.xpTotal != null && ` · XP ${profile.xpTotal.toLocaleString()}`}
                </div>
              </div>
              <a
                href={profile ? ethosProfileUrl(profile) : `https://app.ethos.network/profile/${profileId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs border border-border rounded-md px-2.5 py-1.5 hover:bg-muted/50 transition-colors shrink-0"
              >
                Ethos profile <ExternalLink className="h-3 w-3 opacity-60" />
              </a>
            </div>
          </Card>

          {/* Sparklines */}
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Score (30d)</CardTitle>
                <CardDescription className="text-xs">
                  {days.length} day{days.length === 1 ? "" : "s"} with activity
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-green-500">
                  <Sparkline points={scorePoints} width={320} height={56} />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">XP total (30d)</CardTitle>
                <CardDescription className="text-xs">
                  +{totalsRow.xpGained.toLocaleString()} earned · -{totalsRow.xpSpent.toLocaleString()} spent
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-blue-400">
                  <Sparkline points={xpPoints} width={320} height={56} />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Activity totals */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">30-day totals</CardTitle>
              <CardDescription className="text-xs">
                Summed across all days with a profile_daily row in the last 30 days
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 text-sm">
                <Stat label="Reviews authored" value={totalsRow.reviewsAuthored} />
                <Stat label="Vouches given" value={totalsRow.vouchesGiven} />
                <Stat label="Vouches received" value={totalsRow.vouchesReceived} />
                <Stat label="Invitations sent" value={totalsRow.invitationsSent} />
                <Stat label="Invitations accepted" value={totalsRow.invitationsAccepted} />
                <Stat label="Attestations added" value={totalsRow.attestationsAdded} />
                <Stat label="Slashes authored" value={totalsRow.slashesAuthored} />
              </div>
            </CardContent>
          </Card>

          {/* Daily breakdown */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Daily activity</CardTitle>
              <CardDescription className="text-xs">
                One row per day with activity or a score/xp change
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              {days.length === 0 ? (
                <div className="text-xs text-muted-foreground py-4">
                  No activity recorded in the last 30 days.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-xs">
                    <thead className="text-muted-foreground">
                      <tr className="border-b border-border">
                        <th className="text-left font-medium py-1.5 pr-4">Date</th>
                        <th className="text-right font-medium py-1.5 pr-3">Score</th>
                        <th className="text-right font-medium py-1.5 pr-3">Δ</th>
                        <th className="text-right font-medium py-1.5 pr-3">XP Δ</th>
                        <th className="text-right font-medium py-1.5 pr-3">Rev</th>
                        <th className="text-right font-medium py-1.5 pr-3">V→</th>
                        <th className="text-right font-medium py-1.5 pr-3">V←</th>
                        <th className="text-right font-medium py-1.5 pr-3">Inv</th>
                        <th className="text-right font-medium py-1.5 pr-3">Acc</th>
                        <th className="text-right font-medium py-1.5 pr-3">Att</th>
                        <th className="text-right font-medium py-1.5">Slash</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...days].reverse().map((d) => (
                        <tr key={d.snapshotDate} className="border-b border-border/50">
                          <td className="font-mono py-1.5 pr-4">{fmtDate(d.snapshotDate)}</td>
                          <td className="text-right tabular-nums py-1.5 pr-3">
                            {d.scoreEnd ?? "-"}
                          </td>
                          <td
                            className={`text-right tabular-nums py-1.5 pr-3 ${
                              d.scoreDelta != null && d.scoreDelta > 0
                                ? "text-green-500"
                                : d.scoreDelta != null && d.scoreDelta < 0
                                ? "text-destructive"
                                : ""
                            }`}
                          >
                            {d.scoreDelta == null
                              ? "-"
                              : d.scoreDelta > 0
                              ? `+${d.scoreDelta}`
                              : d.scoreDelta}
                          </td>
                          <td className="text-right tabular-nums py-1.5 pr-3 text-muted-foreground">
                            {d.xpDelta == null ? "-" : d.xpDelta.toLocaleString()}
                          </td>
                          <td className="text-right tabular-nums py-1.5 pr-3">{d.reviewsAuthored || "-"}</td>
                          <td className="text-right tabular-nums py-1.5 pr-3">{d.vouchesGiven || "-"}</td>
                          <td className="text-right tabular-nums py-1.5 pr-3">{d.vouchesReceived || "-"}</td>
                          <td className="text-right tabular-nums py-1.5 pr-3">{d.invitationsSent || "-"}</td>
                          <td className="text-right tabular-nums py-1.5 pr-3">{d.invitationsAccepted || "-"}</td>
                          <td className="text-right tabular-nums py-1.5 pr-3">{d.attestationsAdded || "-"}</td>
                          <td className="text-right tabular-nums py-1.5">{d.slashesAuthored || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-semibold tabular-nums">{value.toLocaleString()}</div>
    </div>
  );
}
