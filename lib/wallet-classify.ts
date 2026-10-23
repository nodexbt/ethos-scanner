import { CHAINS, batchGetCode, type Chain } from "./alchemy";
import { getSupabase } from "./db/supabase";

/**
 * EIP-7702 delegation designator: an EOA that has delegated to a smart-
 * account implementation (MetaMask / Coinbase "smart accounts") gets code
 * `0xef0100 || <20-byte address>` — exactly 23 bytes. It is still a
 * personally-controlled, private-key wallet, so it counts as an EOA. The
 * length check keeps the exemption exact: anything else that happens to
 * start with 0xef is treated as a contract.
 */
const EIP7702_PREFIX = "0xef0100";
const EIP7702_CODE_LEN = 2 + 23 * 2;

/** Does this eth_getCode result mean "smart contract / smart wallet"? */
export function hasContractCode(code: string | undefined | null): boolean {
  const c = (code || "0x").toLowerCase();
  if (c === "0x" || c === "0x0") return false;
  if (c.length === EIP7702_CODE_LEN && c.startsWith(EIP7702_PREFIX)) return false;
  return true;
}

/**
 * Contract flag per address on one chain. Addresses the RPC did not answer
 * for are absent (unknown), never defaulted to EOA.
 */
export async function batchIsContract(
  addresses: string[],
  chain: Chain
): Promise<Map<string, boolean>> {
  const codes = await batchGetCode(addresses, chain);
  const result = new Map<string, boolean>();
  for (const [addr, code] of codes) result.set(addr, hasContractCode(code));
  return result;
}

/**
 * Classify addresses as smart-contract wallets vs personal EOAs by checking
 * for on-chain bytecode across all scanned chains. An address is a contract
 * (smart wallet) if it has contract code on ANY chain. Plain EOAs have no
 * code; EIP-7702 delegated EOAs carry a 23-byte designator that
 * hasContractCode() exempts, so they still classify as EOAs.
 *
 * An address is only reported as an EOA (false) when EVERY chain answered
 * and none had contract code. If any chain failed to answer and no other
 * chain showed code, the address is left out of the result (unknown) so a
 * transient RPC outage can't get persisted as "EOA".
 *
 * A counterfactual (undeployed) smart wallet reads as an EOA here, which is
 * harmless: it has no history to pollute a scan.
 */
export async function classifyContractsOnChain(
  addresses: string[]
): Promise<Map<string, boolean>> {
  const unique = [...new Set(addresses.map((a) => a.toLowerCase()))];
  const isContract = new Set<string>();
  const unresolved = new Set<string>();

  for (const chain of CHAINS) {
    const flags = await batchIsContract(unique, chain);
    for (const a of unique) {
      const f = flags.get(a);
      if (f === undefined) unresolved.add(a);
      else if (f) isContract.add(a);
    }
  }

  const result = new Map<string, boolean>();
  for (const a of unique) {
    if (isContract.has(a)) result.set(a, true);
    else if (!unresolved.has(a)) result.set(a, false);
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
    // Addresses the RPC couldn't classify stay absent from `flags`, which
    // callers read as "scan it" (flags.get() → undefined → not a contract).
    // They are not cached, so the next scan re-checks them.
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
