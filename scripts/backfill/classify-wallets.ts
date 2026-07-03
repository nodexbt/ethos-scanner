#!/usr/bin/env -S npx tsx
/**
 * Populate profile_addresses.is_contract by checking each attested wallet
 * for on-chain bytecode across all scanned chains. Smart-contract wallets
 * (e.g. the Ethos/Privy proxy) are excluded from scans; EOAs are the
 * personal wallets a user actually connected.
 *
 * Usage:
 *   npx tsx scripts/backfill/classify-wallets.ts [--all] [--dry-run]
 *
 *   default   only classify rows where is_contract IS NULL (cheap refresh
 *             for new attestations — safe to run on a schedule)
 *   --all     re-classify every row
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
const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  const supabase = getSupabase();
  const PAGE = 1000;

  // Distinct addresses to classify (an address can be attested to >1 profile).
  const addrs = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from("profile_addresses").select("address, is_contract").order("address", { ascending: true });
    if (!ALL) q = q.is("is_contract", null);
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw new Error(`profile_addresses fetch failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data as { address: string }[]) addrs.add(r.address.toLowerCase());
    if (data.length < PAGE) break;
  }

  const list = [...addrs];
  console.log(`[classify] ${list.length} address(es) to classify${ALL ? " (--all)" : " (unclassified only)"}${DRY_RUN ? " [DRY RUN]" : ""}`);
  if (list.length === 0) return;

  let contracts = 0;
  let eoas = 0;
  const CHUNK = 500; // classify in chunks (each = 1 batchGetCode per chain)
  for (let i = 0; i < list.length; i += CHUNK) {
    const chunk = list.slice(i, i + CHUNK);
    const flags = await classifyContractsOnChain(chunk);
    for (const isC of flags.values()) isC ? contracts++ : eoas++;

    // Bulk-write grouped by value (address isn't unique — the .in() update
    // covers every profile_addresses row for these wallets).
    if (!DRY_RUN) await writeContractFlags(flags);
    console.log(`[classify] ${Math.min(i + CHUNK, list.length)}/${list.length} · contracts=${contracts} eoas=${eoas}`);
  }

  console.log(
    `[classify] done · contracts=${contracts} (${(100 * contracts / list.length).toFixed(1)}%) · eoas=${eoas}`
  );
}

main().catch((err) => {
  console.error("[classify] fatal:", err);
  process.exit(1);
});
