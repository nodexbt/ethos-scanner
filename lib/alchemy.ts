function getAlchemyKey() {
  return process.env.ALCHEMY_API_KEY || "";
}

// Chains to check for funding analysis (Base first since Ethos is on Base)
import { AsyncLocalStorage } from "node:async_hooks";

/** `internal`: whether alchemy_getAssetTransfers supports the "internal"
    category on this chain (contract-originated ETH moves, e.g. a smart
    wallet or bridge funding an EOA). Arbitrum and Optimism reject it. */
export const CHAINS = [
  { id: "base-mainnet", name: "Base", rpcBase: "https://base-mainnet.g.alchemy.com/v2", internal: true },
  { id: "eth-mainnet", name: "Ethereum", rpcBase: "https://eth-mainnet.g.alchemy.com/v2", internal: true },
  { id: "arb-mainnet", name: "Arbitrum", rpcBase: "https://arb-mainnet.g.alchemy.com/v2", internal: false },
  { id: "opt-mainnet", name: "Optimism", rpcBase: "https://opt-mainnet.g.alchemy.com/v2", internal: false },
  { id: "polygon-mainnet", name: "Polygon", rpcBase: "https://polygon-mainnet.g.alchemy.com/v2", internal: true },
] as const;

/**
 * Transfer categories for a purpose:
 * - "all": everything the chain supports — ETH, internal, ERC-20/721/1155.
 *   Used for discovery (who has the target transacted with at all).
 * - "native": ETH value moves only (external + internal where supported).
 *   Used for funding analysis: a token airdrop is not funding, and spam
 *   token senders would otherwise become "shared funders" of everyone.
 * - "value": native plus ERC-20, for exchange-deposit tracing where
 *   stablecoin deposits are as telling as ETH ones.
 */
export type TransferScope = "all" | "native" | "value";
export const NATIVE_CATEGORIES = new Set(["external", "internal"]);
export function transferCategories(chain: Chain, scope: TransferScope): string[] {
  const native = chain.internal ? ["external", "internal"] : ["external"];
  if (scope === "native") return native;
  if (scope === "value") return [...native, "erc20"];
  return [...native, "erc20", "erc721", "erc1155"];
}

// --- Usage accounting ---
// Compute-unit prices from alchemy.com/docs/reference/compute-unit-costs.
const CU_PER_METHOD: Record<string, number> = {
  alchemy_getAssetTransfers: 120,
  eth_getCode: 20,
};
export interface AlchemyUsage {
  calls: number;
  computeUnits: number;
  byMethod: Record<string, number>;
}
const usageStore = new AsyncLocalStorage<AlchemyUsage>();
function recordUsage(method: string, n = 1) {
  const u = usageStore.getStore();
  if (!u) return;
  u.calls += n;
  u.computeUnits += n * (CU_PER_METHOD[method] ?? 0);
  u.byMethod[method] = (u.byMethod[method] ?? 0) + n;
}
/** Run `fn` with a fresh usage counter; every Alchemy call made inside
    (including in parallel branches) is attributed to it. */
export async function runWithUsage<T>(fn: () => Promise<T>): Promise<{ result: T; usage: AlchemyUsage }> {
  const usage: AlchemyUsage = { calls: 0, computeUnits: 0, byMethod: {} };
  const result = await usageStore.run(usage, fn);
  return { result, usage };
}

export type Chain = (typeof CHAINS)[number];
export type ChainId = Chain["id"];

export interface AssetTransfer {
  from: string;
  to: string;
  value: number | null;
  asset: string | null;
  category: string;
  blockNum: string;
  hash: string;
  metadata?: { blockTimestamp?: string };
}

interface AssetTransfersResponse {
  result: {
    transfers: AssetTransfer[];
    pageKey?: string;
  };
}

const MAX_RETRIES = 4;
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

async function alchemyRequest(
  chainRpcBase: string,
  method: string,
  params: unknown[]
): Promise<unknown | null> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      recordUsage(method);
      const response = await fetch(`${chainRpcBase}/${getAlchemyKey()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: 1,
          jsonrpc: "2.0",
          method,
          params,
        }),
      });

      if (response.ok) {
        return response.json();
      }

      if (RETRYABLE_STATUSES.has(response.status) && attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** (attempt - 1), 15000)));
        continue;
      }

      return null;
    } catch {
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** (attempt - 1), 15000)));
        continue;
      }
      return null;
    }
  }

  return null;
}

/** Get the first incoming ETH transfer to a wallet on a given chain */
export async function getFirstFunder(
  wallet: string,
  chain: (typeof CHAINS)[number]
): Promise<{ funder: string; txHash: string; value: number; asset: string | null } | null> {
  try {
    const data = (await alchemyRequest(chain.rpcBase, "alchemy_getAssetTransfers", [
      {
        fromBlock: "0x0",
        toAddress: wallet.toLowerCase(),
        // Native token only, incl. internal where supported: a wallet bootstrapped
        // by a smart wallet or bridge is funded by an internal transfer.
        category: transferCategories(chain, "native"),
        order: "asc",
        maxCount: "0x1",
        withMetadata: false,
        excludeZeroValue: true,
      },
    ])) as AssetTransfersResponse | null;

    if (!data) return null;
    const transfers = data.result?.transfers;
    if (!transfers || transfers.length === 0) return null;

    const first = transfers[0];
    return {
      funder: first.from.toLowerCase(),
      txHash: first.hash,
      value: first.value || 0,
      asset: first.asset ?? null,
    };
  } catch {
    return null;
  }
}

/** Get outgoing ETH transfers from a wallet on a given chain */
export async function getOutgoingTransfers(
  wallet: string,
  chain: (typeof CHAINS)[number],
  maxCount: number = 100
): Promise<{ to: string; value: number; txHash: string }[]> {
  try {
    const data = (await alchemyRequest(chain.rpcBase, "alchemy_getAssetTransfers", [
      {
        fromBlock: "0x0",
        fromAddress: wallet.toLowerCase(),
        // ETH + stablecoins: exchange deposits are often made in USDC.
        category: transferCategories(chain, "value"),
        order: "asc",
        maxCount: `0x${maxCount.toString(16)}`,
        withMetadata: false,
        excludeZeroValue: true,
      },
    ])) as AssetTransfersResponse;

    const transfers = data.result?.transfers;
    if (!transfers) return [];

    return transfers.map((t) => ({
      to: t.to.toLowerCase(),
      value: t.value || 0,
      txHash: t.hash,
    }));
  } catch (err) {
    // Silently return empty on failure
    return [];
  }
}

/** Fetch all transactions for a wallet (paginated, both directions) */
export async function getAllTransactions(
  wallet: string,
  chain: Chain,
  opts: {
    maxPages?: number;
    maxTxs?: number;
    /** Called when a page request fails after retries. The function still
        returns whatever was fetched so far, so callers that care about
        completeness must listen here. */
    onFailure?: (reason: string) => void;
    /** Which transfer categories to fetch. Defaults to plain ETH. */
    scope?: TransferScope;
    /** Called once if a direction stopped at maxPages/maxTxs with more
        history remaining, so callers can report bounded coverage. */
    onCapped?: () => void;
  } = {}
): Promise<AssetTransfer[]> {
  const maxPages = opts.maxPages ?? 50;
  const maxTxs = opts.maxTxs ?? Infinity;
  const addr = wallet.toLowerCase();

  async function fetchDirection(directionParams: Record<string, string>): Promise<AssetTransfer[]> {
    const rows: AssetTransfer[] = [];
    let pageKey: string | undefined;
    let pages = 0;

    while (pages < maxPages && rows.length < maxTxs) {
      const params: Record<string, unknown> = {
        fromBlock: "0x0",
        toBlock: "latest",
        category: opts.scope ? transferCategories(chain, opts.scope) : ["external"],
        withMetadata: true,
        excludeZeroValue: false,
        maxCount: "0x3E8", // 1000
        ...directionParams,
      };
      if (pageKey) params.pageKey = pageKey;

      try {
        const data = await alchemyRequest(
          chain.rpcBase,
          "alchemy_getAssetTransfers",
          [params]
        ) as AssetTransfersResponse | null;

        if (!data) {
          opts.onFailure?.(`transfer fetch for ${addr.slice(0, 10)}… failed after retries (page ${pages + 1})`);
          break;
        }
        if ((data as { error?: { message?: string } }).error) {
          opts.onFailure?.(
            `transfer fetch for ${addr.slice(0, 10)}… rejected: ${(data as { error?: { message?: string } }).error?.message ?? "RPC error"}`
          );
          break;
        }

        const transfers = data.result?.transfers;
        if (!transfers || transfers.length === 0) break;

        const remaining = maxTxs - rows.length;
        rows.push(...transfers.slice(0, remaining));

        pageKey = data.result?.pageKey;
        pages++;
        if (!pageKey) break;
        if (pages >= maxPages || rows.length >= maxTxs) {
          opts.onCapped?.();
          break;
        }
      } catch (err) {
        // Break pagination on error, return what we have
        opts.onFailure?.(`transfer fetch for ${addr.slice(0, 10)}… threw: ${err instanceof Error ? err.message : String(err)}`);
        break;
      }
    }
    return rows;
  }

  const [outgoing, incoming] = await Promise.all([
    fetchDirection({ fromAddress: addr }),
    fetchDirection({ toAddress: addr }),
  ]);

  // Deduplicate by hash
  const seen = new Set<string>();
  const all: AssetTransfer[] = [];
  for (const tx of [...outgoing, ...incoming]) {
    const key = tx.hash || `${tx.from}:${tx.to}:${tx.blockNum}`;
    if (!seen.has(key)) {
      seen.add(key);
      all.push(tx);
    }
  }
  return all;
}

/** Incoming value transfers (ETH + ERC-20) to an address — who has ever
    sent to it. Used to find other senders to an exchange deposit address. */
export async function getIncomingTransfers(
  wallet: string,
  chain: (typeof CHAINS)[number],
  maxCount: number = 1000
): Promise<{ from: string; value: number; txHash: string }[]> {
  try {
    const data = (await alchemyRequest(chain.rpcBase, "alchemy_getAssetTransfers", [
      {
        fromBlock: "0x0",
        toAddress: wallet.toLowerCase(),
        category: transferCategories(chain, "value"),
        order: "asc",
        maxCount: `0x${maxCount.toString(16)}`,
        withMetadata: false,
        excludeZeroValue: true,
      },
    ])) as AssetTransfersResponse | null;
    const transfers = data?.result?.transfers;
    if (!transfers) return [];
    return transfers
      .filter((t) => t.from)
      .map((t) => ({ from: t.from.toLowerCase(), value: t.value || 0, txHash: t.hash }));
  } catch {
    return [];
  }
}

/**
 * Batch eth_getCode. Returns the raw code hex for every address the RPC
 * answered for; addresses whose request failed (HTTP error past retries,
 * per-item JSON-RPC error, malformed response) are simply absent so callers
 * can tell "no code" apart from "couldn't check". Interpretation of the code
 * (contract vs EOA vs EIP-7702 delegation) lives in wallet-classify.ts.
 */
export async function batchGetCode(
  addresses: string[],
  chain: Chain,
  batchSize: number = 200
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const unique = [...new Set(addresses.map((a) => a.toLowerCase()))];

  for (let i = 0; i < unique.length; i += batchSize) {
    const chunk = unique.slice(i, i + batchSize);
    const batchPayload = chunk.map((addr, idx) => ({
      id: idx,
      jsonrpc: "2.0" as const,
      method: "eth_getCode",
      params: [addr, "latest"],
    }));

    try {
      let resp: Response | null = null;
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          recordUsage("eth_getCode", chunk.length);
          resp = await fetch(`${chain.rpcBase}/${getAlchemyKey()}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(batchPayload),
          });
          if (resp.ok || !RETRYABLE_STATUSES.has(resp.status)) break;
        } catch {
          if (attempt === MAX_RETRIES) break;
        }
        await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** (attempt - 1), 15000)));
      }

      // Unresolved chunk: leave every address absent rather than guessing.
      if (!resp || !resp.ok) {
        console.warn(`batchGetCode ${chain.name}: ${resp ? `HTTP ${resp.status}` : "no response"} for ${chunk.length} addresses`);
        continue;
      }

      const responses: { id: number; result?: unknown; error?: unknown }[] = await resp.json();
      for (const r of Array.isArray(responses) ? responses : [responses]) {
        if (r.id === undefined || r.error || typeof r.result !== "string") continue;
        const addr = chunk[r.id];
        if (addr) result.set(addr, r.result);
      }
    } catch {
      // Network/parse failure: addresses stay absent (unknown).
    }
  }
  return result;
}

/** Run tasks with concurrency limit */
export async function parallel<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number = 10
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
