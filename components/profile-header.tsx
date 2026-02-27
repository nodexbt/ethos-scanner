"use client";

import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { EthosProfile } from "@/lib/types";

interface ProfileHeaderProps {
  profile: EthosProfile;
}

export function ProfileHeader({ profile }: ProfileHeaderProps) {
  return (
    <div className="flex items-start gap-4">
      {profile.avatarUrl && (
        <img
          src={profile.avatarUrl}
          alt={profile.displayName}
          className="h-16 w-16 rounded-full"
        />
      )}
      <div className="flex-1 min-w-0">
        <h1 className="text-2xl font-semibold">{profile.displayName}</h1>
        {profile.username && (
          <div className="text-muted-foreground mt-0.5">
            @{profile.username}
          </div>
        )}
        {profile.description && (
          <p className="mt-2 text-sm text-muted-foreground line-clamp-2">
            {profile.description}
          </p>
        )}
      </div>
      <div className="flex gap-2 shrink-0">
        <a
          href={profile.links.profile}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Button variant="outline" size="sm" className="gap-1.5">
            <ExternalLink className="h-3.5 w-3.5" />
            Profile
          </Button>
        </a>
        <a
          href={profile.links.scoreBreakdown}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Button variant="outline" size="sm" className="gap-1.5">
            <ExternalLink className="h-3.5 w-3.5" />
            Score
          </Button>
        </a>
      </div>
    </div>
  );
}
