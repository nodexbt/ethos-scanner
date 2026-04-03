import {
  CHAINS,
  type Chain,
  type AssetTransfer,
  getAllTransactions,
  batchGetCode,
  parallel,
  getFirstFunder,
} from "./alchemy";
import { fetchProfilesByAddresses, type EthosProfile } from "./ethos";

// --- Config ---

const MAX_PAGES = 50;
const CANDIDATE_MAX_PAGES = 6;
const CANDIDATE_MAX_TXS = 4000;
const MAX_CANDIDATES_PER_NETWORK = 150;
const MAX_EXCHANGE_CONTRACTS = 10;
const HUGE_TX_THRESHOLD = 15000;
const CONCURRENCY = 8;

// Scoring weights
const W_DIRECT = 4;
const W_REPEAT = 4;
const W_BIDIRECTIONAL = 3;
const W_SHARED_RARE = 3;
const W_SHARED_MEDIUM = 1;
const W_SHARED_POPULAR = -2;
const W_SHARED_FUNDER = 5;
const W_TIME_1H = 3;
const W_TIME_24H = 1;
const W_SIMILAR_AMOUNT = 2;

const POPULAR_THRESHOLD = 100;
const VERY_POPULAR_THRESHOLD = 1000;
const FINAL_SCORE_THRESHOLD = 8;
const POSSIBLE_SCORE_THRESHOLD = 4;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// --- Types ---

export type LogLevel = "info" | "success" | "warn" | "error";

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  message: string;
}

export interface Signal {
  type: string;
  score: number;
  details: string;
}

export interface FirstFunderInfo {
  chain: string;
  funder: string;
  txHash: string;
  value: number;
}

export interface ClusterCandidate {
  address: string; // primary address
  wallets: string[]; // all wallet addresses for this candidate (may be multiple if same Ethos profile)
  score: number;
  confidence: "high" | "medium" | "low";
  signals: Signal[];
  signalTypes: Set<string>;
  directCount: number;
  incomingCount: number;
  outgoingCount: number;
  bidirectional: boolean;
  repeatTransfer: boolean;
  sharedContracts: string[];
  sharedFundingSources: string[];
  sharedFirstFunder: boolean;
  firstFunders: FirstFunderInfo[];
  timeProximityHits: number;
  similarAmountHits: number;
  ethosProfile?: {
    profileId: number;
    displayName: string;
    username: string | null;
    avatarUrl: string;
    score: number;
    profileUrl: string;
  };
  networks: string[];
}

export interface ClusterScanResult {
  target: string;
  targetEthos?: {
    profileId: number;
    displayName: string;
    username: string | null;
    avatarUrl: string;
    score: number;
    profileUrl: string;
  };
  targetFirstFunders: FirstFunderInfo[];
  funderProfiles: Record<string, { displayName: string; username: string | null; avatarUrl: string; score: number; profileUrl: string }>;
  strongCluster: ClusterCandidate[];
  possibleCluster: ClusterCandidate[];
  networkStats: Record<string, { txCount: number; directWallets: number; contractClusters: number }>;
  logs: LogEntry[];
}

interface DirectWalletInfo {
  address: string;
  count: number;
  incomingCount: number;
  outgoingCount: number;
  timestamps: number[];
  values: number[];
  bidirectional: boolean;
  repeatTransfer: boolean;
}

interface ContractMeta {
  address: string;
  uniqueSenders: number;
  popularity: "rare" | "medium" | "popular" | "very_popular";
}

// --- Helpers ---

function normalizeAddress(addr: string | null | undefined): string | null {
  if (!addr || typeof addr !== "string") return null;
  const trimmed = addr.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

function transferTimestamp(tx: AssetTransfer): number {
  const ts = tx.metadata?.blockTimestamp;
  if (!ts) return 0;
  try {
    return Math.floor(new Date(ts).getTime() / 1000);
  } catch {
    return 0;
  }
}

function transferValue(tx: AssetTransfer): number {
  return tx.value ?? 0;
}

// --- Core Analysis Functions ---

function analyzeDirectTransfers(
  target: string,
  txs: AssetTransfer[],
  contractCache: Map<string, boolean>
): Map<string, DirectWalletInfo> {
  const result = new Map<string, DirectWalletInfo>();

  for (const tx of txs) {
    const from = normalizeAddress(tx.from);
    const to = normalizeAddress(tx.to);
    if (!from || !to || !([from, to].includes(target))) continue;

    const counterparty = from === target ? to : from;
    if (counterparty === target || counterparty === ZERO_ADDRESS) continue;
    if (contractCache.get(counterparty)) continue;

    const direction = from === target ? "out" : "in";
    const ts = transferTimestamp(tx);
    const val = transferValue(tx);

    let info = result.get(counterparty);
    if (!info) {
      info = {
        address: counterparty,
        count: 0,
        incomingCount: 0,
        outgoingCount: 0,
        timestamps: [],
        values: [],
        bidirectional: false,
        repeatTransfer: false,
      };
      result.set(counterparty, info);
    }

    info.count++;
    if (direction === "in") info.incomingCount++;
    else info.outgoingCount++;
    if (ts > 0) info.timestamps.push(ts);
    info.values.push(val);
  }

  for (const info of result.values()) {
    info.repeatTransfer = info.count > 1;
    info.bidirectional = info.incomingCount > 0 && info.outgoingCount > 0;
  }

  return result;
}

function getContractDestinations(
  target: string,
  txs: AssetTransfer[],
  contractCache: Map<string, boolean>
): string[] {
  const contracts = new Set<string>();
  for (const tx of txs) {
    const from = normalizeAddress(tx.from);
    const to = normalizeAddress(tx.to);
    if (from !== target || !to || to === target || to === ZERO_ADDRESS) continue;
    if (transferValue(tx) === 0) continue;
    if (contractCache.get(to)) contracts.add(to);
  }
  return [...contracts];
}

async function estimateContractPopularity(
  contractAddr: string,
  chain: Chain
): Promise<ContractMeta> {
  const senders = new Set<string>();
  try {
    const txs = await getAllTransactions(contractAddr, chain, { maxPages: 3, maxTxs: 3000 });
    for (const tx of txs) {
      const from = normalizeAddress(tx.from);
      const to = normalizeAddress(tx.to);
      if (to === contractAddr && from) senders.add(from);
      if (senders.size >= VERY_POPULAR_THRESHOLD) break;
    }
  } catch {
    // If we can't fetch, assume medium
  }

  const count = senders.size;
  let popularity: ContractMeta["popularity"] = "rare";
  if (count >= VERY_POPULAR_THRESHOLD) popularity = "very_popular";
  else if (count >= POPULAR_THRESHOLD) popularity = "popular";
  else if (count >= 10) popularity = "medium";

  return { address: contractAddr, uniqueSenders: count, popularity };
}

async function findWalletsSharingContracts(
  target: string,
  contracts: ContractMeta[],
  chain: Chain,
  contractCache: Map<string, boolean>
): Promise<Map<string, Set<string>>> {
  // Map: wallet -> set of shared contract addresses
  const candidates = new Map<string, Set<string>>();

  const scannableContracts = contracts
    .filter((c) => c.popularity !== "popular" && c.popularity !== "very_popular")
    .slice(0, MAX_EXCHANGE_CONTRACTS);

  await parallel(
    scannableContracts,
    async (contract) => {
      try {
        const txs = await getAllTransactions(contract.address, chain, {
          maxPages: 6,
          maxTxs: HUGE_TX_THRESHOLD,
        });

        if (txs.length >= HUGE_TX_THRESHOLD) return;

        let added = 0;
        for (const tx of txs) {
          const from = normalizeAddress(tx.from);
          const to = normalizeAddress(tx.to);
          if (to !== contract.address || !from || from === target) continue;
          if (contractCache.get(from)) continue;

          let set = candidates.get(from);
          if (!set) {
            set = new Set();
            candidates.set(from, set);
          }
          set.add(contract.address);
          added++;
          if (added >= 100) break;
        }
      } catch {
        // Skip failed contracts
      }
    },
    5
  );

  return candidates;
}

function findSharedFundingSources(
  target: string,
  targetTxs: AssetTransfer[],
  candidateWallets: string[],
  candidateTxsMap: Map<string, AssetTransfer[]>,
  contractCache: Map<string, boolean>
): Map<string, string[]> {
  function incomingSources(wallet: string, txs: AssetTransfer[]): Set<string> {
    const sources = new Set<string>();
    for (const tx of txs) {
      const from = normalizeAddress(tx.from);
      const to = normalizeAddress(tx.to);
      if (to !== wallet || !from || from === wallet || from === ZERO_ADDRESS) continue;
      if (contractCache.get(from)) continue;
      sources.add(from);
    }
    return sources;
  }

  const targetSources = incomingSources(target, targetTxs);
  const result = new Map<string, string[]>();

  for (const wallet of candidateWallets) {
    const walletTxs = candidateTxsMap.get(wallet);
    if (!walletTxs) continue;
    const walletSources = incomingSources(wallet, walletTxs);
    const shared: string[] = [];
    for (const src of targetSources) {
      if (walletSources.has(src)) shared.push(src);
    }
    if (shared.length > 0) result.set(wallet, shared.sort());
  }

  return result;
}

function estimateTimeProximity(
  target: string,
  candidate: string,
  targetTxs: AssetTransfer[],
  candidateTxs: AssetTransfer[]
): { hits1h: number; hits24h: number } {
  function outgoingTimestamps(wallet: string, txs: AssetTransfer[]): number[] {
    return txs
      .filter((tx) => normalizeAddress(tx.from) === wallet)
      .map(transferTimestamp)
      .filter((ts) => ts > 0)
      .sort((a, b) => a - b);
  }

  const t1 = outgoingTimestamps(target, targetTxs);
  const t2 = outgoingTimestamps(candidate, candidateTxs);
  let hits1h = 0;
  let hits24h = 0;

  let j = 0;
  for (const x of t1) {
    while (j < t2.length && t2[j] < x - 86400) j++;
    let k = j;
    while (k < t2.length && t2[k] <= x + 86400) {
      const diff = Math.abs(t2[k] - x);
      if (diff <= 3600) hits1h++;
      else hits24h++;
      k++;
    }
  }

  return { hits1h, hits24h };
}

function estimateAmountSimilarity(
  target: string,
  candidate: string,
  targetTxs: AssetTransfer[],
  candidateTxs: AssetTransfer[]
): number {
  function outgoingValues(wallet: string, txs: AssetTransfer[]): number[] {
    return txs
      .filter((tx) => normalizeAddress(tx.from) === wallet)
      .map(transferValue)
      .filter((v) => v > 0);
  }

  const a = outgoingValues(target, targetTxs).slice(0, 50);
  const b = outgoingValues(candidate, candidateTxs).slice(0, 50);
  let hits = 0;

  for (const x of a) {
    for (const y of b) {
      if (x === 0 || y === 0) continue;
      const rel = Math.abs(x - y) / Math.max(x, y);
      if (rel <= 0.10) {
        hits++;
        break;
      }
    }
  }

  return hits;
}

// --- Scoring ---

const W_SHARED_FIRST_FUNDER = 6;

function scoreCandidate(
  address: string,
  directInfo: DirectWalletInfo | undefined,
  sharedContracts: { address: string; popularity: string }[],
  sharedFunders: string[],
  sharedFirstFunder: boolean,
  candidateFirstFunders: FirstFunderInfo[],
  timeProx: { hits1h: number; hits24h: number },
  amountHits: number,
  network: string
): ClusterCandidate {
  const signals: Signal[] = [];
  const signalTypes = new Set<string>();

  function addSignal(type: string, score: number, details: string) {
    signals.push({ type, score, details });
    signalTypes.add(type);
  }

  if (directInfo) {
    addSignal("direct_transfer", W_DIRECT, `count=${directInfo.count}`);
    if (directInfo.repeatTransfer) addSignal("repeat_transfer", W_REPEAT, "count>1");
    if (directInfo.bidirectional) addSignal("bidirectional", W_BIDIRECTIONAL, "in>0 and out>0");
  }

  for (const contract of sharedContracts) {
    let score: number;
    if (contract.popularity === "rare") score = W_SHARED_RARE;
    else if (contract.popularity === "medium") score = W_SHARED_MEDIUM;
    else score = W_SHARED_POPULAR;
    addSignal("shared_contract", score, `${contract.address} popularity=${contract.popularity}`);
  }

  if (sharedFirstFunder) {
    addSignal("shared_first_funder", W_SHARED_FIRST_FUNDER, "same first funder on at least one chain");
  }

  if (sharedFunders.length > 0) {
    addSignal("shared_incoming_sender", W_SHARED_FUNDER, `senders=${sharedFunders.length}`);
  }

  if (timeProx.hits1h > 0) {
    addSignal("time_proximity_1h", W_TIME_1H, `hits=${timeProx.hits1h}`);
  } else if (timeProx.hits24h > 0) {
    addSignal("time_proximity_24h", W_TIME_24H, `hits=${timeProx.hits24h}`);
  }

  if (amountHits > 0) {
    addSignal("similar_amount", W_SIMILAR_AMOUNT, `hits=${amountHits}`);
  }

  const totalScore = signals.reduce((sum, s) => sum + s.score, 0);
  let confidence: "high" | "medium" | "low" = "low";
  if (totalScore >= FINAL_SCORE_THRESHOLD && signalTypes.size >= 2) confidence = "high";
  else if (totalScore >= POSSIBLE_SCORE_THRESHOLD) confidence = "medium";

  return {
    address,
    wallets: [address],
    score: totalScore,
    confidence,
    signals,
    signalTypes,
    directCount: directInfo?.count ?? 0,
    incomingCount: directInfo?.incomingCount ?? 0,
    outgoingCount: directInfo?.outgoingCount ?? 0,
    bidirectional: directInfo?.bidirectional ?? false,
    repeatTransfer: directInfo?.repeatTransfer ?? false,
    sharedContracts: sharedContracts.map((c) => c.address),
    sharedFundingSources: sharedFunders,
    sharedFirstFunder,
    firstFunders: candidateFirstFunders,
    timeProximityHits: timeProx.hits1h + timeProx.hits24h,
    similarAmountHits: amountHits,
    networks: [network],
  };
}

// --- Network Scan ---

async function scanNetwork(
  target: string,
  chain: Chain,
  log: (level: LogLevel, message: string) => void,
  stepDone?: (phase: string) => void
): Promise<{
  directWallets: Map<string, DirectWalletInfo>;
  contractClusterWallets: Map<string, Set<string>>;
  candidates: Map<string, ClusterCandidate>;
  txCount: number;
  targetFirstFunder: FirstFunderInfo | null;
}> {
  const network = chain.name;

  // Step 1: Fetch target transactions
  log("info", `[${network}] Fetching target transactions...`);
  const txs = await getAllTransactions(target, chain, { maxPages: MAX_PAGES });
  log("info", `[${network}] ${txs.length} transactions fetched`);
  stepDone?.(`${network}: Fetched transactions`);

  if (txs.length === 0) {
    // Mark remaining 6 steps done for this network
    for (let i = 0; i < STEPS_PER_NETWORK - 1; i++) stepDone?.(`${network}: Skipped (no txs)`);
    return {
      directWallets: new Map(),
      contractClusterWallets: new Map(),
      candidates: new Map(),
      txCount: 0,
      targetFirstFunder: null,
    };
  }

  // Step 2: Build contract cache for counterparties
  const counterparties = new Set<string>();
  for (const tx of txs) {
    const from = normalizeAddress(tx.from);
    const to = normalizeAddress(tx.to);
    if (from && from !== target) counterparties.add(from);
    if (to && to !== target) counterparties.add(to);
  }

  log("info", `[${network}] Checking ${counterparties.size} addresses for contract status...`);
  const contractCacheRaw = await batchGetCode([...counterparties], chain);
  const contractCache = new Map<string, boolean>();
  for (const [addr, isContract] of contractCacheRaw) {
    contractCache.set(addr, isContract);
  }

  // Step 3: Direct transfer analysis
  log("info", `[${network}] Analyzing direct transfers...`);
  const directWallets = analyzeDirectTransfers(target, txs, contractCache);
  log("success", `[${network}] ${directWallets.size} direct EOA wallets found`);
  stepDone?.(`${network}: Direct transfers analyzed`);

  // Step 4: Find contract destinations + popularity
  log("info", `[${network}] Analyzing contract destinations...`);
  const contractDests = getContractDestinations(target, txs, contractCache);
  log("info", `[${network}] ${contractDests.length} contract destinations found`);

  const contractMetas: ContractMeta[] = [];
  if (contractDests.length > 0) {
    log("info", `[${network}] Estimating contract popularity...`);
    const metas = await parallel(
      contractDests.slice(0, MAX_EXCHANGE_CONTRACTS),
      (addr) => estimateContractPopularity(addr, chain),
      5
    );
    contractMetas.push(...metas);
    for (const m of contractMetas) {
      log("info", `[${network}] ${m.address.slice(0, 10)}... senders=${m.uniqueSenders} popularity=${m.popularity}`);
    }
  }
  stepDone?.(`${network}: Contract popularity estimated`);

  // Step 5: Find wallets sharing contracts
  log("info", `[${network}] Scanning for wallets sharing contracts...`);
  const contractClusterWallets = await findWalletsSharingContracts(
    target,
    contractMetas,
    chain,
    contractCache
  );
  for (const addr of directWallets.keys()) {
    contractClusterWallets.delete(addr);
  }
  log("success", `[${network}] ${contractClusterWallets.size} wallets found via shared contracts`);
  stepDone?.(`${network}: Shared contracts scanned`);

  // Step 6: Fetch candidate transactions
  const allCandidateAddrs = [
    ...new Set([...directWallets.keys(), ...contractClusterWallets.keys()]),
  ].slice(0, MAX_CANDIDATES_PER_NETWORK);

  log("info", `[${network}] Fetching transactions for ${allCandidateAddrs.length} candidates...`);
  const candidateTxsMap = new Map<string, AssetTransfer[]>();
  candidateTxsMap.set(target, txs);

  await parallel(
    allCandidateAddrs,
    async (addr) => {
      const candTxs = await getAllTransactions(addr, chain, {
        maxPages: CANDIDATE_MAX_PAGES,
        maxTxs: CANDIDATE_MAX_TXS,
      });
      candidateTxsMap.set(addr, candTxs);
    },
    CONCURRENCY
  );
  stepDone?.(`${network}: Candidate transactions fetched`);

  // Step 7: Shared funding sources
  log("info", `[${network}] Checking shared funding sources...`);
  const sharedFunding = findSharedFundingSources(
    target,
    txs,
    allCandidateAddrs,
    candidateTxsMap,
    contractCache
  );
  log("info", `[${network}] ${sharedFunding.size} wallets share funding sources`);

  // Step 8: First funder analysis
  log("info", `[${network}] Checking first funders for target + ${allCandidateAddrs.length} candidates...`);

  // Fetch first funder for target
  const targetFirstFunder = await getFirstFunder(target, chain);
  if (targetFirstFunder) {
    log("info", `[${network}] Target first funder: ${targetFirstFunder.funder.slice(0, 10)}... (${targetFirstFunder.value} ETH)`);
  }

  // Fetch first funders for all candidates in parallel
  const candidateFirstFunders = new Map<string, FirstFunderInfo>();
  await parallel(
    allCandidateAddrs,
    async (addr) => {
      const ff = await getFirstFunder(addr, chain);
      if (ff) {
        candidateFirstFunders.set(addr, {
          chain: network,
          funder: ff.funder,
          txHash: ff.txHash,
          value: ff.value,
        });
      }
    },
    CONCURRENCY
  );

  // Check which candidates share first funder with target
  const sharedFirstFunderAddrs = new Set<string>();
  if (targetFirstFunder) {
    for (const [addr, ff] of candidateFirstFunders) {
      if (ff.funder === targetFirstFunder.funder) {
        sharedFirstFunderAddrs.add(addr);
        log("warn", `[${network}] Shared first funder! ${addr.slice(0, 10)}... and target both funded by ${ff.funder.slice(0, 10)}...`);
      }
    }
  }

  log("info", `[${network}] ${sharedFirstFunderAddrs.size} candidates share first funder with target`);

  // Step 9: Scoring
  log("info", `[${network}] Scoring candidates...`);
  const contractPopMap = new Map(contractMetas.map((m) => [m.address, m]));
  const candidates = new Map<string, ClusterCandidate>();

  for (const addr of allCandidateAddrs) {
    const directInfo = directWallets.get(addr);
    const sharedContractAddrs = contractClusterWallets.get(addr);
    const sharedContracts = sharedContractAddrs
      ? [...sharedContractAddrs].map((ca) => ({
          address: ca,
          popularity: contractPopMap.get(ca)?.popularity ?? "medium",
        }))
      : [];
    const sharedFunders = sharedFunding.get(addr) ?? [];
    const hasSharedFirstFunder = sharedFirstFunderAddrs.has(addr);
    const candFF = candidateFirstFunders.get(addr);
    const candFirstFunders: FirstFunderInfo[] = candFF ? [candFF] : [];

    const candTxs = candidateTxsMap.get(addr) ?? [];
    const timeProx = estimateTimeProximity(target, addr, txs, candTxs);
    const amountHits = estimateAmountSimilarity(target, addr, txs, candTxs);

    const candidate = scoreCandidate(
      addr,
      directInfo,
      sharedContracts,
      sharedFunders,
      hasSharedFirstFunder,
      candFirstFunders,
      timeProx,
      amountHits,
      network
    );

    if (candidate.score >= POSSIBLE_SCORE_THRESHOLD) {
      candidates.set(addr, candidate);
    }
  }

  const strong = [...candidates.values()].filter((c) => c.confidence === "high").length;
  const possible = [...candidates.values()].filter((c) => c.confidence === "medium").length;
  log("success", `[${network}] Scoring complete: ${strong} strong, ${possible} possible`);
  stepDone?.(`${network}: Scoring complete`);

  const targetFF: FirstFunderInfo | null = targetFirstFunder
    ? { chain: network, funder: targetFirstFunder.funder, txHash: targetFirstFunder.txHash, value: targetFirstFunder.value }
    : null;

  return { directWallets, contractClusterWallets, candidates, txCount: txs.length, targetFirstFunder: targetFF };
}

// --- Main Entry Point ---

export interface ScanProgress {
  stepsCompleted: number;
  totalSteps: number;
  percent: number;
  elapsed: number;
  estimatedRemaining: number | null;
  phase: string;
}

const STEPS_PER_NETWORK = 8;
const ETHOS_STEPS = 1;

export async function runClusterScan(
  targetAddress: string,
  onLog?: (entry: LogEntry) => void,
  onProgress?: (progress: ScanProgress) => void
): Promise<ClusterScanResult> {
  const logs: LogEntry[] = [];
  const log = (level: LogLevel, message: string) => {
    const entry: LogEntry = { timestamp: Date.now(), level, message };
    logs.push(entry);
    onLog?.(entry);
  };

  const totalNetworks = CHAINS.length;
  const totalSteps = totalNetworks * STEPS_PER_NETWORK + ETHOS_STEPS;
  const progress = { steps: 0, start: Date.now() };

  function emitProgress(phase: string) {
    const elapsed = Date.now() - progress.start;
    const rate = progress.steps > 0 ? elapsed / progress.steps : 0;
    const remaining = progress.steps > 0 ? Math.round(rate * (totalSteps - progress.steps)) : null;
    onProgress?.({
      stepsCompleted: progress.steps,
      totalSteps,
      percent: Math.round((progress.steps / totalSteps) * 100),
      elapsed,
      estimatedRemaining: remaining,
      phase,
    });
  }

  function stepDone(phase: string) {
    progress.steps++;
    emitProgress(phase);
  }

  const target = targetAddress.toLowerCase();
  log("info", `Starting cluster scan for ${target}`);
  log("info", `Networks: ${CHAINS.map((c) => c.name).join(", ")}`);
  emitProgress("Starting...");

  // Scan networks in parallel (2 at a time to avoid connection overload)
  const networkResults = await parallel(
    [...CHAINS],
    async (chain) => {
      try {
        const result = await scanNetwork(target, chain, log, stepDone);
        return { chain, result, error: null };
      } catch (err) {
        log("error", `[${chain.name}] Network scan failed: ${err instanceof Error ? err.message : String(err)}`);
        // Mark remaining steps for this network as done
        for (let i = 0; i < STEPS_PER_NETWORK; i++) stepDone(chain.name);
        return { chain, result: null, error: err };
      }
    },
    5
  );

  // Merge candidates across networks
  const mergedCandidates = new Map<string, ClusterCandidate>();
  const networkStats: ClusterScanResult["networkStats"] = {};
  const allTargetFirstFunders: FirstFunderInfo[] = [];

  for (const { chain, result } of networkResults) {
    if (!result) {
      networkStats[chain.name] = { txCount: 0, directWallets: 0, contractClusters: 0 };
      continue;
    }

    networkStats[chain.name] = {
      txCount: result.txCount,
      directWallets: result.directWallets.size,
      contractClusters: result.contractClusterWallets.size,
    };

    if (result.targetFirstFunder) {
      allTargetFirstFunders.push(result.targetFirstFunder);
    }

    for (const [addr, candidate] of result.candidates) {
      const existing = mergedCandidates.get(addr);
      if (existing) {
        // Merge: take highest score, combine signals, networks, and first funders
        if (candidate.score > existing.score) {
          const networks = [...new Set([...existing.networks, ...candidate.networks])];
          const firstFunders = [...existing.firstFunders, ...candidate.firstFunders];
          const sharedFF = existing.sharedFirstFunder || candidate.sharedFirstFunder;
          mergedCandidates.set(addr, { ...candidate, networks, firstFunders, sharedFirstFunder: sharedFF });
        } else {
          existing.networks = [...new Set([...existing.networks, ...candidate.networks])];
          existing.firstFunders = [...existing.firstFunders, ...candidate.firstFunders];
          existing.sharedFirstFunder = existing.sharedFirstFunder || candidate.sharedFirstFunder;
        }
      } else {
        mergedCandidates.set(addr, candidate);
      }
    }
  }

  // Split into strong vs possible
  const strongCluster = [...mergedCandidates.values()]
    .filter((c) => c.confidence === "high")
    .sort((a, b) => b.score - a.score);
  const possibleCluster = [...mergedCandidates.values()]
    .filter((c) => c.confidence === "medium")
    .sort((a, b) => b.score - a.score);

  log("info", `Total: ${strongCluster.length} strong, ${possibleCluster.length} possible candidates`);

  // Bulk Ethos lookup for target + all candidates + all first funders
  const allCandidateAddrs = [...strongCluster, ...possibleCluster].map((c) => c.address);
  const allFirstFunderAddrs = [
    ...allTargetFirstFunders.map((f) => f.funder),
    ...[...strongCluster, ...possibleCluster].flatMap((c) => (c.firstFunders || []).map((f) => f.funder)),
  ];
  const ethosAddresses = [...new Set([target, ...allCandidateAddrs, ...allFirstFunderAddrs])];
  log("info", `Checking ${ethosAddresses.length} addresses on Ethos Network (bulk)...`);

  const ethosMap = await fetchProfilesByAddresses(ethosAddresses);
  log("info", `Found ${ethosMap.size} Ethos profiles`);

  function toEthosData(profile: EthosProfile) {
    return {
      profileId: profile.profileId!,
      displayName: profile.displayName,
      username: profile.username,
      avatarUrl: profile.avatarUrl,
      score: profile.score,
      profileUrl: profile.username
        ? `https://app.ethos.network/profile/x/${profile.username}`
        : `https://app.ethos.network/profile/${profile.profileId}`,
    };
  }

  let targetEthos: ClusterScanResult["targetEthos"];
  const targetProfile = ethosMap.get(target);
  if (targetProfile && targetProfile.profileId) {
    targetEthos = toEthosData(targetProfile);
    log("success", `Target has Ethos profile: ${targetProfile.displayName} (score: ${targetProfile.score})`);
  }

  for (const addr of allCandidateAddrs) {
    const profile = ethosMap.get(addr);
    if (!profile || !profile.profileId) continue;
    const candidate = mergedCandidates.get(addr);
    if (candidate) {
      candidate.ethosProfile = toEthosData(profile);
      log("warn", `Cluster wallet ${addr.slice(0, 10)}... is Ethos user: ${profile.displayName} (score: ${profile.score})`);
    }
  }

  // Build funder profiles map for any first funder that has an Ethos profile
  const funderProfiles: ClusterScanResult["funderProfiles"] = {};
  for (const funderAddr of allFirstFunderAddrs) {
    if (funderProfiles[funderAddr]) continue;
    const profile = ethosMap.get(funderAddr);
    if (profile && profile.profileId) {
      const data = toEthosData(profile);
      funderProfiles[funderAddr] = {
        displayName: data.displayName,
        username: data.username,
        avatarUrl: data.avatarUrl,
        score: data.score,
        profileUrl: data.profileUrl,
      };
      log("info", `First funder ${funderAddr.slice(0, 10)}... is Ethos user: ${profile.displayName}`);
    }
  }

  // Filter to only candidates with Ethos profiles, exclude target's own profile,
  // and merge candidates that belong to the same Ethos profile
  const targetProfileId = targetEthos?.profileId;

  function dedupeByProfile(candidates: ClusterCandidate[]): ClusterCandidate[] {
    const withEthos = candidates.filter(
      (c) => c.ethosProfile && c.ethosProfile.profileId !== targetProfileId
    );
    const byProfileId = new Map<number, ClusterCandidate>();
    for (const c of withEthos) {
      const pid = c.ethosProfile!.profileId;
      const existing = byProfileId.get(pid);
      if (existing) {
        // Merge into existing: combine wallets, take highest score, merge signals
        existing.wallets = [...new Set([...existing.wallets, ...c.wallets])];
        existing.networks = [...new Set([...existing.networks, ...c.networks])];
        existing.firstFunders = [...existing.firstFunders, ...c.firstFunders];
        existing.sharedFundingSources = [...new Set([...existing.sharedFundingSources, ...c.sharedFundingSources])];
        existing.sharedContracts = [...new Set([...existing.sharedContracts, ...c.sharedContracts])];
        existing.sharedFirstFunder = existing.sharedFirstFunder || c.sharedFirstFunder;
        existing.directCount += c.directCount;
        existing.incomingCount += c.incomingCount;
        existing.outgoingCount += c.outgoingCount;
        existing.bidirectional = existing.bidirectional || c.bidirectional;
        existing.repeatTransfer = existing.repeatTransfer || c.repeatTransfer;
        existing.timeProximityHits += c.timeProximityHits;
        existing.similarAmountHits += c.similarAmountHits;
        // Keep highest scoring signals
        if (c.score > existing.score) {
          existing.score = c.score;
          existing.confidence = c.confidence;
          existing.signals = c.signals;
          existing.signalTypes = c.signalTypes;
        }
      } else {
        byProfileId.set(pid, { ...c });
      }
    }
    return [...byProfileId.values()].sort((a, b) => b.score - a.score);
  }

  const strongWithEthos = dedupeByProfile(strongCluster);
  const possibleWithEthos = dedupeByProfile(possibleCluster);
  log("info", `${strongWithEthos.length} strong and ${possibleWithEthos.length} possible candidates have Ethos profiles (deduped)`);
  stepDone("Ethos lookup complete");
  const totalElapsed = Date.now() - progress.start;
  const mins = Math.floor(totalElapsed / 60000);
  const secs = Math.round((totalElapsed % 60000) / 1000);
  const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  log("success", `Cluster scan complete in ${timeStr}`);

  return {
    target,
    targetEthos,
    targetFirstFunders: allTargetFirstFunders,
    funderProfiles,
    strongCluster: strongWithEthos,
    possibleCluster: possibleWithEthos,
    networkStats,
    logs,
  };
}