# Ethos Scanner

An internal investigation tool for the [Ethos Network](https://ethos.network) team that detects coordinated reputation abuse — sybil clusters, vouch farms, and review-for-review schemes — by correlating on-chain transaction patterns across five EVM chains with Ethos's social graph.

**Live (allowlist-gated):** [ethos-scanner.vercel.app](https://ethos-scanner.vercel.app)

---

## TL;DR

You paste an Ethos profile or wallet address. Ethos Scanner pulls every transaction that wallet has ever made across Base, Ethereum, Arbitrum, Optimism, and Polygon, identifies the wallets it interacts with most, fetches *those* wallets' transaction histories, then runs a battery of correlation tests looking for patterns that don't happen by accident: shared first funders, shared CEX deposit addresses, mutual vouches, invitation trees, multi-hop funding chains. Each pattern contributes to a weighted score. Wallets that cross specific thresholds are bucketed into "strong" or "possible" cluster members and surfaced with the evidence the scanner used to flag them.

The result is a one-screen summary an investigator can act on: *"these N profiles are almost certainly the same person manipulating reputation, and here's the on-chain evidence."*

## Skills demonstrated
- Threat modeling and attack pattern analysis (sybil, vouch farming, invitation abuse)
- On-chain forensic investigation across 5 EVM networks
- Automated IOC correlation and weighted evidence scoring
- Incident report drafting and evidence documentation
- Designed for investigator workflow — evidence surfaced, human makes final call

---

## The problem this solves

[Ethos](https://ethos.network) is a reputation protocol on Base. People accumulate reputation through on-chain actions — getting vouched for (someone stakes ETH on your honesty), receiving reviews, and being invited into the network by existing members. Reputation has real value: high-score profiles get access to gated communities, signal trustworthiness in trades, and qualify for airdrops.

Where there's value, there's manipulation. The most common attack patterns:

- **Sybil farms.** One person creates many wallets and Ethos profiles, has them vouch for and review each other, and inflates one "main" account's reputation off the back of fake social proof.
- **Vouch-for-vouch rings.** Two or more real people agree to vouch for each other reciprocally without genuinely trusting each other, gaming the social signal.
- **Invitation tree gaming.** Someone with a high reputation invites a chain of accounts they control, then uses those accounts to vouch back upward.

These attacks all share one structural weakness: **the wallets involved tend to share on-chain history.** Fake personas don't usually go to the trouble of using fresh, independently-funded wallets for every identity. They share funding sources, consolidate funds back to the same exchange deposit address, transfer between each other, or get bridged from the same source. On-chain transactions are public and unforgeable. If you look hard enough, the cluster reveals itself.

Ethos Scanner is the tool for looking hard.

---

## What it does

| Capability | Description |
| --- | --- |
| Multi-chain transaction crawl | Pulls full transfer history for the target wallet across 5 EVM chains in parallel, paginating through up to 50 pages of `alchemy_getAssetTransfers` per chain |
| Direct counterparty analysis | Identifies every EOA the target has transacted with, flagging bidirectional and repeat-transfer relationships |
| First funder tracing | Finds the wallet that sent the target's first incoming transaction on each chain. Cross-references with candidate wallets to detect shared origins |
| Shared CEX deposit detection | Looks for cases where multiple cluster wallets have all sent funds to the same EOA which then forwarded to a known exchange — a strong signal of consolidation |
| Multi-hop funding discovery | Traces funder wallets one level deeper to find additional Ethos profiles connected through shared funding chains |
| Ethos social signal correlation | Cross-references the on-chain cluster against Ethos's invitation tree, mutual reviews, and mutual vouches to surface socially-coordinated abuse |
| Weighted scoring & bucketing | Each detected signal contributes weighted points; candidates are bucketed into "strong" (high confidence) and "possible" (medium confidence) clusters |
| AI-drafted slash reports | Optional one-click drafting of evidence-based slash reports using Claude, which the investigator reviews and edits before submitting |
| Investigation persistence | Scans are saved per-investigator in Supabase, with sharing, ownership, and an admin panel for managing access |

---

## How it works

```text
   ┌──────────────────────┐
   │  User pastes wallet  │
   └──────────┬───────────┘
              │
   ┌──────────▼───────────────────────────────────────┐
   │  Stage 1: Per-chain target transaction fetch     │
   │  ─────────────────────────────────────────────   │
   │  Base, Ethereum, Arbitrum, Optimism, Polygon     │
   │  in parallel via alchemy_getAssetTransfers       │
   │  (paginated, retries with backoff on 4xx/5xx)    │
   └──────────┬───────────────────────────────────────┘
              │
   ┌──────────▼───────────────────────────────────────┐
   │  Stage 2: Contract cache build                   │
   │  ─────────────────────────────────────────────   │
   │  Batched eth_getCode against every counterparty  │
   │  to filter out contracts (we only score EOAs)    │
   └──────────┬───────────────────────────────────────┘
              │
   ┌──────────▼───────────────────────────────────────┐
   │  Stage 3: Direct transfer analysis               │
   │  ─────────────────────────────────────────────   │
   │  In-memory: count, direction, repeat, bidir      │
   │  Pre-score and filter to "promising" candidates  │
   └──────────┬───────────────────────────────────────┘
              │
   ┌──────────▼───────────────────────────────────────┐
   │  Stage 4: Candidate transaction fetch            │
   │  ─────────────────────────────────────────────   │
   │  Parallel paginated fetches for each candidate   │
   │  (typically the slowest stage — 60% of runtime)  │
   └──────────┬───────────────────────────────────────┘
              │
   ┌──────────▼───────────────────────────────────────┐
   │  Stage 5: Correlation tests                      │
   │  ─────────────────────────────────────────────   │
   │  Shared funding sources                          │
   │  First funder analysis (target + each candidate) │
   │  Multi-hop funding chains                        │
   │  Shared CEX deposit addresses                    │
   └──────────┬───────────────────────────────────────┘
              │
   ┌──────────▼───────────────────────────────────────┐
   │  Stage 6: Ethos enrichment + social signals      │
   │  ─────────────────────────────────────────────   │
   │  Bulk profile lookup (500 addresses/request)     │
   │  Invitation tree, mutual reviews, mutual vouches │
   └──────────┬───────────────────────────────────────┘
              │
   ┌──────────▼───────────────────────────────────────┐
   │  Stage 7: Score, bucket, persist                 │
   │  ─────────────────────────────────────────────   │
   │  Weighted sum → confidence tier                  │
   │  Strong: high confidence (auto-high or 15+)      │
   │  Possible: medium confidence (8+)                │
   └──────────┬───────────────────────────────────────┘
              │
   ┌──────────▼───────────────────────────────────────┐
   │  Stage 8 (optional): AI evidence drafting        │
   │  ─────────────────────────────────────────────   │
   │  Claude Sonnet drafts a structured slash report  │
   │  the investigator reviews before submitting      │
   └──────────────────────────────────────────────────┘
```

---

## Detection signals

The scanner looks for **fourteen distinct signal types** across two categories: on-chain (transaction-derived) and social (Ethos-derived). Each signal contributes a weighted score to its candidate wallet. Weights were chosen empirically based on how much each signal *individually* discriminates real coordination from coincidence.

### On-chain signals

| Signal | Weight | What it observes |
| --- | --- | --- |
| `funded_by_target` | **10** | The candidate's first-ever incoming transaction came from the target wallet |
| `funded_by_cluster` | **10** | The candidate's first-ever incoming transaction came from another wallet that's already in the cluster |
| `shared_first_funder` | **8** | The candidate and target were both first-funded by the same wallet (and that wallet is not a known exchange) |
| `shared_cex_deposit` | **8** | Multiple cluster wallets have all sent funds to the same EOA, which itself forwards to a known exchange — a custom CEX deposit address |
| `multi_hop_funding` | **6** | A funder of the target also funded this wallet (one hop deeper than direct first-funder analysis) |
| `shared_incoming_sender` | **5** | Target and candidate share at least one incoming transfer source (EOA, not contract, not exchange) |
| `shared_exchange_funder` | **5** | Target and candidate share a first funder, but it's a known exchange withdrawal address — weaker than `shared_first_funder` because the same exchange hot wallet funds many unrelated users |
| `direct_transfer` | **4** | Target and candidate have transacted directly at least once |
| `repeat_transfer` | **4** | They've transacted directly more than once |
| `bidirectional` | **3** | They've sent funds to *each other* (in both directions) |

### Social signals (Ethos API)

| Signal | Weight | What it observes |
| --- | --- | --- |
| `invited_by_target` | **2** | The target invited this profile to Ethos |
| `invited_target` | **2** | This profile invited the target to Ethos |
| `mutual_reviews` | **2** | Target and candidate have reviewed each other on Ethos |
| `mutual_vouches` | **2** | Target and candidate have vouched for each other on Ethos |

Social signals are weighted lower than on-chain signals because they're individually weak (people legitimately invite, review, and vouch for each other all the time) but they're additive — a wallet that already has on-chain ties *and* social ties is much more likely to be coordinated than one with either alone.

---

## Investigative reasoning

The signals above aren't arbitrary — each one corresponds to a specific behavior pattern that's hard to reproduce by accident. Here's the reasoning behind the heaviest hitters:

### Why "funded by target / cluster" is worth 10 points

The first incoming transaction to a wallet is the moment of its on-chain birth. Fresh sybil wallets need ETH for gas before they can do anything else, and the simplest way to give a brand-new wallet ETH is to send it from a wallet you already control. If wallet B's *very first* transaction was an incoming transfer from wallet A, then either (a) A and B are controlled by the same person, (b) A is a friend who funded B as a favor, or (c) A is a public faucet. The scanner already filters out known faucets and exchange addresses, so when it surfaces this signal, the most parsimonious explanation is almost always (a).

This is the strongest single signal in the entire system. When it fires, the candidate is automatically marked **high confidence** regardless of total score, because no other signal needs to be present for the conclusion to be defensible.

**False positive risk:** low. The main edge case is people funding a friend's new wallet, but in practice friends rarely become *first* funders of a wallet that subsequently builds an Ethos reputation independently.

### Why "shared CEX deposit address" is worth 8 points

When you withdraw funds from an exchange like Binance or Kraken to your wallet, the exchange creates a **deposit address** unique to you for incoming funds back into the exchange. That deposit address is essentially a fingerprint — only you would deposit to it. If two different wallets both send funds to the same custom deposit address, and that address forwards to a major exchange, then the same person controls the account on the other side of those deposits.

This is the cleanest possible smoking gun for "the same human controls these wallets," because the deposit address is invisible to anyone except the exchange's owner. There's no plausible legitimate reason for two unrelated people's wallets to consolidate to the same exchange-controlled custom address.

The detection works in two stages: first the scanner identifies EOA addresses that two or more cluster wallets have sent to (filtering out contracts and other cluster members), then it traces the outgoing transfers from those candidate addresses to see if they end up at a known exchange. Only addresses that pass both tests get credited as a `shared_cex_deposit` signal.

**False positive risk:** very low. The main edge case is OTC desks or shared custodians, which is why the scanner caps the number of addresses it traces and surfaces the actual deposit address for human review.

### Why "shared first funder" is worth 8 points (and the exchange variant is only 5)

If two wallets were first funded by the same non-exchange wallet, that funder is almost certainly their common parent — someone bootstrapped both of them. This is the second-strongest origin signal.

But if the shared first funder is a known exchange hot wallet (e.g. Binance's main hot wallet, which funds millions of withdrawals), the signal collapses, because *everyone* who withdraws from Binance gets funded by the same hot wallet. The scanner detects this and downgrades the signal from `shared_first_funder` (weight 8) to `shared_exchange_funder` (weight 5), because two people both withdrawing from Binance is mildly coincidental but not damning.

**False positive risk:** medium for the exchange variant, low for the non-exchange variant.

### Why bidirectional + repeat + direct are weighted modestly

Direct transfers between two wallets prove they know each other but say nothing about *who they are*. Lots of legitimate users send ETH to friends. Even bidirectional repeat transfers can be totally normal between trading buddies. So these signals are individually weak — they're worth surfacing because they accumulate in coordination patterns, but no single direct-transfer signal pushes a candidate over the threshold by itself.

The scoring model relies on the principle that **multiple weak signals stacking is much stronger than any one strong signal alone**. A wallet with `direct_transfer + repeat + bidirectional + shared_first_funder + mutual_vouches` (4+4+3+8+2 = 21) is far more confidently flagged than one with just `funded_by_target` alone (10), even though `funded_by_target` is a stronger individual signal.

### Why social signals only get 2 points each

People legitimately invite each other to Ethos, review each other, and vouch for each other all the time — that's the entire point of the protocol. A single mutual vouch between two profiles is nothing. A mutual vouch between two profiles that *also* share a first funder, *also* transact directly, *and also* share a CEX deposit address is something completely different. The low individual weight reflects the high individual base rate; the additive scoring model captures the corroboration value.

---

## Scoring & confidence model

Once all signals are computed, each candidate has a total score (sum of signal weights). The candidate is then bucketed into one of three confidence tiers:

| Confidence | Criteria |
| --- | --- |
| **High** | `funded_by_target` or `funded_by_cluster` fired (auto-high), OR total score ≥ 15 with at least 2 distinct signal types |
| **Medium** | Total score ≥ 8 |
| **Low** | Total score < 8 (filtered out, never shown) |

The "at least 2 distinct signal types" requirement for high confidence is important: it prevents a wallet from getting promoted to strong cluster membership just because one signal happens to fire repeatedly with high weights. Diversity of signal types is treated as evidence of genuinely orthogonal coordination patterns rather than a single coincidence amplified.

After scoring, candidates are deduplicated by Ethos profile ID — if two wallets resolve to the same Ethos profile (same person, multiple wallets), they're merged into one cluster entry with all their wallets and signals combined. The final result is a list of *profiles*, not wallets, which is what the investigator actually cares about.

---

## Example output

**Scan in progress** — <img width="1490" height="1082" alt="image" src="https://github.com/user-attachments/assets/fb0940e2-0029-4d60-802f-c6829ad0a18b" />

The scan log streams from server to client over a chunked HTTP response. Each per-chain stage logs into the live feed and the progress bar moves at exactly real-time pace based on a rolling-average baseline of recent scans.

**Cluster overview** — <img width="1828" height="1892" alt="image" src="https://github.com/user-attachments/assets/2df0f2a3-c250-4a3f-b244-a6178b8997d0" />

The result card shows network stats, target Ethos profile, key findings with linked profile names, target's first funders per chain, and one-click copy/export of all cluster wallet addresses.

**Strong cluster card** — <img width="1430" height="858" alt="image" src="https://github.com/user-attachments/assets/a354105e-db05-4451-9084-3c4ebf1e96ac" />

A flagged profile with its Ethos identity, network breakdown, signal list, and on-chain evidence. Each signal shows the weight and the specific detail that triggered it.

**AI-drafted slash report generation prompt** — 
Optional one-click evidence drafting using Claude. The model is given the structured cluster data plus any screenshots the investigator has uploaded as additional evidence, and produces a neutral, structured report the investigator reviews before posting.


---

## Architecture

### Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Framework | Next.js 16 (App Router) | Streaming responses for live scan output, server actions for the auth/admin layer, edge-friendly deployment on Vercel |
| Auth | NextAuth (Twitter OAuth v2) | Ethos profiles are bound to Twitter handles, so OAuth via Twitter gives us identity matching out of the box |
| Database | Supabase (Postgres) | Investigations, allowlist, audit log, scan duration history |
| On-chain data | Alchemy `alchemy_getAssetTransfers` and `eth_getCode`, batched and parallelized | Multi-chain transfer indexing without running our own nodes |
| Reputation data | [Ethos Network API](https://api.ethos.network) | Bulk profile lookup, invitation trees, activity feeds |
| AI evidence drafting | Anthropic Claude Sonnet via the official SDK | Structured prompt that draws only on provided evidence and refuses to speculate |
| UI | React 19, Tailwind v4, Framer Motion, Three.js (dithered background shader) | Monochrome retro-terminal aesthetic |

### Notable internal systems

**Streaming scan output.** The scan API doesn't buffer — it returns a `ReadableStream` that emits newline-delimited JSON events as the scan runs (`log`, `progress`, `result`, `error`). The client renders log entries and progress bar updates live. Total response time is bounded by Vercel's 5-minute function limit; in practice scans run 30s-3min.

**Time-based ETA estimator.** The progress bar and "time left" countdown are driven by a rolling average of the last 20 completed scan durations (stored in `investigations.scan_duration_ms`), not by per-step rate calculation. This produces a stable, monotonic countdown that ticks at exactly 1 second per second. Cold start uses a 90-second baseline that gets replaced as history accumulates. Cached server-side for 60 seconds to keep DB load negligible.

**Allowlist with audit log.** Access is gated to specific Ethos profile IDs stored in Supabase. Adds, removes, and edits are recorded in `allowed_users_audit` for accountability. The auth layer re-checks the allowlist on every protected request (with a 10-second in-process cache) so removed users lose access within ~10 seconds rather than waiting for their JWT to expire.

**Empty-allowlist self-heal.** During the migration from an env-var allowlist to a DB-backed one, the DB layer detects an empty `allowed_users` table and seeds itself from the legacy `ETHOS_PROFILE_ALLOWLIST` env var on the first protected request. Existing users with valid JWTs don't get bounced after deploy.

**Per-chain pagination caps.** The target wallet fetches up to 50 pages of transfers per chain (5,000 transfers max/chain). Candidate wallets fetch only 6 pages with a 4,000-transfer ceiling, since we already know they're suspicious and don't need full history. These caps balance Alchemy CU consumption against detection completeness.

---

## Limitations

A portfolio README without a "limitations" section is dishonest. Here's what this tool **does not** do:

- **Detects only on-chain-linked coordination.** Two profiles run by the same person who use independently-funded wallets and never transact with each other will be invisible to this tool. To catch those, you'd need social/behavioral analysis (posting time correlation, image hash matches, similar bio patterns, follower graph anomalies) — that's a totally different category of tool.
- **No global view.** The scanner is single-target: paste one wallet, get one cluster. There's no "find all sybils on Ethos" mode. A future iteration could mirror the Ethos production database read-only and run cluster detection across the entire network in batch, but that's a significantly larger build.
- **Heuristic, not deterministic.** Every signal can produce false positives. The tool surfaces evidence; the investigator makes the final call. The "confidence" tiers reflect the strength of the *evidence*, not certainty of guilt.
- **Bound by Alchemy's data window.** `alchemy_getAssetTransfers` returns up to ~1000 transfers per page and we paginate to a fixed cap. Very high-volume wallets (DEX bots, market makers) can have history that exceeds the cap, in which case the scanner only sees the most recent slice. In practice this rarely matters because sybil wallets are usually low-volume.
- **Cold-start ETA is approximate.** The rolling-average baseline needs ~5 completed scans before it kicks in. The first few scans after a fresh deploy use a hardcoded 90-second baseline that may over- or under-shoot.

---



## Acknowledgments

Code written primarily by Claude Code. Planning, architectural and design decisions made by me.

I am considering to make this tool public for all Ethos users to conduct their own investigations.


---

## License

Internal tool — not currently licensed for external use.
