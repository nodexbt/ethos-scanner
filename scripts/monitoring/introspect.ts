import { Client } from "pg";

async function main() {
  const url = process.env.ETHOS_DB_URL;
  if (!url) throw new Error("ETHOS_DB_URL not set");

  const client = new Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const focus = [
    "slashes",
    "slash_events",
    "attestations",
    "xp_points_history",
    "userkeys",
    "invitations",
  ];

  console.log("=== Columns ===");
  const cols = await client.query(
    `SELECT table_name, column_name, data_type
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = ANY($1::text[])
     ORDER BY table_name, ordinal_position`,
    [focus]
  );
  let currentTable = "";
  for (const row of cols.rows) {
    if (row.table_name !== currentTable) {
      currentTable = row.table_name;
      console.log(`\n-- ${currentTable}`);
    }
    console.log(`  ${row.column_name}: ${row.data_type}`);
  }

  console.log("\n=== Sample rows ===");
  for (const t of ["slashes", "slash_events", "attestations", "xp_points_history"]) {
    try {
      const sample = await client.query(`SELECT * FROM "${t}" ORDER BY 1 DESC LIMIT 1`);
      if (sample.rows[0]) {
        console.log(`\n-- ${t}`);
        for (const [k, v] of Object.entries(sample.rows[0])) {
          const s = v === null ? "null" : typeof v === "object" ? JSON.stringify(v).slice(0, 120) : String(v).slice(0, 120);
          console.log(`  ${k}: ${s}`);
        }
      }
    } catch (err) {
      console.log(`\n-- ${t}: ${(err as Error).message}`);
    }
  }

  console.log("\n=== xp_points_history.type values (last 7d) ===");
  const types = await client.query(
    `SELECT type::text, count(*)::bigint as n
     FROM xp_points_history
     WHERE "createdAt" >= now() - interval '7 days'
     GROUP BY 1 ORDER BY n DESC LIMIT 20`
  );
  console.table(types.rows);

  console.log("\n=== userkey join sanity: recent reviews resolvable to profile_id ===");
  const resolve = await client.query(
    `SELECT count(*) filter (where u.profile_id is not null) as resolved,
            count(*) as total
     FROM reviews r
     LEFT JOIN userkeys uk ON uk.userkey::text = r.subject::text
     LEFT JOIN users u ON u.id = uk.user_id
     WHERE r."createdAt" >= now() - interval '24 hours'`
  );
  console.log(resolve.rows[0]);

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
