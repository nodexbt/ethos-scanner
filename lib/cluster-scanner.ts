import {
  CHAINS,
  type Chain,
  type AssetTransfer,
  getAllTransactions,
  batchGetCode,
  parallel,
  getFirstFunder,
  getOutgoingTransfers,
  getContractName,
} from "./alchemy";
import { fetchProfilesByAddresses, fetchInvitationTree, fetchActivities, type EthosProfile, type Invitation, type ReviewActivity } from "./ethos";
import { getAddressLabel, isExchangeAddress } from "./known-addresses";

// --- Config ---

const MAX_PAGES = 50;
const CANDIDATE_MAX_PAGES = 6;
const CANDIDATE_MAX_TXS = 4000;
const MAX_CANDIDATES_PER_NETWORK = 50;
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

const POPULAR_THRESHOLD = 100;
const VERY_POPULAR_THRESHOLD = 1000;
const FINAL_SCORE_THRESHOLD = 15;
const POSSIBLE_SCORE_THRESHOLD = 8;

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
  funderLabel: string | null; // e.g. "Kraken", "Binance", "Base Bridge"
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
  crossClusterContracts: { contract: string; contractName: string | null; sharedWith: string[]; network: string }[];
  sharedCexDeposits: SharedCexDeposit[];
  invitedByTarget: boolean;
  invitedTarget: boolean;
  mutualReviews: boolean;
  mutualVouches: boolean;
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
  sharedDeposits: { contract: string; contractName: string | null; wallets: string[]; network: string }[];
  sharedCexDeposits: SharedCexDeposit[];
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



// --- Scoring ---

const W_SHARED_FIRST_FUNDER = 8;
const W_SHARED_EXCHANGE_FUNDER = 5; // same exact exchange hot wallet funded both
const W_FUNDED_BY_TARGET = 10;
const W_FUNDED_BY_CLUSTER = 10;

function scoreCandidate(
  address: string,
  target: string,
  directInfo: DirectWalletInfo | undefined,
  sharedContracts: { address: string; popularity: string }[],
  sharedFunders: string[],
  sharedFirstFunder: boolean,
  fundedByTarget: boolean,
  fundedByClusterWallet: boolean,
  candidateFirstFunders: FirstFunderInfo[],
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

  if (fundedByTarget) {
    addSignal("funded_by_target", W_FUNDED_BY_TARGET, "first funded by the scanned wallet");
  } else if (fundedByClusterWallet) {
    addSignal("funded_by_cluster", W_FUNDED_BY_CLUSTER, "first funded by another wallet in the results");
  } else if (sharedFirstFunder) {
    // Check if the shared funder is an exchange hot wallet
    const sharedFunderAddr = candidateFirstFunders.find(() => true)?.funder;
    const isExchange = sharedFunderAddr ? isExchangeAddress(sharedFunderAddr) : false;
    if (isExchange) {
      const label = getAddressLabel(sharedFunderAddr!) || "exchange";
      addSignal("shared_exchange_funder", W_SHARED_EXCHANGE_FUNDER, `same ${label} withdrawal address`);
    } else {
      addSignal("shared_first_funder", W_SHARED_FIRST_FUNDER, "same first funder on at least one chain");
    }
  }

  if (sharedFunders.length > 0) {
    addSignal("shared_incoming_sender", W_SHARED_FUNDER, `senders=${sharedFunders.length}`);
  }

  const totalScore = signals.reduce((sum, s) => sum + s.score, 0);
  let confidence: "high" | "medium" | "low" = "low";
  if (fundedByTarget || fundedByClusterWallet) confidence = "high";
  else if (totalScore >= FINAL_SCORE_THRESHOLD && signalTypes.size >= 2) confidence = "high";
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
    crossClusterContracts: [],
    sharedCexDeposits: [],
    invitedByTarget: false,
    invitedTarget: false,
    mutualReviews: false,
    mutualVouches: false,
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
  candidateTxs: Map<string, AssetTransfer[]>;
  contractCache: Map<string, boolean>;
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
      candidateTxs: new Map(),
      contractCache: new Map(),
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

  // Step 6: Pre-score candidates using direct transfer + shared contract data only
  const allCandidateAddrsRaw = [
    ...new Set([...directWallets.keys(), ...contractClusterWallets.keys()]),
  ].slice(0, MAX_CANDIDATES_PER_NETWORK);

  const contractPopMap = new Map(contractMetas.map((m) => [m.address, m]));
  const PRE_SCORE_THRESHOLD = 3; // minimum to warrant deep scan

  const promisingCandidates: string[] = [];
  for (const addr of allCandidateAddrsRaw) {
    let preScore = 0;
    const directInfo = directWallets.get(addr);
    if (directInfo) {
      preScore += W_DIRECT;
      if (directInfo.repeatTransfer) preScore += W_REPEAT;
      if (directInfo.bidirectional) preScore += W_BIDIRECTIONAL;
    }
    const sharedContractAddrs = contractClusterWallets.get(addr);
    if (sharedContractAddrs) {
      for (const ca of sharedContractAddrs) {
        const pop = contractPopMap.get(ca)?.popularity ?? "medium";
        if (pop === "rare") preScore += W_SHARED_RARE;
        else if (pop === "medium") preScore += W_SHARED_MEDIUM;
      }
    }
    if (preScore >= PRE_SCORE_THRESHOLD) {
      promisingCandidates.push(addr);
    }
  }

  log("info", `[${network}] Pre-scored ${allCandidateAddrsRaw.length} candidates, ${promisingCandidates.length} promising (pre-score >= ${PRE_SCORE_THRESHOLD})`);
  const allCandidateAddrs = promisingCandidates;
  stepDone?.(`${network}: Pre-scoring complete`);

  // Step 7: Fetch candidate transactions (only for promising candidates)
  log("info", `[${network}] Fetching transactions for ${allCandidateAddrs.length} promising candidates...`);
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

  // Step 8: Shared funding sources
  log("info", `[${network}] Checking shared funding sources...`);
  const sharedFunding = findSharedFundingSources(
    target,
    txs,
    allCandidateAddrs,
    candidateTxsMap,
    contractCache
  );
  log("info", `[${network}] ${sharedFunding.size} wallets share funding sources`);

  // Step 9: First funder analysis (only for promising candidates)
  log("info", `[${network}] Checking first funders for target + ${allCandidateAddrs.length} candidates...`);

  const targetFirstFunder = await getFirstFunder(target, chain);
  if (targetFirstFunder) {
    log("info", `[${network}] Target first funder: ${targetFirstFunder.funder.slice(0, 10)}... (${targetFirstFunder.value} ETH)`);
  }

  const candidateFirstFunders = new Map<string, FirstFunderInfo>();
  await parallel(
    allCandidateAddrs,
    async (addr) => {
      const ff = await getFirstFunder(addr, chain);
      if (ff) {
        candidateFirstFunders.set(addr, {
          chain: network,
          funder: ff.funder,
          funderLabel: getAddressLabel(ff.funder),
          txHash: ff.txHash,
          value: ff.value,
        });
      }
    },
    CONCURRENCY
  );

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

  // Step 10: Final scoring
  log("info", `[${network}] Scoring candidates...`);
  const candidates = new Map<string, ClusterCandidate>();

  const allCandFirstFunderAddrs = new Map<string, string>();
  for (const [addr, ff] of candidateFirstFunders) {
    allCandFirstFunderAddrs.set(ff.funder, addr);
  }

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

    const isFundedByTarget = candFF?.funder === target;
    const isFundedByCluster = !isFundedByTarget && candFF
      ? allCandidateAddrs.some((other) => other !== addr && other === candFF.funder)
      : false;

    const candidate = scoreCandidate(
      addr,
      target,
      directInfo,
      sharedContracts,
      sharedFunders,
      hasSharedFirstFunder,
      isFundedByTarget,
      isFundedByCluster,
      candFirstFunders,
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
    ? { chain: network, funder: targetFirstFunder.funder, funderLabel: getAddressLabel(targetFirstFunder.funder), txHash: targetFirstFunder.txHash, value: targetFirstFunder.value }
    : null;

  return { directWallets, contractClusterWallets, candidates, candidateTxs: candidateTxsMap, contractCache, txCount: txs.length, targetFirstFunder: targetFF };
}

// --- Shared CEX deposit address detection ---

export interface SharedCexDeposit {
  depositAddress: string;
  exchange: string;
  wallets: string[];
  network: string;
}

function findSharedEoaDestinations(
  clusterWallets: string[],
  txsByNetwork: Map<string, Map<string, AssetTransfer[]>>,
  contractCacheByNetwork: Map<string, Map<string, boolean>>,
): Map<string, { wallets: Set<string>; network: string }> {
  // Find EOA addresses that 2+ cluster wallets sent to
  const sharedDests = new Map<string, { wallets: Set<string>; network: string }>();

  for (const [network, txsMap] of txsByNetwork) {
    const contractCache = contractCacheByNetwork.get(network) || new Map();
    const destToWallets = new Map<string, Set<string>>();

    for (const wallet of clusterWallets) {
      const txs = txsMap.get(wallet);
      if (!txs) continue;

      for (const tx of txs) {
        const from = normalizeAddress(tx.from);
        const to = normalizeAddress(tx.to);
        if (from !== wallet || !to || to === wallet) continue;
        if (to === ZERO_ADDRESS) continue;
        if (contractCache.get(to)) continue; // skip contracts, we want EOAs only
        if (clusterWallets.includes(to)) continue; // skip other cluster wallets

        let set = destToWallets.get(to);
        if (!set) {
          set = new Set();
          destToWallets.set(to, set);
        }
        set.add(wallet);
      }
    }

    for (const [dest, wallets] of destToWallets) {
      if (wallets.size >= 2) {
        const existing = sharedDests.get(dest);
        if (existing) {
          for (const w of wallets) existing.wallets.add(w);
        } else {
          sharedDests.set(dest, { wallets: new Set(wallets), network });
        }
      }
    }
  }

  return sharedDests;
}

async function verifyCexDepositAddresses(
  sharedDests: Map<string, { wallets: Set<string>; network: string }>,
  log: (level: LogLevel, message: string) => void,
): Promise<SharedCexDeposit[]> {
  const results: SharedCexDeposit[] = [];
  const destsToCheck = [...sharedDests.entries()].slice(0, 30); // limit API calls

  await parallel(
    destsToCheck,
    async ([destAddr, { wallets, network }]) => {
      // First check if the dest itself is a known exchange address
      const directLabel = getAddressLabel(destAddr);
      if (directLabel && !directLabel.includes("Bridge")) {
        results.push({
          depositAddress: destAddr,
          exchange: directLabel,
          wallets: [...wallets].sort(),
          network,
        });
        return;
      }

      // Check if this address forwarded funds to a known exchange
      // Fetch outgoing transfers from this address on Base
      const chain = CHAINS.find((c) => c.name === network) || CHAINS[0];
      try {
        const outgoing = await getOutgoingTransfers(destAddr, chain, 20);
        for (const tx of outgoing) {
          const label = getAddressLabel(tx.to);
          if (label && !label.includes("Bridge")) {
            results.push({
              depositAddress: destAddr,
              exchange: label,
              wallets: [...wallets].sort(),
              network,
            });
            return; // found exchange, done with this address
          }
        }
      } catch {}
    },
    5
  );

  return results;
}

// --- Cross-cluster shared deposit analysis ---

function findSharedDeposits(
  clusterWallets: string[],
  txsByNetwork: Map<string, Map<string, AssetTransfer[]>>,
  contractCacheByNetwork: Map<string, Map<string, boolean>>,
): { contract: string; contractName: string | null; wallets: string[]; network: string }[] {
  const results: { contract: string; contractName: string | null; wallets: string[]; network: string }[] = [];

  for (const [network, txsMap] of txsByNetwork) {
    const contractCache = contractCacheByNetwork.get(network) || new Map();

    // For each cluster wallet, collect contracts they deposited to
    const walletContracts = new Map<string, Set<string>>(); // contract -> set of wallets

    for (const wallet of clusterWallets) {
      const txs = txsMap.get(wallet);
      if (!txs) continue;

      for (const tx of txs) {
        const from = normalizeAddress(tx.from);
        const to = normalizeAddress(tx.to);
        if (from !== wallet || !to || to === wallet) continue;
        if (to === ZERO_ADDRESS) continue;
        if (!contractCache.get(to)) continue; // only contracts

        let set = walletContracts.get(to);
        if (!set) {
          set = new Set();
          walletContracts.set(to, set);
        }
        set.add(wallet);
      }
    }

    // Filter to contracts used by 2+ cluster members
    for (const [contract, wallets] of walletContracts) {
      if (wallets.size >= 2) {
        results.push({ contract, contractName: null, wallets: [...wallets].sort(), network });
      }
    }
  }

  // Dedupe by contract (might appear on multiple networks)
  const seen = new Set<string>();
  return results.filter((r) => {
    const key = `${r.contract}:${r.network}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => b.wallets.length - a.wallets.length);
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

const STEPS_PER_NETWORK = 9;
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
  const txsByNetwork = new Map<string, Map<string, AssetTransfer[]>>();
  const contractCacheByNetwork = new Map<string, Map<string, boolean>>();

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

    txsByNetwork.set(chain.name, result.candidateTxs);
    contractCacheByNetwork.set(chain.name, result.contractCache);

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

  // Ethos social analysis: invitations, reviews, vouches
  const allWithEthos = [...strongWithEthos, ...possibleWithEthos];
  const candidateProfileIds = new Set(
    allWithEthos.map((c) => c.ethosProfile?.profileId).filter((id): id is number => !!id)
  );

  const targetDisplayName = targetEthos?.displayName || target.slice(0, 10) + "...";

  if (targetProfileId && candidateProfileIds.size > 0) {
    log("info", `Checking Ethos social connections (invitations, reviews, vouches)...`);

    try {
      // Fetch target's invitation tree
      const targetInvitations = await fetchInvitationTree(targetProfileId);
      const invitedByTargetIds = new Set(targetInvitations.map((inv) => inv.acceptedProfileId));

      // Check which candidates were invited by target or invited the target
      for (const candidate of allWithEthos) {
        const pid = candidate.ethosProfile?.profileId;
        if (!pid) continue;

        if (invitedByTargetIds.has(pid)) {
          candidate.invitedByTarget = true;
          candidate.score += 2;
          candidate.signals.push({ type: "invited_by_target", score: 2, details: "target invited this profile on Ethos" });
          candidate.signalTypes.add("invited_by_target");
          log("warn", `${candidate.ethosProfile?.displayName} was invited by ${targetDisplayName} on Ethos`);
        }
      }

      // Fetch candidate invitation trees to check if any invited the target
      await parallel(
        allWithEthos.filter((c) => c.ethosProfile?.profileId),
        async (candidate) => {
          const pid = candidate.ethosProfile!.profileId;
          try {
            const invitations = await fetchInvitationTree(pid);
            if (invitations.some((inv) => inv.acceptedProfileId === targetProfileId)) {
              candidate.invitedTarget = true;
              candidate.score += 2;
              candidate.signals.push({ type: "invited_target", score: 2, details: "this profile invited the target on Ethos" });
              candidate.signalTypes.add("invited_target");
              log("warn", `${candidate.ethosProfile?.displayName} invited ${targetDisplayName} on Ethos`);
            }
          } catch {}
        },
        5
      );

      // Check mutual reviews
      const [targetReviewsGiven, targetReviewsReceived] = await Promise.all([
        fetchActivities(targetProfileId, "given", ["review"], 200),
        fetchActivities(targetProfileId, "received", ["review"], 200),
      ]);

      const targetReviewedIds = new Set(targetReviewsGiven.map((r) => r.subject.profileId));
      const reviewedTargetIds = new Set(targetReviewsReceived.map((r) => r.author.profileId));

      for (const candidate of allWithEthos) {
        const pid = candidate.ethosProfile?.profileId;
        if (!pid) continue;

        const targetReviewedCandidate = targetReviewedIds.has(pid);
        const candidateReviewedTarget = reviewedTargetIds.has(pid);

        if (targetReviewedCandidate && candidateReviewedTarget) {
          candidate.mutualReviews = true;
          candidate.score += 2;
          candidate.signals.push({ type: "mutual_reviews", score: 2, details: "reviewed each other on Ethos" });
          candidate.signalTypes.add("mutual_reviews");
          log("warn", `Mutual reviews between ${candidate.ethosProfile?.displayName} and ${targetDisplayName}`);
        }
      }

      // Check mutual vouches
      const [targetVouchesGiven, targetVouchesReceived] = await Promise.all([
        fetchActivities(targetProfileId, "given", ["vouch"], 200),
        fetchActivities(targetProfileId, "received", ["vouch"], 200),
      ]);

      const targetVouchedIds = new Set(targetVouchesGiven.map((r) => r.subject.profileId));
      const vouchedTargetIds = new Set(targetVouchesReceived.map((r) => r.author.profileId));

      for (const candidate of allWithEthos) {
        const pid = candidate.ethosProfile?.profileId;
        if (!pid) continue;

        const targetVouchedCandidate = targetVouchedIds.has(pid);
        const candidateVouchedTarget = vouchedTargetIds.has(pid);

        if (targetVouchedCandidate && candidateVouchedTarget) {
          candidate.mutualVouches = true;
          candidate.score += 2;
          candidate.signals.push({ type: "mutual_vouches", score: 2, details: "vouched for each other on Ethos" });
          candidate.signalTypes.add("mutual_vouches");
          log("warn", `Mutual vouches between ${candidate.ethosProfile?.displayName} and ${targetDisplayName}`);
        }
      }

      // Recalculate confidence after adding social signals
      for (const c of allWithEthos) {
        if (c.score >= FINAL_SCORE_THRESHOLD && c.signalTypes.size >= 2) c.confidence = "high";
        else if (c.score >= POSSIBLE_SCORE_THRESHOLD) c.confidence = "medium";
      }
    } catch (err) {
      log("error", `Ethos social analysis failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Multi-hop funding: trace funder wallets to discover additional Ethos profiles
  const knownAddresses = new Set([target, ...allWithEthos.flatMap((c) => c.wallets || [c.address])]);
  const uniqueFunderAddrs = new Set<string>();
  for (const ff of allTargetFirstFunders) {
    if (!knownAddresses.has(ff.funder) && !isExchangeAddress(ff.funder)) uniqueFunderAddrs.add(ff.funder);
  }
  for (const c of allWithEthos) {
    for (const ff of c.firstFunders || []) {
      if (!knownAddresses.has(ff.funder) && !isExchangeAddress(ff.funder)) uniqueFunderAddrs.add(ff.funder);
    }
  }

  if (uniqueFunderAddrs.size > 0) {
    log("info", `Multi-hop: tracing ${uniqueFunderAddrs.size} funder wallet(s) for additional Ethos profiles...`);

    const discoveredWallets = new Map<string, { funderAddress: string; chain: string }>();

    await parallel(
      [...uniqueFunderAddrs],
      async (funderAddr) => {
        // Check outgoing transfers on Base (most common for Ethos)
        const chain = CHAINS[0]; // Base
        try {
          const outgoing = await getOutgoingTransfers(funderAddr, chain, 50);
          for (const tx of outgoing) {
            const dest = tx.to.toLowerCase();
            if (!knownAddresses.has(dest) && !discoveredWallets.has(dest)) {
              discoveredWallets.set(dest, { funderAddress: funderAddr, chain: chain.name });
            }
          }
        } catch {}
      },
      5
    );

    if (discoveredWallets.size > 0) {
      log("info", `Multi-hop: found ${discoveredWallets.size} new wallet(s), checking Ethos...`);
      const newAddrs = [...discoveredWallets.keys()].slice(0, 200);
      const newProfiles = await fetchProfilesByAddresses(newAddrs);

      let discovered = 0;
      for (const [addr, { funderAddress, chain }] of discoveredWallets) {
        const profile = newProfiles.get(addr);
        if (!profile || !profile.profileId) continue;
        if (profile.profileId === targetProfileId) continue;
        if (candidateProfileIds.has(profile.profileId)) continue;

        discovered++;
        const ethosData = toEthosData(profile);
        log("warn", `Multi-hop: discovered ${profile.displayName} (@${profile.username || "?"}) via funder ${funderAddress.slice(0, 10)}...`);

        // Add as a new possible candidate
        const newCandidate: ClusterCandidate = {
          address: addr,
          wallets: [addr],
          score: 6,
          confidence: "medium",
          signals: [{ type: "multi_hop_funding", score: 6, details: `discovered via shared funder ${funderAddress.slice(0, 10)}... on ${chain}` }],
          signalTypes: new Set(["multi_hop_funding"]),
          directCount: 0,
          incomingCount: 0,
          outgoingCount: 0,
          bidirectional: false,
          repeatTransfer: false,
          sharedContracts: [],
          sharedFundingSources: [],
          sharedFirstFunder: false,
          firstFunders: [{ chain, funder: funderAddress, funderLabel: getAddressLabel(funderAddress), txHash: "", value: 0 }],
          crossClusterContracts: [],
          sharedCexDeposits: [],
          invitedByTarget: false,
          invitedTarget: false,
          mutualReviews: false,
          mutualVouches: false,
          ethosProfile: ethosData,
          networks: [chain],
        };

        possibleWithEthos.push(newCandidate);
        candidateProfileIds.add(profile.profileId);
      }

      log("info", `Multi-hop: discovered ${discovered} additional Ethos profile(s)`);
    }
  }

  // Cross-cluster shared deposit analysis
  const allClusterWallets = [
    target,
    ...strongWithEthos.flatMap((c) => c.wallets || [c.address]),
    ...possibleWithEthos.flatMap((c) => c.wallets || [c.address]),
  ];
  log("info", `Analyzing cross-cluster deposits for ${allClusterWallets.length} wallets...`);
  const sharedDeposits = findSharedDeposits(allClusterWallets, txsByNetwork, contractCacheByNetwork);
  if (sharedDeposits.length > 0) {
    log("warn", `Found ${sharedDeposits.length} contract${sharedDeposits.length > 1 ? "s" : ""} used by 2+ cluster members`);

    // Resolve contract names (best effort, use Base or first available chain)
    const chainForLookup = CHAINS[0]; // Base
    await parallel(
      sharedDeposits.slice(0, 20),
      async (dep) => {
        const name = await getContractName(dep.contract, chainForLookup);
        if (name) dep.contractName = name;
      },
      5
    );

    // Attach cross-cluster data to each candidate
    const allCandidates = [...strongWithEthos, ...possibleWithEthos];
    for (const dep of sharedDeposits) {
      for (const candidate of allCandidates) {
        const candidateWallets = candidate.wallets || [candidate.address];
        if (dep.wallets.some((w) => candidateWallets.includes(w))) {
          const sharedWith = dep.wallets.filter((w) => !candidateWallets.includes(w));
          if (sharedWith.length > 0) {
            candidate.crossClusterContracts.push({
              contract: dep.contract,
              contractName: dep.contractName,
              sharedWith,
              network: dep.network,
            });
          }
        }
      }
    }
  } else {
    log("info", `No shared contract deposits found between cluster members`);
  }

  // Shared CEX deposit address detection
  log("info", `Checking for shared CEX deposit addresses...`);
  const sharedEoaDests = findSharedEoaDestinations(allClusterWallets, txsByNetwork, contractCacheByNetwork);
  let sharedCexDeposits: SharedCexDeposit[] = [];

  if (sharedEoaDests.size > 0) {
    log("info", `Found ${sharedEoaDests.size} shared EOA destination(s), verifying CEX connections...`);
    sharedCexDeposits = await verifyCexDepositAddresses(sharedEoaDests, log);

    if (sharedCexDeposits.length > 0) {
      log("warn", `Found ${sharedCexDeposits.length} shared CEX deposit address(es)!`);
      for (const dep of sharedCexDeposits) {
        log("warn", `  ${dep.exchange} deposit: ${dep.depositAddress.slice(0, 10)}... used by ${dep.wallets.length} wallets`);
      }

      // Attach to candidates and add score
      for (const dep of sharedCexDeposits) {
        for (const candidate of [...strongWithEthos, ...possibleWithEthos]) {
          const candidateWallets = candidate.wallets || [candidate.address];
          if (dep.wallets.some((w) => candidateWallets.includes(w))) {
            candidate.sharedCexDeposits.push(dep);
            // Only add the signal once per candidate
            if (!candidate.signals.some((s) => s.type === "shared_cex_deposit")) {
              candidate.score += 8;
              candidate.signals.push({
                type: "shared_cex_deposit",
                score: 8,
                details: `same ${dep.exchange} deposit address as other cluster members`,
              });
              candidate.signalTypes.add("shared_cex_deposit");
              // Recalculate confidence
              if (candidate.score >= FINAL_SCORE_THRESHOLD && candidate.signalTypes.size >= 2) candidate.confidence = "high";
              else if (candidate.score >= POSSIBLE_SCORE_THRESHOLD) candidate.confidence = "medium";
            }
          }
        }
      }
    } else {
      log("info", `No shared CEX deposit addresses found`);
    }
  } else {
    log("info", `No shared EOA destinations found between cluster members`);
  }

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
    sharedDeposits,
    sharedCexDeposits,
    strongCluster: strongWithEthos,
    possibleCluster: possibleWithEthos,
    networkStats,
    logs,
  };
}