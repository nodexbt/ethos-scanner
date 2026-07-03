import {
  CHAINS,
  type Chain,
  type AssetTransfer,
  getAllTransactions,
  batchGetCode,
  parallel,
  getFirstFunder,
  getOutgoingTransfers,
} from "./alchemy";
import { fetchProfilesByAddresses, fetchInvitationTree, fetchActivities, type EthosProfile, type Invitation, type ReviewActivity } from "./ethos";
import { getAddressLabel, isExchangeAddress } from "./known-addresses";
import { getSupabase } from "./db/supabase";

/**
 * Look up which of the given counterparty addresses belong to a tracked
 * Ethos profile. Used to filter sybil-cluster candidates down to "Ethos
 * users only" before any expensive per-candidate Alchemy work runs —
 * every Ethos profile has at least one attested wallet (it's a sign-up
 * requirement), so anything not in profile_addresses is either a
 * contract or an unattested wallet we don't care about for clustering.
 */
async function fetchEthosCounterparties(addrs: string[]): Promise<Set<string>> {
  const result = new Set<string>();
  if (addrs.length === 0) return result;
  const supabase = getSupabase();
  // 200 addresses per .in() query keeps the URL well under Supabase's
  // request size cap.
  for (let i = 0; i < addrs.length; i += 200) {
    const chunk = addrs.slice(i, i + 200).map((a) => a.toLowerCase());
    const { data, error } = await supabase
      .from("profile_addresses")
      .select("address")
      .in("address", chunk);
    if (error) {
      console.error("fetchEthosCounterparties failed:", error.message);
      continue;
    }
    for (const row of (data ?? []) as { address: string }[]) {
      if (row.address) result.add(row.address.toLowerCase());
    }
  }
  return result;
}

// --- Config ---

const MAX_PAGES = 50;
const CANDIDATE_MAX_PAGES = 6;
const CANDIDATE_MAX_TXS = 4000;
const MAX_CANDIDATES_PER_NETWORK = 50;
const CONCURRENCY = 8;

// Scoring weights
const W_DIRECT = 4;
const W_REPEAT = 4;
const W_BIDIRECTIONAL = 3;
const W_SHARED_FUNDER = 5;
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

/** A single review/vouch in one direction, for mutual-activity signals. */
export interface MutualActivityRef {
  url: string; // canonical app.ethos.network link to the review/vouch
  archived: boolean; // true if the review was archived or the vouch was withdrawn
  date: number; // unix seconds of the activity's most recent event
}

/** Build a MutualActivityRef from a raw review/vouch activity. */
function toMutualRef(a: ReviewActivity): MutualActivityRef {
  return {
    url: a.link ?? "",
    archived: a.data.archived,
    date: a.timestamp ?? a.data.createdAt,
  };
}

export interface Signal {
  type: string;
  score: number;
  details: string;
  // Present on mutual_reviews / mutual_vouches signals: both directions of the activity.
  mutual?: {
    fromTarget: MutualActivityRef; // target's review/vouch of the candidate
    fromCandidate: MutualActivityRef; // candidate's review/vouch of the target
  };
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
  sharedFundingSources: string[];
  sharedFirstFunder: boolean;
  firstFunders: FirstFunderInfo[];
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
    humanVerified: boolean;
  };
  networks: string[];
}

/** Scan target: an Ethos profile with all its attested wallets, or a
    single unattested wallet (profileId null). */
export interface ScanTarget {
  profileId: number | null;
  /** Personal EOA wallets to actually scan (fetch transactions for). */
  wallets: string[];
  /** Every attested wallet incl. smart-contract wallets. Used only for
      self-exclusion so a candidate isn't flagged for touching the target's
      own smart wallet. Defaults to `wallets` when omitted. */
  allWallets?: string[];
  primaryWallet: string;
}

export interface ClusterScanResult {
  /** Primary wallet of the target — kept as the single-address field so
      older consumers (verified-tab matching, saved results) keep working. */
  target: string;
  /** All target wallets that were scanned. Absent on results saved before
      multi-wallet scanning; treat as [target]. */
  targetWallets?: string[];
  targetProfileId?: number | null;
  targetEthos?: {
    profileId: number;
    displayName: string;
    username: string | null;
    avatarUrl: string;
    score: number;
    profileUrl: string;
    humanVerified: boolean;
  };
  targetFirstFunders: FirstFunderInfo[];
  funderProfiles: Record<string, { displayName: string; username: string | null; avatarUrl: string; score: number; profileUrl: string; humanVerified: boolean }>;
  sharedCexDeposits: SharedCexDeposit[];
  strongCluster: ClusterCandidate[];
  possibleCluster: ClusterCandidate[];
  networkStats: Record<string, { txCount: number; directWallets: number }>;
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
  targetSet: Set<string>,
  txs: AssetTransfer[],
  contractCache: Map<string, boolean>
): Map<string, DirectWalletInfo> {
  const result = new Map<string, DirectWalletInfo>();

  for (const tx of txs) {
    const from = normalizeAddress(tx.from);
    const to = normalizeAddress(tx.to);
    if (!from || !to) continue;
    const fromIsTarget = targetSet.has(from);
    const toIsTarget = targetSet.has(to);
    // Skip non-target txs and transfers between the target's own wallets —
    // another wallet of the same profile must never become a candidate.
    if (fromIsTarget === toIsTarget) continue;

    const counterparty = fromIsTarget ? to : from;
    if (counterparty === ZERO_ADDRESS) continue;
    if (contractCache.get(counterparty)) continue;

    const direction = fromIsTarget ? "out" : "in";
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


function findSharedFundingSources(
  targetSet: Set<string>,
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

  // Union of incoming sources across all target wallets, excluding the
  // target's own wallets (internal profile transfers aren't funding).
  const targetSources = new Set<string>();
  for (const wallet of targetSet) {
    for (const src of incomingSources(wallet, targetTxs)) {
      if (!targetSet.has(src)) targetSources.add(src);
    }
  }
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
  directInfo: DirectWalletInfo | undefined,
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
    // Direct transfers between wallets are noisy — friends, payment splits,
    // tipping, repaying debts all cause them. We still surface the
    // information in the connection summary but it does NOT contribute to
    // the cluster score or the signal-type count. Only funding-relationship
    // signals (first-funder, CEX-deposit, funded-by-target/cluster) drive
    // confidence. W_DIRECT etc. are kept solely as the discovery filter
    // (pre-score) below — they decide which wallets are worth evaluating
    // further; the final score doesn't use them.
    signals.push({ type: "direct_transfer", score: 0, details: `count=${directInfo.count}` });
    if (directInfo.repeatTransfer)
      signals.push({ type: "repeat_transfer", score: 0, details: "count>1" });
    if (directInfo.bidirectional)
      signals.push({ type: "bidirectional", score: 0, details: "in>0 and out>0" });
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
    sharedFundingSources: sharedFunders,
    sharedFirstFunder,
    firstFunders: candidateFirstFunders,
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
  targetWallets: string[],
  chain: Chain,
  log: (level: LogLevel, message: string) => void,
  stepDone?: (phase: string) => void,
  /** Every attested wallet of the target (incl. smart wallets we don't
      fetch) for self-exclusion. Defaults to targetWallets. */
  exclusionWallets: string[] = targetWallets
): Promise<{
  directWallets: Map<string, DirectWalletInfo>;
  candidates: Map<string, ClusterCandidate>;
  candidateTxs: Map<string, AssetTransfer[]>;
  contractCache: Map<string, boolean>;
  txCount: number;
  targetFirstFunders: FirstFunderInfo[];
}> {
  const network = chain.name;
  // Exclude every attested wallet from becoming a candidate, but only fetch
  // transactions for the scannable (EOA) targetWallets below.
  const targetSet = new Set([...exclusionWallets, ...targetWallets]);

  // Step 1: Fetch target transactions — one fetch per target wallet, so a
  // multi-wallet profile's full activity is covered.
  log(
    "info",
    `[${network}] Fetching target transactions (${targetWallets.length} wallet${targetWallets.length === 1 ? "" : "s"})...`
  );
  const txsByTargetWallet = new Map<string, AssetTransfer[]>();
  await parallel(
    targetWallets,
    async (wallet) => {
      txsByTargetWallet.set(
        wallet,
        await getAllTransactions(wallet, chain, { maxPages: MAX_PAGES })
      );
    },
    CONCURRENCY
  );
  const txs = [...txsByTargetWallet.values()].flat();
  log("info", `[${network}] ${txs.length} transactions fetched`);
  stepDone?.(`${network}: Fetched transactions`);

  if (txs.length === 0) {
    // Nothing to analyze on this chain — emit one progress ping with
    // the skip phase label so the user sees it in the log.
    stepDone?.(`${network}: Skipped (no txs)`);
    return {
      directWallets: new Map(),
      candidates: new Map(),
      candidateTxs: new Map(),
      contractCache: new Map(),
      txCount: 0,
      targetFirstFunders: [],
    };
  }

  // Step 2: Filter target's counterparties to Ethos-profile addresses.
  // Every Ethos profile has at least one attested wallet, so addresses
  // not present in profile_addresses are either contracts or unattested
  // wallets we don't care about for clustering. This replaces the prior
  // batchGetCode contract-detection step — same effect, ~0 CU instead
  // of a per-counterparty eth_getCode call (was 50-70% of total scan
  // cost on active wallets).
  const counterparties = new Set<string>();
  for (const tx of txs) {
    const from = normalizeAddress(tx.from);
    const to = normalizeAddress(tx.to);
    if (from && !targetSet.has(from)) counterparties.add(from);
    if (to && !targetSet.has(to)) counterparties.add(to);
  }

  log("info", `[${network}] Filtering ${counterparties.size} counterparties to Ethos profiles...`);
  const ethosCounterparties = await fetchEthosCounterparties([...counterparties]);
  log(
    "info",
    `[${network}] ${ethosCounterparties.size}/${counterparties.size} counterparties are Ethos profiles`
  );

  // Funder analysis still needs to filter out contracts (otherwise a
  // shared DEX router or token contract becomes a fake "shared funder"
  // signal). Pre-populate the cache from known infrastructure labels
  // for now — captures CEX hot wallets and the addresses already labeled
  // in known-addresses.ts. Unknown contracts may slip through; we
  // mitigate that with the "shared by many candidates" heuristic later.
  const contractCache = new Map<string, boolean>();

  // Step 3: Direct transfer analysis (skips contracts via empty cache,
  // then we narrow to Ethos profiles below)
  log("info", `[${network}] Analyzing direct transfers...`);
  const directWalletsRaw = analyzeDirectTransfers(targetSet, txs, contractCache);
  const directWallets = new Map<string, DirectWalletInfo>();
  for (const [addr, info] of directWalletsRaw) {
    if (ethosCounterparties.has(addr)) directWallets.set(addr, info);
  }
  log("success", `[${network}] ${directWallets.size} Ethos-profile wallets with direct transfers`);
  stepDone?.(`${network}: Direct transfers analyzed`);

  // Step 4: Pre-score candidates from direct transfers
  const allCandidateAddrsRaw = [...directWallets.keys()].slice(0, MAX_CANDIDATES_PER_NETWORK);
  const PRE_SCORE_THRESHOLD = 3;

  const promisingCandidates: string[] = [];
  for (const addr of allCandidateAddrsRaw) {
    let preScore = 0;
    const directInfo = directWallets.get(addr);
    if (directInfo) {
      preScore += W_DIRECT;
      if (directInfo.repeatTransfer) preScore += W_REPEAT;
      if (directInfo.bidirectional) preScore += W_BIDIRECTIONAL;
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
  for (const [wallet, walletTxs] of txsByTargetWallet) {
    candidateTxsMap.set(wallet, walletTxs);
  }

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
  const sharedFundingRaw = findSharedFundingSources(
    targetSet,
    txs,
    allCandidateAddrs,
    candidateTxsMap,
    contractCache
  );

  // Lazy contract check: instead of running eth_getCode across every
  // counterparty (that's what batchGetCode used to do), we only check
  // the addresses that actually surface as a shared funder for some
  // Ethos-profile candidate. Typically 0-20 addresses per chain — a
  // few hundred CU instead of tens of thousands.
  const sharedFunderUnion = new Set<string>();
  for (const sources of sharedFundingRaw.values()) {
    for (const src of sources) sharedFunderUnion.add(src);
  }
  // Skip addresses already labeled in known-addresses (CEX hot wallets,
  // labeled services) — those are intentional shared-funder candidates
  // and already get the correct shared_exchange_funder downgrade.
  const unknownFunders = [...sharedFunderUnion].filter((addr) => !getAddressLabel(addr));
  if (unknownFunders.length > 0) {
    log(
      "info",
      `[${network}] Checking contract status of ${unknownFunders.length} shared funder(s)…`
    );
    const codeResult = await batchGetCode(unknownFunders, chain);
    for (const [addr, isContract] of codeResult) {
      contractCache.set(addr, isContract);
    }
  }
  // Drop contract-as-funder entries from the shared list. Without this
  // every Ethos profile that ever used Uniswap would share a "funder"
  // (the router) with every other Uniswap user → massive false
  // positives.
  const sharedFunding = new Map<string, string[]>();
  for (const [wallet, sources] of sharedFundingRaw) {
    const cleaned = sources.filter((s) => !contractCache.get(s));
    if (cleaned.length > 0) sharedFunding.set(wallet, cleaned);
  }
  log("info", `[${network}] ${sharedFunding.size} wallets share funding sources`);

  // Step 9: First funder analysis (only for promising candidates)
  log("info", `[${network}] Checking first funders for target + ${allCandidateAddrs.length} candidates...`);

  // First funder per target wallet — a candidate sharing a first funder
  // with ANY of the target's wallets is a shared-first-funder hit.
  const targetFirstFunders: FirstFunderInfo[] = [];
  await parallel(
    targetWallets,
    async (wallet) => {
      const ff = await getFirstFunder(wallet, chain);
      if (ff) {
        targetFirstFunders.push({
          chain: network,
          funder: ff.funder,
          funderLabel: getAddressLabel(ff.funder),
          txHash: ff.txHash,
          value: ff.value,
        });
        log("info", `[${network}] Target first funder: ${ff.funder.slice(0, 10)}... (${ff.value} ETH)`);
      }
    },
    CONCURRENCY
  );
  const targetFunderAddrs = new Set(targetFirstFunders.map((f) => f.funder));

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
  for (const [addr, ff] of candidateFirstFunders) {
    if (targetFunderAddrs.has(ff.funder)) {
      sharedFirstFunderAddrs.add(addr);
      log("warn", `[${network}] Shared first funder! ${addr.slice(0, 10)}... and target both funded by ${ff.funder.slice(0, 10)}...`);
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
    const sharedFunders = sharedFunding.get(addr) ?? [];
    const hasSharedFirstFunder = sharedFirstFunderAddrs.has(addr);
    const candFF = candidateFirstFunders.get(addr);
    const candFirstFunders: FirstFunderInfo[] = candFF ? [candFF] : [];

    const isFundedByTarget = candFF ? targetSet.has(candFF.funder) : false;
    const isFundedByCluster = !isFundedByTarget && candFF
      ? allCandidateAddrs.some((other) => other !== addr && other === candFF.funder)
      : false;

    const candidate = scoreCandidate(
      addr,
      directInfo,
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

  return { directWallets, candidates, candidateTxs: candidateTxsMap, contractCache, txCount: txs.length, targetFirstFunders };
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

// --- Main Entry Point ---

export interface ScanProgress {
  /** Wall-clock ms since the scan started. Monotonic. */
  elapsed: number;
  /** Total expected wall-clock ms based on the rolling average of
      recent scan durations. Stable for the lifetime of one scan. */
  totalEstimatedMs: number;
  /** Remaining wall-clock ms = totalEstimatedMs - elapsed, floored at
      a small minimum so we never show "0s left" while scanning. */
  estimatedRemaining: number;
  /** Percent complete derived from elapsed vs totalEstimatedMs.
      Capped at 99 while scanning so the bar doesn't read "100%"
      before the result is ready. */
  percent: number;
  /** Human-readable phase label for the most recent step. */
  phase: string;
}

/** Floor for the displayed remaining time while scanning. Prevents
    "0s left" from appearing if the actual scan overruns the baseline. */
const MIN_REMAINING_MS = 1_000;

export async function runClusterScan(
  /** A resolved profile target (all attested wallets) or, for backward
      compatibility, a single raw address string. */
  targetInput: ScanTarget | string,
  onLog?: (entry: LogEntry) => void,
  onProgress?: (progress: ScanProgress) => void,
  /** Rolling-average baseline duration in ms, fetched by the caller
      from recent scan history. Lifetime of one scan; never updated
      mid-scan. The estimator becomes a pure elapsed-vs-baseline
      countdown using this value — no per-step rate calculations. */
  baselineMs: number = 90_000
): Promise<ClusterScanResult> {
  const logs: LogEntry[] = [];
  const log = (level: LogLevel, message: string) => {
    const entry: LogEntry = { timestamp: Date.now(), level, message };
    logs.push(entry);
    onLog?.(entry);
  };

  const start = Date.now();

  function emitProgress(phase: string) {
    const elapsed = Date.now() - start;
    const remaining = Math.max(MIN_REMAINING_MS, baselineMs - elapsed);
    const percent = Math.min(99, Math.round((elapsed / baselineMs) * 100));
    onProgress?.({
      elapsed,
      totalEstimatedMs: baselineMs,
      estimatedRemaining: remaining,
      percent,
      phase,
    });
  }

  // stepDone is now just "something happened — ping the client with a
  // fresh phase label." The progress math doesn't care which step.
  function stepDone(phase: string) {
    emitProgress(phase);
  }

  const scanTarget: ScanTarget =
    typeof targetInput === "string"
      ? {
          profileId: null,
          wallets: [targetInput.toLowerCase()],
          primaryWallet: targetInput.toLowerCase(),
        }
      : {
          profileId: targetInput.profileId,
          wallets: [...new Set(targetInput.wallets.map((w) => w.toLowerCase()))],
          allWallets: targetInput.allWallets
            ? [...new Set(targetInput.allWallets.map((w) => w.toLowerCase()))]
            : undefined,
          primaryWallet: targetInput.primaryWallet.toLowerCase(),
        };
  // targetWallets = EOAs we fetch and scan. exclusionWallets = every attested
  // wallet (incl. smart wallets we don't fetch) that must never surface as a
  // candidate of the target's own profile.
  const targetWallets = scanTarget.wallets;
  const exclusionWallets = [
    ...new Set([...(scanTarget.allWallets ?? []), ...targetWallets]),
  ];
  const targetSet = new Set(exclusionWallets);
  const target = scanTarget.primaryWallet;

  log(
    "info",
    `Starting cluster scan for ${target}${targetWallets.length > 1 ? ` (+${targetWallets.length - 1} more wallet${targetWallets.length > 2 ? "s" : ""} of the same profile)` : ""}`
  );
  log("info", `Networks: ${CHAINS.map((c) => c.name).join(", ")}`);
  emitProgress("Starting...");

  // Scan networks in parallel (2 at a time to avoid connection overload)
  const networkResults = await parallel(
    [...CHAINS],
    async (chain) => {
      try {
        const result = await scanNetwork(targetWallets, chain, log, stepDone, exclusionWallets);
        return { chain, result, error: null };
      } catch (err) {
        log("error", `[${chain.name}] Network scan failed: ${err instanceof Error ? err.message : String(err)}`);
        // Ping the client with the failure phase label; the bar/ETA
        // are time-based now and don't need any per-network credit.
        stepDone(`${chain.name}: Network failed`);
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
      networkStats[chain.name] = { txCount: 0, directWallets: 0 };
      continue;
    }

    networkStats[chain.name] = {
      txCount: result.txCount,
      directWallets: result.directWallets.size,
    };

    txsByNetwork.set(chain.name, result.candidateTxs);
    contractCacheByNetwork.set(chain.name, result.contractCache);

    allTargetFirstFunders.push(...result.targetFirstFunders);

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
  const ethosAddresses = [...new Set([...exclusionWallets, ...allCandidateAddrs, ...allFirstFunderAddrs])];
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
      humanVerified: profile.humanVerificationStatus === "VERIFIED",
    };
  }

  let targetEthos: ClusterScanResult["targetEthos"];
  const targetProfile =
    exclusionWallets.map((w) => ethosMap.get(w)).find((p) => p && p.profileId) ?? null;
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
        humanVerified: data.humanVerified,
      };
      log("info", `First funder ${funderAddr.slice(0, 10)}... is Ethos user: ${profile.displayName}`);
    }
  }

  // Filter to only candidates with Ethos profiles, exclude target's own profile,
  // and merge candidates that belong to the same Ethos profile
  const targetProfileId = targetEthos?.profileId ?? scanTarget.profileId ?? undefined;

  function dedupeByProfile(candidates: ClusterCandidate[]): ClusterCandidate[] {
    const withEthos = candidates.filter(
      (c) =>
        c.ethosProfile &&
        c.ethosProfile.profileId !== targetProfileId &&
        // Belt-and-braces: a candidate whose wallets overlap the target's
        // own wallet set is the target itself, even if the Ethos bulk
        // lookup failed to resolve the overlap to the same profile id.
        !c.wallets.some((w) => targetSet.has(w))
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
          // Social signals are recorded for context in the connection
          // summary but do not contribute to the cluster score or signal-
          // type count. Invite trees include real legit relationships;
          // adding points here drove false positives.
          candidate.invitedByTarget = true;
          candidate.signals.push({ type: "invited_by_target", score: 0, details: "target invited this profile on Ethos" });
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
              candidate.signals.push({ type: "invited_target", score: 0, details: "this profile invited the target on Ethos" });
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

      const targetReviewedBy = new Map(targetReviewsGiven.map((r) => [r.subject.profileId, r]));
      const reviewedTargetBy = new Map(targetReviewsReceived.map((r) => [r.author.profileId, r]));

      for (const candidate of allWithEthos) {
        const pid = candidate.ethosProfile?.profileId;
        if (!pid) continue;

        const targetReviewedCandidate = targetReviewedBy.get(pid);
        const candidateReviewedTarget = reviewedTargetBy.get(pid);

        if (targetReviewedCandidate && candidateReviewedTarget) {
          candidate.mutualReviews = true;
          candidate.signals.push({
            type: "mutual_reviews",
            score: 0,
            details: "reviewed each other on Ethos",
            mutual: {
              fromTarget: toMutualRef(targetReviewedCandidate),
              fromCandidate: toMutualRef(candidateReviewedTarget),
            },
          });
          log("warn", `Mutual reviews between ${candidate.ethosProfile?.displayName} and ${targetDisplayName}`);
        }
      }

      // Check mutual vouches
      const [targetVouchesGiven, targetVouchesReceived] = await Promise.all([
        fetchActivities(targetProfileId, "given", ["vouch"], 200),
        fetchActivities(targetProfileId, "received", ["vouch"], 200),
      ]);

      const targetVouchedBy = new Map(targetVouchesGiven.map((r) => [r.subject.profileId, r]));
      const vouchedTargetBy = new Map(targetVouchesReceived.map((r) => [r.author.profileId, r]));

      for (const candidate of allWithEthos) {
        const pid = candidate.ethosProfile?.profileId;
        if (!pid) continue;

        const targetVouchedCandidate = targetVouchedBy.get(pid);
        const candidateVouchedTarget = vouchedTargetBy.get(pid);

        if (targetVouchedCandidate && candidateVouchedTarget) {
          candidate.mutualVouches = true;
          candidate.signals.push({
            type: "mutual_vouches",
            score: 0,
            details: "vouched for each other on Ethos",
            mutual: {
              fromTarget: toMutualRef(targetVouchedCandidate),
              fromCandidate: toMutualRef(candidateVouchedTarget),
            },
          });
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
  const knownAddresses = new Set([...exclusionWallets, ...allWithEthos.flatMap((c) => c.wallets || [c.address])]);
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
          sharedFundingSources: [],
          sharedFirstFunder: false,
          firstFunders: [{ chain, funder: funderAddress, funderLabel: getAddressLabel(funderAddress), txHash: "", value: 0 }],
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

  // Shared CEX deposit address detection
  const allClusterWallets = [
    ...targetWallets,
    ...strongWithEthos.flatMap((c) => c.wallets || [c.address]),
    ...possibleWithEthos.flatMap((c) => c.wallets || [c.address]),
  ];
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

  const totalElapsed = Date.now() - start;
  const mins = Math.floor(totalElapsed / 60000);
  const secs = Math.round((totalElapsed % 60000) / 1000);
  const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  log("success", `Cluster scan complete in ${timeStr}`);

  return {
    target,
    targetWallets,
    targetProfileId: targetProfileId ?? null,
    targetEthos,
    targetFirstFunders: allTargetFirstFunders,
    funderProfiles,
    sharedCexDeposits,
    strongCluster: strongWithEthos,
    possibleCluster: possibleWithEthos,
    networkStats,
    logs,
  };
}