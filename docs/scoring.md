# Scoring model

How a candidate wallet earns its **link strength** and its confidence tier. The weights are set where each signal is detected in [`lib/cluster-scanner.ts`](../lib/cluster-scanner.ts); the thresholds are `FINAL_SCORE_THRESHOLD` and `POSSIBLE_SCORE_THRESHOLD` in the same file, and the tiering rules are `confidenceFor` and `recalcConfidence`. All of it is covered by [`tests/scoring.test.ts`](../tests/scoring.test.ts).

## Detection signals

The scanner records **fourteen signal types** across two categories: on-chain (transaction-derived) and social (Ethos-derived). Seven of them carry weight and add up to a candidate's **link strength**; the other seven score 0 and are shown for context. Weights were chosen empirically based on how much each signal *individually* discriminates real coordination from coincidence.

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
| `direct_transfer` | 0 (context) | Target and candidate have transacted directly at least once. Direct transfers are how candidates are *discovered*; they don't add points |
| `repeat_transfer` | 0 (context) | They've transacted directly more than once |
| `bidirectional` | 0 (context) | They've sent funds to *each other* (in both directions) |

### Social signals (Ethos API)

| Signal | Weight | What it observes |
| --- | --- | --- |
| `invited_by_target` | 0 (context) | The target invited this profile to Ethos |
| `invited_target` | 0 (context) | This profile invited the target to Ethos |
| `mutual_reviews` | 0 (context) | Target and candidate have reviewed each other on Ethos |
| `mutual_vouches` | 0 (context) | Target and candidate have vouched for each other on Ethos |

Social signals carry no weight. They used to add 2 points each, which drove false positives: people legitimately invite, review, and vouch for each other all the time. They are still recorded and shown in the candidate's breakdown so an investigator can read the on-chain link in its social context.

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

### Why direct transfers and social signals score 0

Direct transfers between two wallets prove they know each other but say nothing about *who they are*. Lots of legitimate users send ETH to friends, and even bidirectional repeat transfers are normal between trading buddies. Direct transfers are therefore how the scanner *finds* candidates, not how it scores them.

The same goes for Ethos social ties: people invite, review, and vouch for each other all the time — that's the entire point of the protocol. Both groups used to carry small weights, and in practice they pushed unrelated profiles over the Possible threshold. They now score 0 and appear in the breakdown as context, so a shared first funder *plus* a mutual vouch still reads differently to a human than a shared first funder alone.

The scoring model relies on the principle that **multiple independent signals stacking is much stronger than any one signal alone**: a wallet with `shared_first_funder + shared_cex_deposit` (8+8 = 16, two types) is flagged Strong, while either on its own is only Possible.

---

## Scoring & confidence model

Once all signals are computed, each candidate has a **link strength** (sum of signal weights; shown as such in the UI to keep it distinct from the Ethos credibility score). The candidate is then bucketed into one of three confidence tiers:

| Confidence | Criteria |
| --- | --- |
| **High** | `funded_by_target` or `funded_by_cluster` fired (auto-high), OR total score ≥ 15 with at least 2 distinct signal types |
| **Medium** | Total score ≥ 8 |
| **Low** | Total score < 8 (filtered out, never shown) |

The "at least 2 distinct signal types" requirement for high confidence is important: it prevents a wallet from getting promoted to strong cluster membership just because one signal happens to fire repeatedly with high weights. Diversity of signal types is treated as evidence of genuinely orthogonal coordination patterns rather than a single coincidence amplified.

After scoring, candidates are deduplicated by Ethos profile ID — if two wallets resolve to the same Ethos profile (same person, multiple wallets), they're merged into one cluster entry with all their wallets and signals combined. The final result is a list of *profiles*, not wallets, which is what the investigator actually cares about.

---

