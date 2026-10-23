#!/usr/bin/env -S npx tsx
/**
 * Populate profile_addresses.is_contract by checking each attested wallet
 * for on-chain bytecode across all scanned chains. Smart-contract wallets
 * (e.g. the Ethos/Privy proxy) are excluded from scans; EOAs — including
 * EIP-7702 delegated ones — are the personal wallets a user actually
 * connected. Addresses the RPC fails to answer for are skipped, not
 * written, so a transient outage can't persist wrong flags.
 *
 * Usage:
 *   npx tsx scripts/backfill/classify-wallets.ts [--all | --contracts] [--dry-run]
 *
 *   default   only classify rows where is_contract IS NULL (cheap refresh
 *             for new attestations — safe to run on a schedule)
 *   --all     re-classify every row
 *   --contracts  re-classify only rows currently flagged is_contract=true
 *             (use after a classifier change that narrows what counts as a
 *             contract, e.g. EIP-7702 delegated EOAs)
 *   --dry-run count only, write nothing
 *
 * Requires scripts/migrations/2026-07-03-wallet-is-contract.sql first.
 */

try {
  process.loadEnvFile(".env.local");
} catch {
  // intentional: ok if running in an env that injects vars directly
}

import { getSupabase } from "@/lib/db/supabase";
import { classifyContractsOnChain, writeContractFlags } from "@/lib/wallet-classify";

const ALL = process.argv.includes("--all");
const CONTRACTS_ONLY = process.argv.includes("--contracts");
if (ALL && CONTRACTS_ONLY) {
  console.error("[classify] --all and --contracts are mutually exclusive");
  process.exit(1);
}
const DRY_RUN = process.argv.includes("--dry-run");
const MODE = ALL ? "--all" : CONTRACTS_ONLY ? "flagged contracts only" : "unclassified only";

async function main() {
  const supabase = getSupabase();
  const PAGE = 1000;

  // Distinct addresses to classify (an address can be attested to >1 profile).
  const addrs = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from("profile_addresses").select("address, is_contract").order("address", { ascending: true });
    if (CONTRACTS_ONLY) q = q.eq("is_contract", true);
    else if (!ALL) q = q.is("is_contract", null);
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw new Error(`profile_addresses fetch failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data as { address: string }[]) addrs.add(r.address.toLowerCase());
    if (data.length < PAGE) break;
  }

  const list = [...addrs];
  console.log(`[classify] ${list.length} address(es) to classify (${MODE})${DRY_RUN ? " [DRY RUN]" : ""}`);
  if (list.length === 0) return;

  let contracts = 0;
  let eoas = 0;
  let unresolved = 0; // RPC didn't answer on some chain — skipped, not written
  // Each chunk is one batched eth_getCode per chain, all chains in
  // parallel. Alchemy throttles sustained bursts (429 after ~1,500
  // addresses at 500/chunk), so keep chunks modest and pause between them.
  const CHUNK = 200;
  const PACE_MS = 1000;
  for (let i = 0; i < list.length; i += CHUNK) {
    if (i > 0) await new Promise((r) => setTimeout(r, PACE_MS));
    const chunk = list.slice(i, i + CHUNK);
    const flags = await classifyContractsOnChain(chunk);
    const chunkContracts = [...flags.values()].filter(Boolean).length;
    contracts += chunkContracts;
    eoas += flags.size - chunkContracts;
    unresolved += chunk.length - flags.size;

    // Bulk-write grouped by value (address isn't unique — the .in() update
    // covers every profile_addresses row for these wallets).
    if (!DRY_RUN) await writeContractFlags(flags);
    console.log(`[classify] ${Math.min(i + CHUNK, list.length)}/${list.length} · contracts=${contracts} eoas=${eoas} unresolved=${unresolved}`);
  }

  console.log(
    `[classify] done · contracts=${contracts} (${(100 * contracts / list.length).toFixed(1)}%) · eoas=${eoas} · unresolved=${unresolved} (left unchanged)`
  );
}

main().catch((err) => {
  console.error("[classify] fatal:", err);
  process.exit(1);
});
