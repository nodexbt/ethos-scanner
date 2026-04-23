import { getSupabase } from "./supabase";

export interface LastRun {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  rowsWritten: number | null;
  durationMs: number | null;
  errorMessage: string | null;
}

export interface ProfileSummary {
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
  humanVerified: boolean;
  score: number | null;
}

export interface ScoreMover extends ProfileSummary {
  profileId: number;
  scoreStart: number | null;
  scoreEnd: number | null;
  scoreDelta: number | null;
}

export interface XpGainer extends ProfileSummary {
  profileId: number;
  xpGained: number;
  xpSpent: number;
}

export interface ActivitySpike extends ProfileSummary {
  profileId: number;
  count: number;
}

export interface NewProfile extends ProfileSummary {
  profileId: number;
  createdAt: string;
}

export interface MonitoringSummary {
  lastRun: LastRun | null;
  today: string;
  topScoreGainers: ScoreMover[];
  topXpGainers: XpGainer[];
  topReviewers: ActivitySpike[];
  topVouchers: ActivitySpike[];
  topAcceptedInviters: ActivitySpike[];
  topAttestationAdders: ActivitySpike[];
  newProfiles: NewProfile[];
  newProfileCount: number;
}

const LIMIT = 5;

function todayUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

interface LatestRow {
  profile_id: number;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
  human_verified: boolean | null;
  score: number | null;
}

export async function getMonitoringSummary(): Promise<MonitoringSummary> {
  const supabase = getSupabase();
  const today = todayUtcDate();

  // Step 1: fetch the top-N rows for every metric. Each query is cheap
  // because snapshot_date is the leading index column and LIMIT is tiny.
  const [
    lastRunRes,
    scoreRes,
    xpRes,
    reviewersRes,
    vouchersRes,
    invitesRes,
    attestationsRes,
    newProfilesRes,
    newProfileCountRes,
  ] = await Promise.all([
    supabase
      .from("monitoring_runs")
      .select("id, started_at, finished_at, status, rows_written, error_message, duration_ms")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("profile_daily")
      .select("profile_id, score_end, score_delta")
      .eq("snapshot_date", today)
      .gt("score_delta", 0)
      .order("score_delta", { ascending: false })
      .limit(LIMIT),
    supabase
      .from("profile_daily")
      .select("profile_id, xp_gained, xp_spent")
      .eq("snapshot_date", today)
      .gt("xp_gained", 0)
      .order("xp_gained", { ascending: false })
      .limit(LIMIT),
    supabase
      .from("profile_daily")
      .select("profile_id, reviews_authored")
      .eq("snapshot_date", today)
      .gt("reviews_authored", 0)
      .order("reviews_authored", { ascending: false })
      .limit(LIMIT),
    supabase
      .from("profile_daily")
      .select("profile_id, vouches_given")
      .eq("snapshot_date", today)
      .gt("vouches_given", 0)
      .order("vouches_given", { ascending: false })
      .limit(LIMIT),
    supabase
      .from("profile_daily")
      .select("profile_id, invitations_accepted")
      .eq("snapshot_date", today)
      .gt("invitations_accepted", 0)
      .order("invitations_accepted", { ascending: false })
      .limit(LIMIT),
    supabase
      .from("profile_daily")
      .select("profile_id, attestations_added")
      .eq("snapshot_date", today)
      .gt("attestations_added", 0)
      .order("attestations_added", { ascending: false })
      .limit(LIMIT),
    // "New profiles" = profile_latest rows first inserted today. The
    // cron's created_at is effectively "first time we saw this profile,"
    // which lines up with Ethos-created-today as long as the cron has
    // been running daily. Good enough until we add a dedicated
    // first_seen_ethos column sourced from profiles.createdAt.
    supabase
      .from("profile_latest")
      .select(
        "profile_id, display_name, username, avatar_url, human_verified, score, created_at"
      )
      .gte("created_at", `${today}T00:00:00Z`)
      .order("created_at", { ascending: false })
      .limit(LIMIT),
    supabase
      .from("profile_latest")
      .select("profile_id", { count: "exact", head: true })
      .gte("created_at", `${today}T00:00:00Z`),
  ]);

  // Step 2: collect every profile_id we need names for, and bulk-fetch
  // from profile_latest in one query.
  const ids = new Set<number>();
  const collect = (rows: { data: { profile_id: number }[] | null }) => {
    for (const r of rows.data ?? []) ids.add(r.profile_id);
  };
  collect(scoreRes);
  collect(xpRes);
  collect(reviewersRes);
  collect(vouchersRes);
  collect(invitesRes);
  collect(attestationsRes);

  const names = new Map<number, LatestRow>();
  if (ids.size > 0) {
    const { data: latestRows } = await supabase
      .from("profile_latest")
      .select("profile_id, display_name, username, avatar_url, human_verified, score")
      .in("profile_id", [...ids]);
    for (const row of (latestRows ?? []) as LatestRow[]) {
      names.set(row.profile_id, row);
    }
  }

  const summary = (profileId: number): ProfileSummary => {
    const l = names.get(profileId);
    return {
      displayName: l?.display_name ?? null,
      username: l?.username ?? null,
      avatarUrl: l?.avatar_url ?? null,
      humanVerified: Boolean(l?.human_verified),
      score: l?.score ?? null,
    };
  };

  const lastRunRow = lastRunRes.data as
    | {
        id: number;
        started_at: string;
        finished_at: string | null;
        status: string;
        rows_written: number | null;
        error_message: string | null;
        duration_ms: number | null;
      }
    | null;
  const lastRun: LastRun | null = lastRunRow
    ? {
        id: lastRunRow.id,
        startedAt: lastRunRow.started_at,
        finishedAt: lastRunRow.finished_at,
        status: lastRunRow.status,
        rowsWritten: lastRunRow.rows_written,
        errorMessage: lastRunRow.error_message,
        durationMs: lastRunRow.duration_ms,
      }
    : null;

  const topScoreGainers: ScoreMover[] = ((scoreRes.data ?? []) as {
    profile_id: number;
    score_end: number | null;
    score_delta: number | null;
  }[]).map((r) => ({
    profileId: r.profile_id,
    scoreStart:
      r.score_end != null && r.score_delta != null ? r.score_end - r.score_delta : null,
    scoreEnd: r.score_end,
    scoreDelta: r.score_delta,
    ...summary(r.profile_id),
  }));

  const topXpGainers: XpGainer[] = ((xpRes.data ?? []) as {
    profile_id: number;
    xp_gained: number | string;
    xp_spent: number | string;
  }[]).map((r) => ({
    profileId: r.profile_id,
    xpGained: Number(r.xp_gained ?? 0),
    xpSpent: Number(r.xp_spent ?? 0),
    ...summary(r.profile_id),
  }));

  const spike = (
    rows: { data: unknown[] | null },
    field: string
  ): ActivitySpike[] =>
    ((rows.data ?? []) as Record<string, unknown>[]).map((r) => ({
      profileId: r.profile_id as number,
      count: Number((r[field] as number | string | null) ?? 0),
      ...summary(r.profile_id as number),
    }));

  const newProfiles: NewProfile[] = ((newProfilesRes.data ?? []) as {
    profile_id: number;
    display_name: string | null;
    username: string | null;
    avatar_url: string | null;
    human_verified: boolean | null;
    score: number | null;
    created_at: string;
  }[]).map((r) => ({
    profileId: r.profile_id,
    displayName: r.display_name,
    username: r.username,
    avatarUrl: r.avatar_url,
    humanVerified: Boolean(r.human_verified),
    score: r.score,
    createdAt: r.created_at,
  }));

  return {
    lastRun,
    today,
    topScoreGainers,
    topXpGainers,
    topReviewers: spike(reviewersRes, "reviews_authored"),
    topVouchers: spike(vouchersRes, "vouches_given"),
    topAcceptedInviters: spike(invitesRes, "invitations_accepted"),
    topAttestationAdders: spike(attestationsRes, "attestations_added"),
    newProfiles,
    newProfileCount: newProfileCountRes.count ?? 0,
  };
}
