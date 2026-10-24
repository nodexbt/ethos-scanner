# Architecture

## Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Framework | Next.js 16 (App Router), React 19 | One deployable for UI and API; `after()` runs scan jobs past the response; server-rendered public pages |
| Auth | NextAuth, X (Twitter) OAuth 2.0 | Every Ethos profile is attested to an X account, so an X login maps to exactly one Ethos profile id |
| Database | Supabase (Postgres) via the service key, server-side only | Scans, edge graph, profile mirror, quotas, jobs, watchlists, notifications |
| On-chain data | Alchemy `alchemy_getAssetTransfers` and `eth_getCode` | Multi-chain transfer indexing without running nodes; one key for all five chains |
| Reputation data | [Ethos Network API](https://developers.ethos.network) | Bulk profile lookup, invitation tree, reviews and vouches |
| UI | Tailwind 4, shadcn primitives (Radix Select, Dialog, Tooltip), Framer Motion, Three.js background | Monochrome terminal look with accessible primitives underneath |
| Tests / CI | Vitest, GitHub Actions (typecheck, lint, tests on every push) | Scoring and persistence rules are unit-tested without touching Alchemy or Supabase |
| Hosting | Vercel, plus a daily GitHub Actions workflow for the profile mirror | |

## Request flow for a scan

```text
Browser                       Next.js                         External
───────                       ───────                         ────────
POST /api/scan  ─────────────▶ auth + quota + "one active job per user"
   X-Scan-Mode: job            create scan_jobs row
◀── 202 { jobId } ────────────
                               after(): runScanJob()
                                 ├─ runClusterScan() ─────────▶ Alchemy (5 chains, parallel)
                                 │                     ────────▶ Ethos API (profiles, social graph)
                                 │                     ────────▶ Supabase (profile mirror, contract flags)
                                 ├─ flush logs/progress every 1 s
                                 └─ saveInvestigation() + edge diff + notifications
GET /api/scan/jobs/:id ──────▶ poll every 1.5 s, with retries
◀── { status, logs, progress, result, saved }
```

The server owns the result. The client never submits scan output; it only polls, renders, and later attaches X evidence. That is what makes the daily quota, the edge graph and the public profile pages trustworthy.

If a client does not send `X-Scan-Mode: job`, the same endpoint streams newline-delimited JSON instead (the original design, kept as a fallback for stale tabs).

## Scan pipeline

```text
1. Resolve target        @handle / profile URL / 0x… → Ethos profile + every attested EOA
                         (smart-contract wallets are skipped, see docs/decisions.md)
2. Target history        all transfer categories, up to 50 pages per direction per chain
3. Counterparties        rank by strength, keep the top 200 per chain, note the cap if it bites
4. Candidate history     15 pages / 15k transfers per direction, concurrency 8
5. Correlation tests     first funders, shared funders, multi-hop funding chains,
                         shared exchange-deposit addresses
6. Ethos enrichment      bulk profile lookup (500 per request), invitation tree, mutual
                         reviews and vouches
7. Score + bucket        link strength → high / medium, merged per Ethos profile across chains
8. Persist               investigations row, investigation_edges diff, notifications for watchers
```

Every chain runs in parallel. Each stage reports progress against a rolling-average baseline of the last 20 scan durations, so the progress bar moves at real-time pace.

Scoring weights and tiers are documented in [scoring.md](scoring.md).

## Data model

| Table | What it holds |
| --- | --- |
| `investigations` | One row per scanned profile; `cluster_result` is the full serialized result. `strong_count` and `possible_count` are generated columns so lists can sort without parsing JSON |
| `investigation_edges` | One row per (source profile, candidate profile) link with confidence and score. Rewritten on every complete save; powers the Network tab and the "seen in other scans" lookups |
| `profile_latest`, `profile_addresses` | Read-only mirror of every Ethos profile and its attested wallets, refreshed daily. `is_contract` marks smart-contract wallets |
| `scan_jobs` | Background job state: status, logs, progress, result, heartbeat. Jobs with no heartbeat for 6 minutes are marked stale |
| `scan_quota` | Daily scan counter per user, incremented atomically by a Postgres function |
| `watchlist`, `notifications` | In-app alerts when a watched profile gains a new link |
| `allowed_users`, `allowed_users_audit` | Manual access overrides with an audit trail |
| `monitoring_runs` | One row per profile-mirror run |

The schema is in [`scripts/migrations/`](../scripts/migrations), applied in name order.

## Repository map

```text
app/
  page.tsx                 landing page (ethos.tools)
  scanner/                 Scanner / Scans / Network tabs (/scanner, client)
  sign-in/                 X sign-in card; NextAuth sends its errors here
  api/scan/                POST starts a scan; jobs/ polls it; quota/
  api/investigations/      list scans, attach X evidence
  api/network, watchlist, notifications, share, admin/
  p/[handle]/              public, summary-only profile page (server-rendered)
  s/[shareId]/             shared full result
  scan/[address], scan/x/  deep links that open the scanner on a target
lib/
  cluster-scanner.ts       the pipeline: discovery, correlation, scoring (~1.7k lines)
  alchemy.ts               transfer paging, retries, compute-unit accounting
  wallet-classify.ts       EOA vs contract vs EIP-7702, failure-safe
  scan-runner.ts           executeScan / runScanJob: run, serialize, save
  ethos.ts                 Ethos API client
  known-addresses.ts       exchange and faucet labels
  access.ts, auth.ts       who may sign in and call the API
  db/                      one module per table
components/
  results/                 overview, candidate cards and modal, degraded banner
  scans/, network/, ui/    lists, network view, shadcn-based primitives
scripts/
  migrations/              SQL, applied by hand in the Supabase editor
  sync/profile-mirror.ts   daily Ethos → Supabase mirror (GitHub Actions)
  backfill/                one-off and scheduled maintenance scripts
tests/                     Vitest: scoring, wallet classification, persistence guards
```

## Hosts

One Vercel deployment serves everything from `ethos.tools`: the landing page at `/`, each tool under its own path (`/scanner` today). Sessions, the X OAuth callback and `NEXTAUTH_URL` all live on this host.

Signed-out visitors to any tool route are sent to `/sign-in?callbackUrl=<where they were>` and return there after X. The public profile pages (`/p/<handle>`) and shared results (`/s/<id>`) need no session.

## Operational limits

| Limit | Value | Where |
| --- | --- | --- |
| Daily scans per user | 25 (admins unlimited) | `lib/db/scan-quota.ts` |
| Active jobs per user | 1 | `app/api/scan/route.ts` |
| Target history per chain | 50 pages × 1,000 transfers per direction | `lib/alchemy.ts` |
| Candidate history per chain | 15 pages or 15,000 transfers per direction | `lib/cluster-scanner.ts` |
| Counterparties scanned per chain | top 200 by strength | `lib/cluster-scanner.ts` |
| Alchemy cost | ~7k–20k compute units for a quiet profile, ~235k (about $0.12 pay-as-you-go) for a very active one | recorded per scan in `usage` |
| Job staleness | 6 minutes without a heartbeat | `lib/db/scan-jobs.ts` |

The Alchemy free tier (300 CU/s) throttles heavy scans; production should run on pay-as-you-go. Vercel's function duration limit bounds a single scan; check the maximum for your plan before enabling heavy profiles.
