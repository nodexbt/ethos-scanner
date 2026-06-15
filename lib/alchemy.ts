function getAlchemyKey() {
  return process.env.ALCHEMY_API_KEY || "";
}

// Chains to check for funding analysis (Base first since Ethos is on Base)
export const CHAINS = [
  { id: "base-mainnet", name: "Base", rpcBase: "https://base-mainnet.g.alchemy.com/v2" },
  { id: "eth-mainnet", name: "Ethereum", rpcBase: "https://eth-mainnet.g.alchemy.com/v2" },
  { id: "arb-mainnet", name: "Arbitrum", rpcBase: "https://arb-mainnet.g.alchemy.com/v2" },
  { id: "opt-mainnet", name: "Optimism", rpcBase: "https://opt-mainnet.g.alchemy.com/v2" },
  { id: "polygon-mainnet", name: "Polygon", rpcBase: "https://polygon-mainnet.g.alchemy.com/v2" },
] as const;

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
): Promise<{ funder: string; txHash: string; value: number } | null> {
  try {
    const data = (await alchemyRequest(chain.rpcBase, "alchemy_getAssetTransfers", [
      {
        fromBlock: "0x0",
        toAddress: wallet.toLowerCase(),
        category: ["external"],
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
        category: ["external"],
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
  opts: { maxPages?: number; maxTxs?: number } = {}
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
        category: ["external"],
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

        if (!data) break;

        const transfers = data.result?.transfers;
        if (!transfers || transfers.length === 0) break;

        const remaining = maxTxs - rows.length;
        rows.push(...transfers.slice(0, remaining));

        pageKey = data.result?.pageKey;
        pages++;
        if (!pageKey) break;
      } catch (err) {
        // Break pagination on error, return what we have
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

/** Batch check if addresses are contracts via eth_getCode */
export async function batchGetCode(
  addresses: string[],
  chain: Chain,
  batchSize: number = 200
): Promise<Map<string, boolean>> {
  const result = new Map<string, boolean>();
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

      if (!resp || !resp.ok) {
        chunk.forEach((addr) => result.set(addr, false));
        continue;
      }

      const responses: { id: number; result?: string }[] = await resp.json();
      const codeById = new Map<number, string>();
      for (const r of Array.isArray(responses) ? responses : [responses]) {
        if (r.id !== undefined) codeById.set(r.id, r.result || "0x");
      }

      chunk.forEach((addr, idx) => {
        const code = codeById.get(idx) || "0x";
        result.set(addr, code !== "0x" && code !== "0x0");
      });
    } catch {
      chunk.forEach((addr) => result.set(addr, false));
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
