import { Client } from "pg";
import { createClient } from "@supabase/supabase-js";

interface EthosCurrent {
  profile_id: number;
  score: number | null;
  xp_total: number | null;
  human_verified: boolean;
}

interface ActivityCounts {
  reviews_authored: Map<number, number>;
  vouches_given: Map<number, { count: number; wei: string }>;
  vouches_received: Map<number, number>;
  invitations_sent: Map<number, number>;
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
  vouches_received: number;
  human_verified: boolean;
}

const WINDOW_HOURS = 24;

function todayUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

async function fetchEthosCurrent(ethos: Client): Promise<EthosCurrent[]> {
  const { rows } = await ethos.query<{
    profile_id: number;
    score: number | null;
    xp_total: number | null;
    human_verification_status: string | null;
  }>(
    `select u.profile_id, u.score, u.xp_total, u.human_verification_status
     from users u
     join profiles p on p.id = u.profile_id
     where u.profile_id is not null
       and p.archived = false`
  );
  return rows.map((r) => ({
    profile_id: r.profile_id,
    score: r.score,
    xp_total: r.xp_total,
    human_verified: r.human_verification_status === "VERIFIED",
  }));
}

async function fetchActivity(ethos: Client): Promise<ActivityCounts> {
  // Serial, not Promise.all — a single pg client can only run one query at
  // a time. Parallelism here would just get serialized with a deprecation
  // warning; running sequentially is both simpler and cleaner.
  const reviews = await ethos.query<{ profile_id: number; n: string }>(
    `select "authorProfileId" as profile_id, count(*)::bigint as n
     from reviews
     where "createdAt" >= now() - interval '${WINDOW_HOURS} hours'
       and "authorProfileId" is not null
       and archived = false
     group by "authorProfileId"`
  );
  const vouchesGiven = await ethos.query<{ profile_id: number; n: string; wei: string }>(
    `select "authorProfileId" as profile_id,
            count(*)::bigint as n,
            coalesce(sum(deposited), 0)::text as wei
     from vouches
     where "vouchedAt" >= now() - interval '${WINDOW_HOURS} hours'
       and "authorProfileId" is not null
       and archived = false
     group by "authorProfileId"`
  );
  const vouchesReceived = await ethos.query<{ profile_id: number; n: string }>(
    `select "subjectProfileId" as profile_id, count(*)::bigint as n
     from vouches
     where "vouchedAt" >= now() - interval '${WINDOW_HOURS} hours'
       and "subjectProfileId" is not null
       and archived = false
     group by "subjectProfileId"`
  );
  const invitations = await ethos.query<{ profile_id: number; n: string }>(
    `select "senderProfileId" as profile_id, count(*)::bigint as n
     from invitations
     where "sentAt" >= now() - interval '${WINDOW_HOURS} hours'
       and "senderProfileId" is not null
     group by "senderProfileId"`
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
      invitationsSent > 0;

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
      vouches_received: vouchesReceived,
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

async function postDiscord(
  webhook: string,
  rows: DailyRow[],
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

  const fmt = (r: DailyRow) => `\`#${r.profile_id}\``;
  const lines: string[] = [
    `**Ethos monitoring — ${today}**`,
    `${rows.length} active profile-days written in ${Math.round(durationMs / 1000)}s`,
  ];
  if (topScore.length) {
    lines.push("");
    lines.push("**Top score gainers (24h):**");
    for (const r of topScore) {
      lines.push(`- ${fmt(r)} +${r.score_delta} → ${r.score_end}`);
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
      `  reviews:${activity.reviews_authored.size} vouches-given:${activity.vouches_given.size} vouches-received:${activity.vouches_received.size} invites:${activity.invitations_sent.size}`
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
      last_seen: nowIso,
    }));
    await upsertInBatches(supabase, "profile_latest", latestRows, "profile_id");

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
      await postDiscord(webhook, rows, durationMs, today);
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
