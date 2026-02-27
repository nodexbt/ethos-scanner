"use client";

import { useState, useCallback } from "react";
import { ReviewsMap } from "@/components/reviews-map";
import { VouchesMap } from "@/components/vouches-map";
import { InvitationMap } from "@/components/invitation-map";
import { TriangleDetection } from "@/components/triangle-detection";
import type { EthosProfile } from "@/lib/types";

type TabId = "overview" | "reviews" | "vouches" | "invitations" | "triangles";

interface ProfileTabsProps {
  profile: EthosProfile;
}

export function ProfileTabs({ profile }: ProfileTabsProps) {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [mountedTabs, setMountedTabs] = useState<Set<TabId>>(
    new Set(["overview"])
  );

  const switchTab = useCallback((tab: TabId) => {
    setActiveTab(tab);
    setMountedTabs((prev) => {
      if (prev.has(tab)) return prev;
      const next = new Set(prev);
      next.add(tab);
      return next;
    });
  }, []);

  const totalReviews =
    profile.stats.review.received.positive +
    profile.stats.review.received.neutral +
    profile.stats.review.received.negative;
  const totalVouches =
    profile.stats.vouch.given.count + profile.stats.vouch.received.count;
  const hasProfileId = profile.profileId !== null;

  const tabs: { id: TabId; label: string; count?: number }[] = [
    { id: "overview", label: "Overview" },
    { id: "reviews", label: "Reviews", count: totalReviews },
    { id: "vouches", label: "Vouches", count: totalVouches },
    { id: "invitations", label: "Invitations" },
    { id: "triangles", label: "Triangles" },
  ];

  return (
    <div>
      {/* Tab bar */}
      <div className="flex border-b border-border">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => switchTab(tab.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
              activeTab === tab.id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30"
            }`}
          >
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span className="ml-1.5 text-xs text-muted-foreground">
                ({tab.count})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="pt-6">
        {/* Overview */}
        <div className={activeTab === "overview" ? "" : "hidden"}>
          <OverviewContent profile={profile} />
        </div>

        {/* Reviews — lazy-mounted */}
        {mountedTabs.has("reviews") && (
          <div className={activeTab === "reviews" ? "" : "hidden"}>
            {hasProfileId && totalReviews > 0 ? (
              <ReviewsMap
                userId={profile.id}
                profileId={profile.profileId!}
                userName={profile.displayName}
                avatarUrl={profile.avatarUrl}
              />
            ) : (
              <EmptyState message="No reviews to display" />
            )}
          </div>
        )}

        {/* Vouches — lazy-mounted */}
        {mountedTabs.has("vouches") && (
          <div className={activeTab === "vouches" ? "" : "hidden"}>
            {hasProfileId && totalVouches > 0 ? (
              <VouchesMap
                userId={profile.id}
                profileId={profile.profileId!}
                userName={profile.displayName}
                avatarUrl={profile.avatarUrl}
              />
            ) : (
              <EmptyState message="No vouches to display" />
            )}
          </div>
        )}

        {/* Invitations — lazy-mounted */}
        {mountedTabs.has("invitations") && (
          <div className={activeTab === "invitations" ? "" : "hidden"}>
            {hasProfileId ? (
              <InvitationMap
                userId={profile.id}
                profileId={profile.profileId!}
                userName={profile.displayName}
                avatarUrl={profile.avatarUrl}
              />
            ) : (
              <EmptyState message="Invitations not available for uninitialized profiles" />
            )}
          </div>
        )}

        {/* Triangles — lazy-mounted */}
        {mountedTabs.has("triangles") && (
          <div className={activeTab === "triangles" ? "" : "hidden"}>
            {hasProfileId && totalReviews > 0 ? (
              <TriangleDetection
                profileId={profile.profileId!}
                userName={profile.displayName}
              />
            ) : (
              <EmptyState message="Triangle detection requires review data" />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function OverviewContent({ profile }: { profile: EthosProfile }) {
  return (
    <div className="space-y-6">
      {/* Stats grid */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <div className="text-sm font-medium text-muted-foreground">
            Credibility Score
          </div>
          <div className="text-2xl font-bold">{profile.score}</div>
        </div>
        <div className="space-y-2">
          <div className="text-sm font-medium text-muted-foreground">
            XP Streak
          </div>
          <div className="text-2xl font-semibold">
            {profile.xpStreakDays} days
          </div>
        </div>
        <div className="space-y-2">
          <div className="text-sm font-medium text-muted-foreground">
            Influence Factor
          </div>
          <div className="text-2xl font-semibold">
            {profile.influenceFactor.toFixed(2)}
          </div>
          <div className="text-xs text-muted-foreground">
            {profile.influenceFactorPercentile.toFixed(1)}th percentile
          </div>
        </div>
        {profile.profileId && (
          <div className="space-y-2">
            <div className="text-sm font-medium text-muted-foreground">
              Profile ID
            </div>
            <div className="text-2xl font-semibold">{profile.profileId}</div>
          </div>
        )}
      </div>

      {/* Reviews received */}
      <div className="border-t border-border pt-6">
        <h3 className="mb-4 text-lg font-semibold">Reviews Received</h3>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-1">
            <div className="text-sm text-muted-foreground">Positive</div>
            <div className="text-xl font-semibold text-green-600">
              {profile.stats.review.received.positive}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-sm text-muted-foreground">Neutral</div>
            <div className="text-xl font-semibold text-gray-600">
              {profile.stats.review.received.neutral}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-sm text-muted-foreground">Negative</div>
            <div className="text-xl font-semibold text-red-600">
              {profile.stats.review.received.negative}
            </div>
          </div>
        </div>
      </div>

      {/* Vouches */}
      <div className="border-t border-border pt-6">
        <h3 className="mb-4 text-lg font-semibold">Vouches</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <div className="text-sm text-muted-foreground">Given</div>
            <div className="text-lg font-semibold">
              {profile.stats.vouch.given.count} vouches
            </div>
            <div className="text-xs text-muted-foreground">
              {(
                Number(profile.stats.vouch.given.amountWeiTotal) / 1e18
              ).toFixed(4)}{" "}
              ETH
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-sm text-muted-foreground">Received</div>
            <div className="text-lg font-semibold">
              {profile.stats.vouch.received.count} vouches
            </div>
            <div className="text-xs text-muted-foreground">
              {(
                Number(profile.stats.vouch.received.amountWeiTotal) / 1e18
              ).toFixed(4)}{" "}
              ETH
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-md bg-muted p-6 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
