import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Shield, AlertTriangle, Lock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { SiteHeader } from "@/components/site-header";
import { AppFooter } from "@/components/app-footer";
import { ResearchDisclaimer } from "@/components/results/research-disclaimer";
import { EthosScoreIcon } from "@/components/ui/ethos-score-icon";
import { HumanVerifiedBadge } from "@/components/ui/human-verified-badge";
import { getPublicProfileSummary } from "@/lib/public-profile";
import { formatRelativeTime } from "@/lib/utils";

// Public, summary-only. Re-rendered at most every 2 minutes per handle so
// a shared link can't hammer the Ethos API or the database.
export const revalidate = 120;

type Params = { params: Promise<{ handle: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { handle } = await params;
  const data = await getPublicProfileSummary(handle);
  if (!data) return { title: "Profile not found · Ethos Scanner" };
  const name = data.profile.displayName;
  const description = data.scan
    ? `${data.scan.strongCount} strong and ${data.scan.possibleCount} possible on-chain links · scanned ${
        data.scan.scannedAt ? formatRelativeTime(data.scan.scannedAt) : "recently"
      }. Evidence, not a verdict.`
    : `${name} has not been scanned yet. Sign in to run a wallet cluster scan.`;
  return {
    title: `${name} · Ethos Scanner`,
    description,
    openGraph: { title: `${name} · Ethos Scanner`, description, type: "profile" },
    twitter: { card: "summary", title: `${name} · Ethos Scanner`, description },
  };
}

export default async function PublicProfilePage({ params }: Params) {
  const { handle } = await params;
  const data = await getPublicProfileSummary(handle);
  if (!data) notFound();
  const { profile, scan } = data;
  const ethosUrl = profile.username
    ? `https://app.ethos.network/profile/x/${profile.username}`
    : `https://app.ethos.network/profile/${profile.profileId}`;
  const scanHref = `/scan/x/${profile.username ?? profile.profileId}`;

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-4xl mx-auto">
      <SiteHeader cta="Sign in to scan" />

      <Card>
        <CardContent className="p-5 flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={profile.avatarUrl} alt="" className="h-16 w-16 rounded-full ring-2 ring-border shrink-0" />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold tracking-tight inline-flex items-center gap-2 flex-wrap">
              {profile.displayName}
              {profile.humanVerified && <HumanVerifiedBadge size={18} />}
            </h1>
            <div className="text-sm text-muted-foreground flex items-center gap-2 flex-wrap">
              {profile.username && (
                <a href={ethosUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">
                  @{profile.username}
                </a>
              )}
              <span className="inline-flex items-center gap-1">
                Ethos score {profile.score}
                <EthosScoreIcon size={10} />
              </span>
              {scan?.scannedAt && (
                <span title={new Date(scan.scannedAt).toLocaleString()}>· scanned {formatRelativeTime(scan.scannedAt)}</span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {scan ? (
        <>
          <div className="grid grid-cols-2 gap-3 mt-4">
            <Card>
              <CardContent className="p-4 text-center">
                <div className={`text-3xl font-bold ${scan.strongCount > 0 ? "text-red-500" : ""}`}>{scan.strongCount}</div>
                <div className="text-xs text-muted-foreground">Strong links</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className={`text-3xl font-bold ${scan.possibleCount > 0 ? "text-amber-500" : ""}`}>{scan.possibleCount}</div>
                <div className="text-xs text-muted-foreground">Possible links</div>
              </CardContent>
            </Card>
          </div>

          {scan.degraded && (
            <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
              <span>This scan was incomplete: a data source failed while it ran. Treat the result as inconclusive.</span>
            </div>
          )}

          <Card className="mt-4">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                {scan.links.length > 0 ? (
                  <>
                    <AlertTriangle className={`h-5 w-5 ${scan.strongCount > 0 ? "text-red-500" : "text-amber-500"}`} />
                    Linked profiles
                  </>
                ) : (
                  <>
                    <Shield className="h-5 w-5 text-muted-foreground" />
                    No on-chain links found
                  </>
                )}
              </CardTitle>
              <CardDescription className="text-xs">
                {scan.links.length > 0
                  ? "Profiles whose wallets share funding, exchange accounts or transfers with this one. Sign in to see the evidence behind each link."
                  : "The scan found no wallet-level ties to other Ethos profiles. That is not proof of innocence."}
              </CardDescription>
            </CardHeader>
            {scan.links.length > 0 && (
              <CardContent className="space-y-2">
                {scan.links.map((l) => (
                  <Link
                    key={l.profileId}
                    href={`/p/${l.username ?? l.profileId}`}
                    className="flex items-center gap-3 rounded-lg border border-border p-3 hover:bg-muted/30 transition-colors"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={l.avatarUrl} alt="" className="h-9 w-9 rounded-full shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm truncate">{l.displayName}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {l.username ? `@${l.username} · ` : ""}Ethos score {l.ethosScore}
                      </div>
                    </div>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium text-white ${
                        l.confidence === "high" ? "bg-red-500" : "bg-amber-500"
                      }`}
                    >
                      {l.confidence === "high" ? "strong" : "possible"} · {l.linkStrength}
                    </span>
                  </Link>
                ))}
              </CardContent>
            )}
          </Card>

          <Card className="mt-4">
            <CardContent className="p-4 flex items-center gap-3 text-sm">
              <Lock className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="flex-1">
                The full result shows every signal, first funders, shared exchange deposits and Ethos social ties.
              </span>
              <Link href={scanHref} className="shrink-0 text-xs font-medium border border-border rounded-md px-3 py-1.5 hover:bg-muted/50 transition-colors">
                Sign in to view
              </Link>
            </CardContent>
          </Card>
        </>
      ) : (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="text-base">Not scanned yet</CardTitle>
            <CardDescription className="text-sm">
              No wallet cluster scan has been run for this profile. Eligible Ethos members can run one in a couple of minutes.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href={scanHref} className="inline-flex text-xs font-medium border border-border rounded-md px-3 py-1.5 hover:bg-muted/50 transition-colors">
              Sign in to scan {profile.displayName}
            </Link>
          </CardContent>
        </Card>
      )}

      <div className="mt-4">
        <ResearchDisclaimer />
      </div>
      <AppFooter />
    </div>
  );
}
