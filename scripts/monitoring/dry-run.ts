// Read-only sanity check: runs the exact queries daily.ts will use against
// the Ethos DB, but writes nothing. Lets us validate column names / quoting
// before enabling the real cron. Delete once the pipeline is stable.

import { Client } from "pg";

const WINDOW_HOURS = 24;

async function main() {
  const url = process.env.ETHOS_DB_URL;
  if (!url) throw new Error("ETHOS_DB_URL not set");
  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();

  console.log("--- current state sample (top 5 by score) ---");
  const current = await client.query(
    `select u.profile_id, u.score, u.xp_total, u.human_verification_status
     from users u
     join profiles p on p.id = u.profile_id
     where u.profile_id is not null
       and p.archived = false
     order by u.score desc nulls last
     limit 5`
  );
  console.table(current.rows);

  console.log("\n--- reviews authored in last 24h (top 10) ---");
  const reviews = await client.query(
    `select "authorProfileId" as profile_id, count(*)::bigint as n
     from reviews
     where "createdAt" >= now() - interval '${WINDOW_HOURS} hours'
       and "authorProfileId" is not null
       and archived = false
     group by "authorProfileId"
     order by n desc
     limit 10`
  );
  console.table(reviews.rows);

  console.log("\n--- vouches given in last 24h (top 10) ---");
  const vouchesGiven = await client.query(
    `select "authorProfileId" as profile_id,
            count(*)::bigint as n,
            coalesce(sum(deposited), 0)::text as wei
     from vouches
     where "vouchedAt" >= now() - interval '${WINDOW_HOURS} hours'
       and "authorProfileId" is not null
       and archived = false
     group by "authorProfileId"
     order by n desc
     limit 10`
  );
  console.table(vouchesGiven.rows);

  console.log("\n--- vouches received in last 24h (top 10) ---");
  const vouchesRecv = await client.query(
    `select "subjectProfileId" as profile_id, count(*)::bigint as n
     from vouches
     where "vouchedAt" >= now() - interval '${WINDOW_HOURS} hours'
       and "subjectProfileId" is not null
       and archived = false
     group by "subjectProfileId"
     order by n desc
     limit 10`
  );
  console.table(vouchesRecv.rows);

  console.log("\n--- invitations sent in last 24h (top 10) ---");
  const invites = await client.query(
    `select "senderProfileId" as profile_id, count(*)::bigint as n
     from invitations
     where "sentAt" >= now() - interval '${WINDOW_HOURS} hours'
       and "senderProfileId" is not null
     group by "senderProfileId"
     order by n desc
     limit 10`
  );
  console.table(invites.rows);

  console.log("\n--- total active profiles ---");
  const total = await client.query(
    `select count(*) as n
     from users u
     join profiles p on p.id = u.profile_id
     where u.profile_id is not null
       and p.archived = false`
  );
  console.log(total.rows[0]);

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
