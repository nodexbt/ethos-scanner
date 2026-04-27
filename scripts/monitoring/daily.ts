// Load .env.local for local runs. In GitHub Actions the env is set by the
// workflow, so this is a silent no-op when the file doesn't exist.
try {
  process.loadEnvFile(".env.local");
} catch {
  // intentional: file missing in CI is expected
}

import { Client } from "pg";
import { createClient } from "@supabase/supabase-js";

interface EthosCurrent {
  profile_id: number;
  score: number | null;
  xp_total: number | null;
  human_verified: boolean;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
  primary_address: string | null;
}

interface ActivityCounts {
  reviews_authored: Map<number, number>;
  vouches_given: Map<number, { count: number; wei: string }>;
  vouches_received: Map<number, number>;
  invitations_sent: Map<number, number>;
  invitations_accepted: Map<number, number>;
  attestations_added: Map<number, number>;
  slashes_authored: Map<number, number>;
  xp: Map<number, { gained: number; spent: number }>;
  xp_by_type: Map<number, Record<string, number>>;
  xp_tips: Map<number, { sent: Record<string, number>; received: Record<string, number> }>;
  new_profiles_24h: number;
}

interface DailyRow {
  profile_id: number;
  snapshot_date: string;
  score_end: number | null;
  score_delta: number | null;
  xp_total_end: number | null;
  xp_delta: number | null;
  reviews_authored: number;
  vouches_given: number;
  vouch_given_wei: string;
  invitations_sent: number;
  invitations_accepted: number;
  vouches_received: number;
  attestations_added: number;
  slashes_authored: number;
  xp_gained: number;
  xp_spent: number;
  xp_by_type: Record<string, number>;
  xp_tips: { sent: Record<string, number>; received: Record<string, number> };
  human_verified: boolean;
}

const WINDOW_HOURS = 24;

function todayUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The Ethos read-only endpoint is a hot standby. Long-running queries can
 * be cancelled mid-flight with `40001: canceling statement due to conflict
 * with recovery` when replay catches up. Retrying with a small backoff
 * usually succeeds because the conflicting WAL segment has moved past.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function queryWithRetry<T extends Record<string, any>>(
  ethos: Client,
  sql: string,
  label: string,
  retries = 3
): Promise<{ rows: T[] }> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await ethos.query<T>(sql);
    } catch (err) {
      lastErr = err;
      const code = (err as { code?: string }).code;
      if (code !== "40001" || attempt === retries - 1) throw err;
      const backoffMs = 1500 * (attempt + 1);
      console.warn(`  [${label}] recovery conflict, retrying in ${backoffMs}ms (${attempt + 1}/${retries})`);
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  throw lastErr;
}

async function fetchEthosCurrent(ethos: Client): Promise<EthosCurrent[]> {
  const currentQuery = await queryWithRetry<{
    profile_id: number;
    score: number | null;
    xp_total: number | null;
    human_verification_status: string | null;
    display_name: string | null;
    username: string | null;
    avatar_url: string | null;
  }>(
    ethos,
    `select u.profile_id, u.score, u.xp_total, u.human_verification_status,
            u.display_name, u.username, u.avatar_url
     from users u
     join profiles p on p.id = u.profile_id
     where u.profile_id is not null
       and p.archived = false`,
    "current_state"
  );

  // Fetch one 0x address per profile so the dashboard can launch a sybil
  // scan without a live Ethos-DB round-trip. Correlated subquery is an
  // index seek per profile on userkeys(user_id), which is consistently
  // fast even against the 26M-row userkeys table.
  const addressQuery = await queryWithRetry<{ profile_id: number; primary_address: string | null }>(
    ethos,
    `select u.profile_id,
            (
              select regexp_replace(uk.userkey::text, '^address:', '')
              from userkeys uk
              where uk.user_id = u.id
                and uk.key_type = 'ADDRESS'
              order by uk.id
              limit 1
            ) as primary_address
     from users u
     join profiles p on p.id = u.profile_id
     where u.profile_id is not null
       and p.archived = false`,
    "primary_addresses"
  );
  const addresses = new Map<number, string | null>(
    addressQuery.rows.map((r) => [r.profile_id, r.primary_address])
  );

  return currentQuery.rows.map((r) => ({
    profile_id: r.profile_id,
    score: r.score,
    xp_total: r.xp_total,
    human_verified: r.human_verification_status === "VERIFIED",
    display_name: r.display_name,
    username: r.username,
    avatar_url: r.avatar_url,
    primary_address: addresses.get(r.profile_id) ?? null,
  }));
}

async function fetchActivity(ethos: Client): Promise<ActivityCounts> {
  // Serial, not Promise.all — a single pg client can only run one query at
  // a time. Parallelism here would just get serialized with a deprecation
  // warning; running sequentially is both simpler and cleaner.
  const reviews = await queryWithRetry<{ profile_id: number; n: string }>(
    ethos,
    `select "authorProfileId" as profile_id, count(*)::bigint as n
     from reviews
     where "createdAt" >= now() - interval '${WINDOW_HOURS} hours'
       and "authorProfileId" is not null
       and archived = false
     group by "authorProfileId"`,
    "reviews_authored"
  );
  const vouchesGiven = await queryWithRetry<{ profile_id: number; n: string; wei: string }>(
    ethos,
    `select "authorProfileId" as profile_id,
            count(*)::bigint as n,
            coalesce(sum(deposited), 0)::text as wei
     from vouches
     where "vouchedAt" >= now() - interval '${WINDOW_HOURS} hours'
       and "authorProfileId" is not null
       and archived = false
     group by "authorProfileId"`,
    "vouches_given"
  );
  const vouchesReceived = await queryWithRetry<{ profile_id: number; n: string }>(
    ethos,
    `select "subjectProfileId" as profile_id, count(*)::bigint as n
     from vouches
     where "vouchedAt" >= now() - interval '${WINDOW_HOURS} hours'
       and "subjectProfileId" is not null
       and archived = false
     group by "subjectProfileId"`,
    "vouches_received"
  );
  const invitations = await queryWithRetry<{ profile_id: number; n: string }>(
    ethos,
    `select "senderProfileId" as profile_id, count(*)::bigint as n
     from invitations
     where "sentAt" >= now() - interval '${WINDOW_HOURS} hours'
       and "senderProfileId" is not null
     group by "senderProfileId"`,
    "invitations_sent"
  );
  const invitationsAccepted = await queryWithRetry<{ profile_id: number; n: string }>(
    ethos,
    `select "senderProfileId" as profile_id, count(*)::bigint as n
     from invitations
     where "acceptedAt" >= now() - interval '${WINDOW_HOURS} hours'
       and "senderProfileId" is not null
     group by "senderProfileId"`,
    "invitations_accepted"
  );
  const attestations = await queryWithRetry<{ profile_id: number; n: string }>(
    ethos,
    `select "profileId" as profile_id, count(*)::bigint as n
     from attestations
     where "createdAt" >= now() - interval '${WINDOW_HOURS} hours'
       and "profileId" is not null
       and archived = false
     group by "profileId"`,
    "attestations_added"
  );
  const slashesAuthored = await queryWithRetry<{ profile_id: number; n: string }>(
    ethos,
    `select "authorProfileId" as profile_id, count(*)::bigint as n
     from slashes
     where "createdAt" >= now() - interval '${WINDOW_HOURS} hours'
       and "authorProfileId" is not null
     group by "authorProfileId"`,
    "slashes_authored"
  );
  // XP events are keyed by userkey; only rows of the form 'profileId:N' are
  // attributable to a profile. Other userkey types (address, service) would
  // require a userkey→profileId join which hits standby recovery conflicts.
  const xp = await queryWithRetry<{ profile_id: number; gained: string; spent: string }>(
    ethos,
    `select (regexp_replace(userkey::text, '^profileId:', ''))::int as profile_id,
            sum(case when points > 0 then points else 0 end)::bigint as gained,
            sum(case when points < 0 then -points else 0 end)::bigint as spent
     from xp_points_history
     where "createdAt" >= now() - interval '${WINDOW_HOURS} hours'
       and userkey::text like 'profileId:%'
     group by 1`,
    "xp"
  );
  // XP grouped by (profile_id, type). Stored as a signed sum per type so
  // a cost type like VOTE_COST surfaces as negative in the breakdown.
  const xpByTypeQuery = await queryWithRetry<{
    profile_id: number;
    xp_type: string;
    points: string;
  }>(
    ethos,
    `select (regexp_replace(userkey::text, '^profileId:', ''))::int as profile_id,
            type::text as xp_type,
            sum(points)::bigint as points
     from xp_points_history
     where "createdAt" >= now() - interval '${WINDOW_HOURS} hours'
       and userkey::text like 'profileId:%'
     group by 1, 2`,
    "xp_by_type"
  );
  // XP tip flows — one row per (sender, receiver) pair. The sender side
  // carries the absolute amount as a positive number in "sent", the
  // receiver side carries it in "received". Both sides are keyed by
  // counterpartyProfileId, resolved from either the metadata field or
  // parsed from the sender's userkey depending on direction.
  const xpTipsQuery = await queryWithRetry<{
    profile_id: number;
    direction: "sent" | "received";
    counterparty_id: number;
    points: string;
  }>(
    ethos,
    `select profile_id, direction, counterparty_id, sum(points)::bigint as points
     from (
       select (regexp_replace(userkey::text, '^profileId:', ''))::int as profile_id,
              'sent'::text as direction,
              (regexp_replace(metadata->>'counterpartyUserkey', '^profileId:', ''))::int as counterparty_id,
              -points as points
       from xp_points_history
       where "createdAt" >= now() - interval '${WINDOW_HOURS} hours'
         and type::text = 'XP_TIP_SENT'
         and userkey::text like 'profileId:%'
         and metadata->>'counterpartyUserkey' like 'profileId:%'
       union all
       select (regexp_replace(userkey::text, '^profileId:', ''))::int as profile_id,
              'received'::text as direction,
              (metadata->>'counterpartyProfileId')::int as counterparty_id,
              points as points
       from xp_points_history
       where "createdAt" >= now() - interval '${WINDOW_HOURS} hours'
         and type::text = 'XP_TIP_RECEIVED'
         and userkey::text like 'profileId:%'
         and metadata->>'counterpartyProfileId' is not null
     ) t
     group by 1, 2, 3`,
    "xp_tips"
  );
  const newProfiles = await queryWithRetry<{ n: string }>(
    ethos,
    `select count(*)::bigint as n
     from profiles
     where "createdAt" >= now() - interval '${WINDOW_HOURS} hours'
       and archived = false`,
    "new_profiles"
  );

  return {
    reviews_authored: new Map(reviews.rows.map((r) => [r.profile_id, Number(r.n)])),
    vouches_given: new Map(
      vouchesGiven.rows.map((r) => [r.profile_id, { count: Number(r.n), wei: r.wei }])
    ),
    vouches_received: new Map(
      vouchesReceived.rows.map((r) => [r.profile_id, Number(r.n)])
    ),
    invitations_sent: new Map(
      invitations.rows.map((r) => [r.profile_id, Number(r.n)])
    ),
    invitations_accepted: new Map(
      invitationsAccepted.rows.map((r) => [r.profile_id, Number(r.n)])
    ),
    attestations_added: new Map(
      attestations.rows.map((r) => [r.profile_id, Number(r.n)])
    ),
    slashes_authored: new Map(
      slashesAuthored.rows.map((r) => [r.profile_id, Number(r.n)])
    ),
    xp: new Map(
      xp.rows.map((r) => [r.profile_id, { gained: Number(r.gained), spent: Number(r.spent) }])
    ),
    xp_by_type: (() => {
      const map = new Map<number, Record<string, number>>();
      for (const row of xpByTypeQuery.rows) {
        let entry = map.get(row.profile_id);
        if (!entry) {
          entry = {};
          map.set(row.profile_id, entry);
        }
        entry[row.xp_type] = Number(row.points);
      }
      return map;
    })(),
    xp_tips: (() => {
      const map = new Map<
        number,
        { sent: Record<string, number>; received: Record<string, number> }
      >();
      for (const row of xpTipsQuery.rows) {
        let entry = map.get(row.profile_id);
        if (!entry) {
          entry = { sent: {}, received: {} };
          map.set(row.profile_id, entry);
        }
        entry[row.direction][String(row.counterparty_id)] = Number(row.points);
      }
      return map;
    })(),
    new_profiles_24h: Number(newProfiles.rows[0]?.n ?? 0),
  };
}

function buildRows(
  current: EthosCurrent[],
  prior: Map<number, { last_score: number | null; last_xp_total: number | null }>,
  activity: ActivityCounts,
  today: string
): DailyRow[] {
  const out: DailyRow[] = [];
  for (const c of current) {
    const reviewsAuthored = activity.reviews_authored.get(c.profile_id) ?? 0;
    const vouchGiven = activity.vouches_given.get(c.profile_id);
    const vouchesGivenCount = vouchGiven?.count ?? 0;
    const vouchGivenWei = vouchGiven?.wei ?? "0";
    const vouchesReceived = activity.vouches_received.get(c.profile_id) ?? 0;
    const invitationsSent = activity.invitations_sent.get(c.profile_id) ?? 0;
    const invitationsAccepted = activity.invitations_accepted.get(c.profile_id) ?? 0;
    const attestationsAdded = activity.attestations_added.get(c.profile_id) ?? 0;
    const slashesAuthored = activity.slashes_authored.get(c.profile_id) ?? 0;
    const xp = activity.xp.get(c.profile_id);
    const xpGained = xp?.gained ?? 0;
    const xpSpent = xp?.spent ?? 0;
    const xpByType = activity.xp_by_type.get(c.profile_id) ?? {};
    const xpTips = activity.xp_tips.get(c.profile_id) ?? { sent: {}, received: {} };

    const priorState = prior.get(c.profile_id);
    const scoreDelta =
      priorState?.last_score != null && c.score != null
        ? c.score - priorState.last_score
        : null;
    const xpDelta =
      priorState?.last_xp_total != null && c.xp_total != null
        ? c.xp_total - priorState.last_xp_total
        : null;

    const interesting =
      (scoreDelta != null && scoreDelta !== 0) ||
      (xpDelta != null && xpDelta !== 0) ||
      reviewsAuthored > 0 ||
      vouchesGivenCount > 0 ||
      vouchesReceived > 0 ||
      invitationsSent > 0 ||
      invitationsAccepted > 0 ||
      attestationsAdded > 0 ||
      slashesAuthored > 0 ||
      xpGained > 0 ||
      xpSpent > 0;

    if (!interesting) continue;

    out.push({
      profile_id: c.profile_id,
      snapshot_date: today,
      score_end: c.score,
      score_delta: scoreDelta,
      xp_total_end: c.xp_total,
      xp_delta: xpDelta,
      reviews_authored: reviewsAuthored,
      vouches_given: vouchesGivenCount,
      vouch_given_wei: vouchGivenWei,
      invitations_sent: invitationsSent,
      invitations_accepted: invitationsAccepted,
      vouches_received: vouchesReceived,
      attestations_added: attestationsAdded,
      slashes_authored: slashesAuthored,
      xp_gained: xpGained,
      xp_spent: xpSpent,
      xp_by_type: xpByType,
      xp_tips: xpTips,
      human_verified: c.human_verified,
    });
  }
  return out;
}

// The @supabase/supabase-js generics require a generated Database type to be
// strongly typed; we don't have one here and typing each row shape locally is
// fine. Accept the client loosely to sidestep overload resolution.
async function upsertInBatches<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  table: string,
  rows: T[],
  onConflict: string,
  batch = 500
): Promise<void> {
  for (let i = 0; i < rows.length; i += batch) {
    const chunk = rows.slice(i, i + batch);
    const { error } = await supabase.from(table).upsert(chunk, { onConflict });
    if (error) throw new Error(`upsert ${table} failed: ${error.message}`);
  }
}

function profileLink(profile_id: number, display_name: string | null, username: string | null): string {
  const url = username
    ? `https://app.ethos.network/profile/x/${username}`
    : `https://app.ethos.network/profile/${profile_id}`;
  const name = display_name?.trim() || (username ? `@${username}` : `#${profile_id}`);
  const suffix = username && display_name ? ` (@${username})` : "";
  // Discord sanitizes markdown in link text so stray characters in display
  // names won't break the message, but we still strip brackets defensively.
  const safe = name.replace(/[\[\]]/g, "");
  return `[${safe}${suffix}](${url})`;
}

async function postDiscord(
  webhook: string,
  rows: DailyRow[],
  names: Map<number, { display_name: string | null; username: string | null }>,
  newProfiles24h: number,
  durationMs: number,
  today: string
): Promise<void> {
  const topScore = [...rows]
    .filter((r) => r.score_delta != null && r.score_delta > 0)
    .sort((a, b) => (b.score_delta ?? 0) - (a.score_delta ?? 0))
    .slice(0, 5);
  const topReviewers = [...rows]
    .filter((r) => r.reviews_authored > 5)
    .sort((a, b) => b.reviews_authored - a.reviews_authored)
    .slice(0, 10);
  const topVouchers = [...rows]
    .filter((r) => r.vouches_given > 3)
    .sort((a, b) => b.vouches_given - a.vouches_given)
    .slice(0, 10);
  const topInvitersAccepted = [...rows]
    .filter((r) => r.invitations_accepted > 3)
    .sort((a, b) => b.invitations_accepted - a.invitations_accepted)
    .slice(0, 10);
  const topAttestations = [...rows]
    .filter((r) => r.attestations_added > 2)
    .sort((a, b) => b.attestations_added - a.attestations_added)
    .slice(0, 10);
  const topXpGainers = [...rows]
    .filter((r) => r.xp_gained > 0)
    .sort((a, b) => b.xp_gained - a.xp_gained)
    .slice(0, 5);
  const slashers = [...rows]
    .filter((r) => r.slashes_authored > 0)
    .sort((a, b) => b.slashes_authored - a.slashes_authored)
    .slice(0, 10);

  const fmt = (r: DailyRow) => {
    const n = names.get(r.profile_id);
    return profileLink(r.profile_id, n?.display_name ?? null, n?.username ?? null);
  };
  const lines: string[] = [
    `**Ethos monitoring — ${today}**`,
    `${rows.length} profiles with activity or score changes · ${newProfiles24h} new profiles · ${Math.round(durationMs / 1000)}s`,
  ];
  if (topScore.length) {
    lines.push("");
    lines.push("**Top score gainers (24h):**");
    for (const r of topScore) {
      const start =
        r.score_end != null && r.score_delta != null ? r.score_end - r.score_delta : null;
      lines.push(`- ${fmt(r)} ${start ?? "?"} → ${r.score_end} (+${r.score_delta})`);
    }
  }
  if (topXpGainers.length) {
    lines.push("");
    lines.push("**Top XP gainers (24h):**");
    for (const r of topXpGainers) {
      lines.push(`- ${fmt(r)} +${r.xp_gained.toLocaleString()} xp (spent ${r.xp_spent.toLocaleString()})`);
    }
  }
  if (topReviewers.length) {
    lines.push("");
    lines.push(`**Review-authoring spikes (>5/day):** ${topReviewers.length}`);
    for (const r of topReviewers) lines.push(`- ${fmt(r)}: ${r.reviews_authored} reviews`);
  }
  if (topVouchers.length) {
    lines.push("");
    lines.push(`**Vouch-giving spikes (>3/day):** ${topVouchers.length}`);
    for (const r of topVouchers) lines.push(`- ${fmt(r)}: ${r.vouches_given} vouches`);
  }
  if (topInvitersAccepted.length) {
    lines.push("");
    lines.push(`**Invitation-accepted spikes (>3/day):** ${topInvitersAccepted.length}`);
    for (const r of topInvitersAccepted) lines.push(`- ${fmt(r)}: ${r.invitations_accepted} accepted`);
  }
  if (topAttestations.length) {
    lines.push("");
    lines.push(`**New-attestation spikes (>2/day):** ${topAttestations.length}`);
    for (const r of topAttestations) lines.push(`- ${fmt(r)}: ${r.attestations_added} attestations added`);
  }
  if (slashers.length) {
    lines.push("");
    lines.push(`**Slashes authored (24h):** ${slashers.length}`);
    for (const r of slashers) lines.push(`- ${fmt(r)}: ${r.slashes_authored} slash(es)`);
  }

  const body = { content: lines.join("\n").slice(0, 1900) };
  const res = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error(`Discord webhook returned ${res.status}: ${await res.text()}`);
  }
}

async function main() {
  const ethosUrl = process.env.ETHOS_DB_URL;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  const webhook = process.env.DISCORD_WEBHOOK;
  if (!ethosUrl) throw new Error("ETHOS_DB_URL not set");
  if (!supabaseUrl || !supabaseKey) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY not set");

  const startedAt = Date.now();
  const supabase = createClient(supabaseUrl, supabaseKey);

  const { data: runRow, error: runErr } = await supabase
    .from("monitoring_runs")
    .insert({ status: "running" })
    .select("id")
    .single();
  if (runErr || !runRow) throw new Error(`monitoring_runs insert failed: ${runErr?.message}`);
  const runId = (runRow as { id: number }).id;

  const ethos = new Client({
    connectionString: ethosUrl,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await ethos.connect();

    console.log("Fetching current state from Ethos…");
    const current = await fetchEthosCurrent(ethos);
    console.log(`  ${current.length} active profiles`);

    console.log(`Fetching ${WINDOW_HOURS}h activity aggregates…`);
    const activity = await fetchActivity(ethos);
    console.log(
      `  reviews:${activity.reviews_authored.size} vouches-given:${activity.vouches_given.size} vouches-received:${activity.vouches_received.size} invites-sent:${activity.invitations_sent.size} invites-accepted:${activity.invitations_accepted.size} attestations:${activity.attestations_added.size} slashes:${activity.slashes_authored.size} xp:${activity.xp.size} new-profiles:${activity.new_profiles_24h}`
    );

    console.log("Loading prior state from profile_latest…");
    const prior = new Map<number, { last_score: number | null; last_xp_total: number | null }>();
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("profile_latest")
        .select("profile_id, score, xp_total")
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`profile_latest select failed: ${error.message}`);
      if (!data || data.length === 0) break;
      for (const row of data as { profile_id: number; score: number | null; xp_total: number | null }[]) {
        prior.set(row.profile_id, { last_score: row.score, last_xp_total: row.xp_total });
      }
      if (data.length < PAGE) break;
    }
    console.log(`  ${prior.size} prior rows`);

    const today = todayUtcDate();
    const rows = buildRows(current, prior, activity, today);
    console.log(`Writing ${rows.length} profile_daily rows…`);
    await upsertInBatches(supabase, "profile_daily", rows, "profile_id,snapshot_date");

    console.log(`Updating profile_latest for ${current.length} profiles…`);
    const nowIso = new Date().toISOString();
    const latestRows = current.map((c) => ({
      profile_id: c.profile_id,
      score: c.score,
      xp_total: c.xp_total,
      human_verified: c.human_verified,
      display_name: c.display_name,
      username: c.username,
      avatar_url: c.avatar_url,
      primary_address: c.primary_address,
      last_seen: nowIso,
    }));
    await upsertInBatches(supabase, "profile_latest", latestRows, "profile_id");

    console.log("Fetching all profile→address mappings from Ethos…");
    const allAddressesQuery = await queryWithRetry<{ profile_id: number; address: string }>(
      ethos,
      `select u.profile_id,
              regexp_replace(uk.userkey::text, '^address:', '') as address
       from users u
       join profiles p on p.id = u.profile_id
       join userkeys uk on uk.user_id = u.id
       where u.profile_id is not null
         and p.archived = false
         and uk.key_type = 'ADDRESS'`,
      "all_addresses"
    );
    const addressRows = allAddressesQuery.rows.map((r) => ({
      profile_id: r.profile_id,
      address: r.address.toLowerCase(),
    }));
    console.log(`  ${addressRows.length} (profile, address) pairs`);
    // onConflict ignoreDuplicates keeps prior rows alive across runs — we
    // accept a little drift (if a profile drops an address we still have
    // the stale mapping) in exchange for a simple, append-only upsert.
    for (let i = 0; i < addressRows.length; i += 500) {
      const chunk = addressRows.slice(i, i + 500);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("profile_addresses")
        .upsert(chunk, { onConflict: "profile_id,address", ignoreDuplicates: true });
      if (error) throw new Error(`profile_addresses upsert failed: ${error.message}`);
    }

    console.log("Fetching all profile→service-key mappings from Ethos…");
    // Userkey format is `service:{service}:{account}` (e.g.
    // service:x.com:1399208047101292544). Split into two columns so reviews
    // can be resolved by (service, account) without storing the prefix.
    const allServiceKeysQuery = await queryWithRetry<{
      profile_id: number;
      service: string;
      account: string;
    }>(
      ethos,
      `select u.profile_id,
              (regexp_match(uk.userkey::text, '^service:([^:]+):(.+)$'))[1] as service,
              (regexp_match(uk.userkey::text, '^service:([^:]+):(.+)$'))[2] as account
       from users u
       join profiles p on p.id = u.profile_id
       join userkeys uk on uk.user_id = u.id
       where u.profile_id is not null
         and p.archived = false
         and uk.key_type::text in ('TWITTER','DISCORD','FARCASTER','TELEGRAM','GITHUB')`,
      "all_service_keys"
    );
    const serviceKeyRows = allServiceKeysQuery.rows
      .filter((r) => r.service && r.account)
      .map((r) => ({
        profile_id: r.profile_id,
        service: r.service,
        account: r.account,
      }));
    console.log(`  ${serviceKeyRows.length} (profile, service, account) pairs`);
    for (let i = 0; i < serviceKeyRows.length; i += 500) {
      const chunk = serviceKeyRows.slice(i, i + 500);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("profile_service_keys")
        .upsert(chunk, {
          onConflict: "profile_id,service,account",
          ignoreDuplicates: true,
        });
      if (error) throw new Error(`profile_service_keys upsert failed: ${error.message}`);
    }

    console.log("Computing reviews_received via local lookups…");
    const recentReviewsQuery = await queryWithRetry<{
      subject: string | null;
      service: string | null;
      account: string | null;
    }>(
      ethos,
      `select subject, service, account
       from reviews
       where "createdAt" >= now() - interval '${WINDOW_HOURS} hours'
         and archived = false`,
      "recent_reviews"
    );
    // Resolve each review's subject locally.
    const recentReviews = recentReviewsQuery.rows;
    const distinctAddresses = new Set<string>();
    const distinctServiceKeys = new Set<string>(); // "service|account"
    for (const r of recentReviews) {
      if (r.service && r.account) {
        distinctServiceKeys.add(`${r.service}|${r.account}`);
      } else if (r.subject) {
        distinctAddresses.add(r.subject.toLowerCase());
      }
    }
    const addressToProfile = new Map<string, number>();
    if (distinctAddresses.size > 0) {
      const { data: addrMatches } = await supabase
        .from("profile_addresses")
        .select("profile_id, address")
        .in("address", [...distinctAddresses]);
      for (const m of (addrMatches ?? []) as { profile_id: number; address: string }[]) {
        if (!addressToProfile.has(m.address)) addressToProfile.set(m.address, m.profile_id);
      }
    }
    const serviceKeyToProfile = new Map<string, number>();
    if (distinctServiceKeys.size > 0) {
      // Supabase lacks a clean way to do compound IN — fetch all matching
      // services then filter client-side. Service set is small (~5 services).
      const services = [...new Set([...distinctServiceKeys].map((k) => k.split("|")[0]))];
      const accounts = [...new Set([...distinctServiceKeys].map((k) => k.split("|")[1]))];
      const { data: skMatches } = await supabase
        .from("profile_service_keys")
        .select("profile_id, service, account")
        .in("service", services)
        .in("account", accounts);
      for (const m of (skMatches ?? []) as {
        profile_id: number;
        service: string;
        account: string;
      }[]) {
        const key = `${m.service}|${m.account}`;
        if (distinctServiceKeys.has(key) && !serviceKeyToProfile.has(key)) {
          serviceKeyToProfile.set(key, m.profile_id);
        }
      }
    }
    const reviewsReceivedByProfile = new Map<number, number>();
    let resolvedCount = 0;
    for (const r of recentReviews) {
      let profileId: number | undefined;
      if (r.service && r.account) {
        profileId = serviceKeyToProfile.get(`${r.service}|${r.account}`);
      } else if (r.subject) {
        profileId = addressToProfile.get(r.subject.toLowerCase());
      }
      if (profileId != null) {
        reviewsReceivedByProfile.set(profileId, (reviewsReceivedByProfile.get(profileId) ?? 0) + 1);
        resolvedCount++;
      }
    }
    console.log(
      `  resolved ${resolvedCount}/${recentReviews.length} reviews to ${reviewsReceivedByProfile.size} profiles`
    );
    if (reviewsReceivedByProfile.size > 0) {
      // Update existing profile_daily rows for today with the received counts.
      // Some recipient profiles may not have a profile_daily row yet (e.g.
      // they had no other activity); insert a minimal row for those so the
      // count surfaces in queries.
      const today = todayUtcDate();
      const updates: { profile_id: number; snapshot_date: string; reviews_received: number }[] = [];
      for (const [profileId, count] of reviewsReceivedByProfile) {
        updates.push({ profile_id: profileId, snapshot_date: today, reviews_received: count });
      }
      for (let i = 0; i < updates.length; i += 500) {
        const chunk = updates.slice(i, i + 500);
        const { error } = await supabase
          .from("profile_daily")
          .upsert(chunk, { onConflict: "profile_id,snapshot_date" });
        if (error) throw new Error(`profile_daily reviews_received upsert: ${error.message}`);
      }
    }

    const durationMs = Date.now() - startedAt;
    await supabase
      .from("monitoring_runs")
      .update({
        status: "success",
        finished_at: new Date().toISOString(),
        rows_written: rows.length,
        duration_ms: durationMs,
      })
      .eq("id", runId);

    if (webhook) {
      const names = new Map(
        current.map((c) => [c.profile_id, { display_name: c.display_name, username: c.username }])
      );
      await postDiscord(webhook, rows, names, activity.new_profiles_24h, durationMs, today);
    }

    console.log(`Done in ${Math.round(durationMs / 1000)}s.`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Monitoring run failed:", msg);
    await supabase
      .from("monitoring_runs")
      .update({
        status: "error",
        finished_at: new Date().toISOString(),
        error_message: msg,
        duration_ms: Date.now() - startedAt,
      })
      .eq("id", runId);
    if (webhook) {
      await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: `**Ethos monitoring FAILED**: ${msg.slice(0, 1800)}` }),
      }).catch(() => {});
    }
    process.exitCode = 1;
  } finally {
    await ethos.end().catch(() => {});
  }
}

main();
