# Running it locally

You need accounts at Alchemy, Supabase and the X developer portal. All three have free tiers that are enough for development.

## 1. Install

```bash
git clone https://github.com/nodexbt/ethos-scanner
cd ethos-scanner
npm install
cp .env.example .env.local
```

Fill in `.env.local`. Every variable is explained in [`.env.example`](../.env.example).

## 2. Database

Create a Supabase project, open the SQL editor and run every file in [`scripts/migrations/`](../scripts/migrations) in name order, starting with `0000-base-schema.sql`. They are idempotent.

Then mirror the Ethos profiles the scanner maps wallets against:

```bash
npx tsx scripts/sync/profile-mirror.ts            # ~41k profiles, a few minutes
npx tsx scripts/backfill/classify-wallets.ts      # marks smart-contract wallets
```

Both scripts read `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` and (the second) `ALCHEMY_API_KEY` from `.env.local`. In production a [GitHub Actions workflow](../.github/workflows/profile-mirror.yml) runs them daily.

## 3. Sign-in

Create an X OAuth 2.0 app with the callback `http://localhost:3000/api/auth/callback/twitter`. Sign-in only succeeds for an X account that is attested to an Ethos profile, and that profile must pass the access bar in [`lib/access.ts`](../lib/access.ts) or be listed in `ETHOS_PROFILE_ALLOWLIST`. Put your own profile id in `ETHOS_ADMIN_PROFILE_IDS` to get the admin panel and unlimited scans.

## 4. Run

```bash
npm run dev          # http://localhost:3000
npm test             # vitest
npm run typecheck
npm run lint
```

## Notes

- The Alchemy free tier is rate-limited to 300 compute units per second. A heavy profile scans fine but slowly; expect retries in the scan log.
- A scan runs inside one serverless function invocation, so Vercel's function duration limit for your plan is the ceiling on a single scan. Heavy profiles take about two minutes.
- `NEXT_PUBLIC_TWITTER_SEARCH_ENABLED` and `TWITTERAPI_IO_KEY` are for the optional X evidence search and can stay unset.
