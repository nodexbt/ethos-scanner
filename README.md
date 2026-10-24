# Ethos Scanner

On-chain sybil detection for the [Ethos Network](https://ethos.network) reputation protocol. Paste a profile, get the wallets and profiles that share its funding history across five EVM chains, with the evidence for every link.

**Live:** [ethos.tools](https://ethos.tools) · **App:** [app.ethos.tools/scanner](https://app.ethos.tools/scanner) · **Login-free example:** [a public profile summary](https://app.ethos.tools/p/nodexbt)

<img width="1828" alt="Cluster overview: network stats, flagged profiles and the evidence behind each link" src="https://github.com/user-attachments/assets/2df0f2a3-c250-4a3f-b244-a6178b8997d0" />

## Why

Ethos reputation has real value: vouches, reviews and invitations unlock gated communities and airdrops. So people farm it with wallets they control. Those wallets almost always share on-chain history: the same first funder, transfers between each other, deposits to the same exchange account. The chain is public and unforgeable, so the cluster is findable if you look hard enough. This tool looks hard, and hands an investigator the evidence rather than a verdict.

## What a scan does

1. Resolves the target to an Ethos profile and every personal wallet attested to it.
2. Pulls the full transfer history of those wallets on Ethereum, Base, Arbitrum, Optimism and Polygon, in parallel.
3. Ranks counterparties, fetches their history too, and runs correlation tests: shared first funders, multi-hop funding chains, shared exchange-deposit addresses.
4. Maps every linked wallet back to an Ethos profile and adds the social context (invitations, mutual vouches and reviews).
5. Scores each profile's **link strength**, buckets it into strong or possible, and saves the result with the evidence that produced it.

Partial results are marked degraded and never overwrite a complete scan. Every cap that limits coverage is written into the result.

## Stack

Next.js 16 · React 19 · TypeScript · Tailwind 4 + shadcn · Supabase (Postgres) · Alchemy · NextAuth (X OAuth) · Vitest · GitHub Actions · Vercel

## Where to look

| If you want to see | Go to |
| --- | --- |
| The detection pipeline and scoring | [`lib/cluster-scanner.ts`](lib/cluster-scanner.ts), explained in [docs/scoring.md](docs/scoring.md) |
| Failure-safe wallet classification (EIP-7702 handling) | [`lib/wallet-classify.ts`](lib/wallet-classify.ts) with [`tests/wallet-classify.test.ts`](tests/wallet-classify.test.ts) |
| Background jobs with server-side saves | [`app/api/scan/route.ts`](app/api/scan/route.ts), [`lib/scan-runner.ts`](lib/scan-runner.ts), [`lib/db/scan-jobs.ts`](lib/db/scan-jobs.ts) |
| Persistence rules (degraded guard, edge graph diff) | [`lib/db/investigations.ts`](lib/db/investigations.ts) with [`tests/degraded-guard.test.ts`](tests/degraded-guard.test.ts) |
| Why things are the way they are | [docs/decisions.md](docs/decisions.md) |
| How it fits together | [docs/architecture.md](docs/architecture.md) |

## Run it locally

```bash
git clone https://github.com/nodexbt/ethos-scanner && cd ethos-scanner
npm install
cp .env.example .env.local   # Alchemy, Supabase, X OAuth keys
npm run dev
```

Database setup and the sign-in requirements are in [docs/setup.md](docs/setup.md). `npm test` runs the unit tests; CI runs typecheck, lint and tests on every push.

## Limitations

- **Only on-chain-linked coordination is visible.** Independently funded wallets with separate exchange accounts and no transfers between them stay invisible. Behavioural analysis (posting times, bio similarity, follower graphs) is a different tool.
- **Single target.** One profile in, one cluster out. The Network tab aggregates saved scans, but there is no "find every sybil on Ethos" mode.
- **Heuristic.** Every signal has false positives. Confidence tiers describe the strength of the evidence, not certainty of guilt, and the UI says so on every result.
- **Bounded history.** Transfers are paged oldest-first with per-wallet caps. Very high-volume wallets lose their newest activity; when that happens the result carries a coverage note.

## Status

Built for the Ethos team's investigations and opened to Ethos users who are human-verified with a score of 1800 or more.

I designed and own this project: the detection approach, the scoring model, the architecture and the trade-offs in [docs/decisions.md](docs/decisions.md). I build with Claude Code as a pair programmer, so much of the implementation was generated to my specification and then reviewed, tested against production data and refined through the problems that only showed up in real scans.

## License

Not yet licensed for reuse. Reading and running it for evaluation is fine; ask before deploying your own copy.
