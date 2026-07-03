import { CHAINS, batchGetCode } from "./alchemy";
import { getSupabase } from "./db/supabase";

/**
 * Classify addresses as smart-contract wallets vs personal EOAs by checking
 * for on-chain bytecode across all scanned chains. An address is a contract
 * (smart wallet) if it has code on ANY chain — a private-key EOA never has
 * code anywhere, so any code means it's not a personally-controlled wallet.
 * A counterfactual (undeployed) smart wallet reads as an EOA here, which is
 * harmless: it has no history to pollute a scan.
 */
export async function classifyContractsOnChain(
  addresses: string[]
): Promise<Map<string, boolean>> {
  const result = new Map<string, boolean>();
  const unique = [...new Set(addresses.map((a) => a.toLowerCase()))];
  for (const a of unique) result.set(a, false);

  for (const chain of CHAINS) {
    const codes = await batchGetCode(unique, chain);
    for (const [addr, isContract] of codes) {
      if (isContract) result.set(addr.toLowerCase(), true);
    }
  }
  return result;
}

/**
 * Contract flags for the given addresses, reading the cached
 * profile_addresses.is_contract column first and falling back to a live
 * on-chain check only for addresses not yet classified (e.g. brand-new
 * attestations). Unknowns are cached back so the next scan is free.
 */
export async function getContractFlags(
  addresses: string[]
): Promise<Map<string, boolean>> {
  const flags = new Map<string, boolean>();
  const lower = [...new Set(addresses.map((a) => a.toLowerCase()))];
  if (lower.length === 0) return flags;

  const unknown = new Set(lower);
  const supabase = getSupabase();
  for (let i = 0; i < lower.length; i += 200) {
    const chunk = lower.slice(i, i + 200);
    const { data, error } = await supabase
      .from("profile_addresses")
      .select("address, is_contract")
      .in("address", chunk);
    if (error) break; // fall through to live classification for all
    for (const row of (data ?? []) as { address: string; is_contract: boolean | null }[]) {
      if (row.is_contract !== null && row.is_contract !== undefined) {
        const a = row.address.toLowerCase();
        flags.set(a, row.is_contract);
        unknown.delete(a);
      }
    }
  }

  if (unknown.size > 0) {
    const live = await classifyContractsOnChain([...unknown]);
    for (const [addr, isContract] of live) flags.set(addr, isContract);
    // Best-effort cache write so the next scan doesn't re-check on-chain.
    try {
      await writeContractFlags(live);
    } catch {
      // Caching is optional; classification already returned above.
    }
  }

  return flags;
}

/**
 * Persist is_contract for the given addresses. Groups by boolean value and
 * issues one bulk .in() update per (value, chunk) — two queries per chunk
 * instead of one per address, which matters at 89k-wallet scale.
 */
export async function writeContractFlags(
  flags: Map<string, boolean>
): Promise<void> {
  const supabase = getSupabase();
  const contracts = [...flags].filter(([, v]) => v).map(([a]) => a);
  const eoas = [...flags].filter(([, v]) => !v).map(([a]) => a);
  for (const [value, addrs] of [[true, contracts], [false, eoas]] as const) {
    for (let i = 0; i < addrs.length; i += 200) {
      const chunk = addrs.slice(i, i + 200);
      if (chunk.length === 0) continue;
      const { error } = await supabase
        .from("profile_addresses")
        .update({ is_contract: value })
        .in("address", chunk);
      if (error) console.error("writeContractFlags error:", error.message);
    }
  }
}
