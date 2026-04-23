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
    "profiles",
    "users",
    "reviews",
    "review_events",
    "vouches",
    "vouch_events",
    "invitations",
    "score_history",
    "xp_points_history",
    "human_verifications",
    "userkeys",
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

  console.log("\n=== Row count estimates ===");
  for (const t of focus) {
    const est = await client.query(
      `SELECT reltuples::bigint AS est_rows FROM pg_class WHERE oid = to_regclass($1)`,
      [`public.${t}`]
    );
    console.log(`  ${t}: ~${est.rows[0]?.est_rows ?? "?"}`);
  }

  console.log("\n=== Sample rows ===");
  for (const t of ["score_history", "xp_points_history", "review_events", "vouch_events"]) {
    try {
      const sample = await client.query(`SELECT * FROM "${t}" ORDER BY 1 DESC LIMIT 1`);
      if (sample.rows[0]) {
        console.log(`\n-- ${t} (1 row)`);
        for (const [k, v] of Object.entries(sample.rows[0])) {
          const s = v === null ? "null" : typeof v === "object" ? JSON.stringify(v).slice(0, 120) : String(v).slice(0, 120);
          console.log(`  ${k}: ${s}`);
        }
      }
    } catch (err) {
      console.log(`\n-- ${t}: ${(err as Error).message}`);
    }
  }

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
