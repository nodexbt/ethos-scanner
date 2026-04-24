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

export interface InvestigatedMover extends ProfileSummary {
  profileId: number;
  primaryAddress: string | null;
  scoreDelta: number | null;
  scoreEnd: number | null;
  xpGained: number;
  reviewsAuthored: number;
  vouchesGiven: number;
  investigationUpdatedAt: string;
}

export interface ProfileDetail {
  profile: {
    profileId: number;
    displayName: string | null;
    username: string | null;
    avatarUrl: string | null;
    humanVerified: boolean;
    score: number | null;
    xpTotal: number | null;
    primaryAddress: string | null;
    lastSeen: string | null;
  } | null;
  days: ProfileDailyRow[];
  /** Aggregated over the last 30 days, sorted by |sent-received| desc. */
  tipCounterparties: XpTipCounterparty[];
}

export interface ProfileDailyRow {
  snapshotDate: string;
  scoreEnd: number | null;
  scoreDelta: number | null;
  xpTotalEnd: number | null;
  xpDelta: number | null;
  reviewsAuthored: number;
  vouchesGiven: number;
  vouchesReceived: number;
  invitationsSent: number;
  invitationsAccepted: number;
  attestationsAdded: number;
  slashesAuthored: number;
  xpGained: number;
  xpSpent: number;
  xpByType: Record<string, number>;
  /** {counterpartyProfileId: points}, points always positive. */
  xpTips: { sent: Record<string, number>; received: Record<string, number> };
}

export interface XpTipCounterparty extends ProfileSummary {
  profileId: number;
  sent: number;
  received: number;
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
  investigatedMovers: InvestigatedMover[];
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
    investigationsRes,
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
    // All investigated wallet addresses — small set (investigations grows
    // slowly), so it's cheaper to pull them and filter profile_latest by
    // primary_address in two steps than to attempt a cross-schema join.
    supabase.from("investigations").select("id, target, updated_at"),
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

  // Cross-reference: profiles that have an existing investigation AND had
  // activity today. Three-step lookup (list investigated addresses, map to
  // profile_ids, fetch today's rows) instead of a cross-table join, which
  // the Supabase query builder doesn't support cleanly.
  const investigations = ((investigationsRes.data ?? []) as {
    id: string;
    target: string;
    updated_at: string;
  }[]);
  const INVESTIGATED_LIMIT = 10;
  let investigatedMovers: InvestigatedMover[] = [];
  if (investigations.length > 0) {
    const targets = [...new Set(investigations.map((i) => i.target.toLowerCase()))];

    // Match against any of the profile's wallets (profile_addresses), not
    // just the primary. A scanner user could have investigated any of a
    // profile's addresses.
    const { data: addressMatches } = await supabase
      .from("profile_addresses")
      .select("profile_id, address")
      .in("address", targets);
    const matchedAddresses = (addressMatches ?? []) as {
      profile_id: number;
      address: string;
    }[];
    const profileIdToMatchedAddress = new Map<number, string>();
    for (const m of matchedAddresses) {
      if (!profileIdToMatchedAddress.has(m.profile_id)) {
        profileIdToMatchedAddress.set(m.profile_id, m.address);
      }
    }
    const matchedProfileIds = [...profileIdToMatchedAddress.keys()];

    const { data: matchedLatest } = matchedProfileIds.length
      ? await supabase
          .from("profile_latest")
          .select(
            "profile_id, primary_address, display_name, username, avatar_url, human_verified, score"
          )
          .in("profile_id", matchedProfileIds)
      : { data: [] };

    const matched = (matchedLatest ?? []) as {
      profile_id: number;
      primary_address: string | null;
      display_name: string | null;
      username: string | null;
      avatar_url: string | null;
      human_verified: boolean | null;
      score: number | null;
    }[];

    if (matched.length > 0) {
      // Pick the most-recent investigation per target address, then roll
      // up to profile_id via the matched-address map so each profile gets
      // its most recent scan timestamp.
      const latestByTarget = new Map<string, string>();
      for (const inv of investigations) {
        const key = inv.target.toLowerCase();
        const prior = latestByTarget.get(key);
        if (!prior || new Date(inv.updated_at) > new Date(prior)) {
          latestByTarget.set(key, inv.updated_at);
        }
      }

      const profileIds = matched.map((m) => m.profile_id);
      const { data: dailyRows } = await supabase
        .from("profile_daily")
        .select(
          "profile_id, score_end, score_delta, reviews_authored, vouches_given, xp_gained"
        )
        .eq("snapshot_date", today)
        .in("profile_id", profileIds);

      const dailyByProfile = new Map<
        number,
        {
          score_end: number | null;
          score_delta: number | null;
          reviews_authored: number;
          vouches_given: number;
          xp_gained: number | string;
        }
      >();
      for (const r of (dailyRows ?? []) as {
        profile_id: number;
        score_end: number | null;
        score_delta: number | null;
        reviews_authored: number;
        vouches_given: number;
        xp_gained: number | string;
      }[]) {
        dailyByProfile.set(r.profile_id, r);
      }

      investigatedMovers = matched
        .map((m) => {
          const d = dailyByProfile.get(m.profile_id);
          if (!d) return null;
          // Resolve the investigation timestamp via the wallet that
          // actually matched, not just the primary — those can differ.
          const matchedAddress = profileIdToMatchedAddress.get(m.profile_id);
          const inv = matchedAddress ? latestByTarget.get(matchedAddress) : undefined;
          if (!inv) return null;
          return {
            profileId: m.profile_id,
            primaryAddress: m.primary_address,
            displayName: m.display_name,
            username: m.username,
            avatarUrl: m.avatar_url,
            humanVerified: Boolean(m.human_verified),
            score: m.score,
            scoreDelta: d.score_delta,
            scoreEnd: d.score_end,
            xpGained: Number(d.xp_gained ?? 0),
            reviewsAuthored: Number(d.reviews_authored ?? 0),
            vouchesGiven: Number(d.vouches_given ?? 0),
            investigationUpdatedAt: inv,
          };
        })
        .filter((r): r is InvestigatedMover => r !== null)
        // Rank by a weighted magnitude of today's change — score and vouch
        // activity dominate because they're rarer than XP ticks, which
        // accumulate from routine interactions. XP contributes at a much
        // lower weight so an active-but-not-unusual day still ranks below
        // a clear score or vouch spike.
        .sort((a, b) => {
          const weight = (r: InvestigatedMover) =>
            Math.abs(r.scoreDelta ?? 0) * 50 +
            r.vouchesGiven * 20 +
            r.reviewsAuthored * 10 +
            r.xpGained / 1000;
          return weight(b) - weight(a);
        })
        .slice(0, INVESTIGATED_LIMIT);
    }
  }

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
    investigatedMovers,
  };
}

/**
 * Per-profile detail view: current rollup from profile_latest + recent
 * activity rows from profile_daily. Days without a row are absent — the
 * caller is responsible for rendering missing days as "no activity" rather
 * than trying to zero-fill (simpler, avoids fake data in sparklines).
 *
 * rangeDays = how far back to look. 1 = today only, 7 = past week, etc.
 * Capped at 365 so a malformed query can't ask for every row ever.
 */
export async function getProfileDetail(
  profileId: number,
  rangeDays = 30
): Promise<ProfileDetail> {
  const supabase = getSupabase();

  const clampedDays = Math.max(1, Math.min(365, Math.round(rangeDays)));
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - (clampedDays - 1));
  const sinceDate = since.toISOString().slice(0, 10);

  const [latestRes, dailyRes] = await Promise.all([
    supabase
      .from("profile_latest")
      .select(
        "profile_id, display_name, username, avatar_url, human_verified, score, xp_total, primary_address, last_seen"
      )
      .eq("profile_id", profileId)
      .maybeSingle(),
    supabase
      .from("profile_daily")
      .select(
        "snapshot_date, score_end, score_delta, xp_total_end, xp_delta, reviews_authored, vouches_given, vouches_received, invitations_sent, invitations_accepted, attestations_added, slashes_authored, xp_gained, xp_spent, xp_by_type, xp_tips"
      )
      .eq("profile_id", profileId)
      .gte("snapshot_date", sinceDate)
      .order("snapshot_date", { ascending: true }),
  ]);

  const latestRow = latestRes.data as
    | {
        profile_id: number;
        display_name: string | null;
        username: string | null;
        avatar_url: string | null;
        human_verified: boolean | null;
        score: number | null;
        xp_total: number | null;
        primary_address: string | null;
        last_seen: string | null;
      }
    | null;

  const profile = latestRow
    ? {
        profileId: latestRow.profile_id,
        displayName: latestRow.display_name,
        username: latestRow.username,
        avatarUrl: latestRow.avatar_url,
        humanVerified: Boolean(latestRow.human_verified),
        score: latestRow.score,
        xpTotal: latestRow.xp_total,
        primaryAddress: latestRow.primary_address,
        lastSeen: latestRow.last_seen,
      }
    : null;

  const days: ProfileDailyRow[] = ((dailyRes.data ?? []) as {
    snapshot_date: string;
    score_end: number | null;
    score_delta: number | null;
    xp_total_end: number | null;
    xp_delta: number | null;
    reviews_authored: number;
    vouches_given: number;
    vouches_received: number;
    invitations_sent: number;
    invitations_accepted: number;
    attestations_added: number;
    slashes_authored: number;
    xp_gained: number | string;
    xp_spent: number | string;
    xp_by_type: Record<string, number | string> | null;
    xp_tips: { sent?: Record<string, number | string>; received?: Record<string, number | string> } | null;
  }[]).map((r) => {
    const rawByType = r.xp_by_type ?? {};
    const xpByType: Record<string, number> = {};
    for (const [k, v] of Object.entries(rawByType)) xpByType[k] = Number(v);
    const rawTips = r.xp_tips ?? {};
    const tipSent: Record<string, number> = {};
    for (const [k, v] of Object.entries(rawTips.sent ?? {})) tipSent[k] = Number(v);
    const tipRecv: Record<string, number> = {};
    for (const [k, v] of Object.entries(rawTips.received ?? {})) tipRecv[k] = Number(v);
    return {
      snapshotDate: r.snapshot_date,
      scoreEnd: r.score_end,
      scoreDelta: r.score_delta,
      xpTotalEnd: r.xp_total_end,
      xpDelta: r.xp_delta,
      reviewsAuthored: Number(r.reviews_authored ?? 0),
      vouchesGiven: Number(r.vouches_given ?? 0),
      vouchesReceived: Number(r.vouches_received ?? 0),
      invitationsSent: Number(r.invitations_sent ?? 0),
      invitationsAccepted: Number(r.invitations_accepted ?? 0),
      attestationsAdded: Number(r.attestations_added ?? 0),
      slashesAuthored: Number(r.slashes_authored ?? 0),
      xpGained: Number(r.xp_gained ?? 0),
      xpSpent: Number(r.xp_spent ?? 0),
      xpByType,
      xpTips: { sent: tipSent, received: tipRecv },
    };
  });

  // Aggregate tips across all days, then resolve counterparty profile info
  // in one bulk lookup against profile_latest so the detail page can render
  // names/avatars without round-tripping per row.
  const tipTotals = new Map<number, { sent: number; received: number }>();
  for (const d of days) {
    for (const [id, pts] of Object.entries(d.xpTips.sent)) {
      const n = Number(id);
      const e = tipTotals.get(n) ?? { sent: 0, received: 0 };
      e.sent += pts;
      tipTotals.set(n, e);
    }
    for (const [id, pts] of Object.entries(d.xpTips.received)) {
      const n = Number(id);
      const e = tipTotals.get(n) ?? { sent: 0, received: 0 };
      e.received += pts;
      tipTotals.set(n, e);
    }
  }
  let tipCounterparties: XpTipCounterparty[] = [];
  if (tipTotals.size > 0) {
    const ids = [...tipTotals.keys()];
    const { data: latestRows } = await supabase
      .from("profile_latest")
      .select("profile_id, display_name, username, avatar_url, human_verified, score")
      .in("profile_id", ids);
    const latestById = new Map<
      number,
      {
        profile_id: number;
        display_name: string | null;
        username: string | null;
        avatar_url: string | null;
        human_verified: boolean | null;
        score: number | null;
      }
    >();
    for (const row of (latestRows ?? []) as Parameters<typeof latestById.set>[1][]) {
      latestById.set(row.profile_id, row);
    }
    tipCounterparties = [...tipTotals.entries()]
      .map(([id, totals]) => {
        const l = latestById.get(id);
        return {
          profileId: id,
          displayName: l?.display_name ?? null,
          username: l?.username ?? null,
          avatarUrl: l?.avatar_url ?? null,
          humanVerified: Boolean(l?.human_verified),
          score: l?.score ?? null,
          sent: totals.sent,
          received: totals.received,
        };
      })
      .sort(
        (a, b) => Math.abs(b.sent + b.received) - Math.abs(a.sent + a.received)
      );
  }

  return { profile, days, tipCounterparties };
}
