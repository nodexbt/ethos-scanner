import {
  EthosProfile,
  fetchProfile,
  fetchInvitationTree,
  getWalletAddresses,
  Invitation,
} from "./ethos";
import { CHAINS, getFirstFunder, getTransfersBetween, getOutgoingTransfers } from "./alchemy";

// --- Types ---

export interface ScanProfile {
  profile: EthosProfile;
  wallets: string[];
}

export interface Finding {
  type: "shared-funder" | "direct-transfer" | "mutual-invitation" | "invitation-timing";
  severity: "high" | "medium" | "low";
  title: string;
  description: string;
  profiles: number[]; // profileIds involved
  details?: Record<string, unknown>;
}

export type LogLevel = "info" | "success" | "warn" | "error";

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  message: string;
}

export interface ProfileScanData {
  profileId: number;
  displayName: string;
  username: string | null;
  score: number;
  wallets: string[];
  invitationCount: number;
  firstFunders: { chain: string; funder: string; txHash: string; funderProfile?: { profileId: number; displayName: string; username: string | null; score: number } }[];
}

export interface ScanResult {
  findings: Finding[];
  logs: LogEntry[];
  profileData: ProfileScanData[];
}

// --- Scanner ---

export async function runSybilScan(
  scanProfiles: ScanProfile[],
  onLog?: (entry: LogEntry) => void
): Promise<ScanResult> {
  const findings: Finding[] = [];
  const logs: LogEntry[] = [];

  const log = (level: LogLevel, message: string) => {
    const entry: LogEntry = { timestamp: Date.now(), level, message };
    logs.push(entry);
    onLog?.(entry);
  };

  const profiles = scanProfiles.filter((sp) => sp.profile.profileId !== null);

  log("info", `Starting sybil scan for ${profiles.length} profile(s)`);
  profiles.forEach((sp) => {
    log("info", `  - ${sp.profile.displayName} (ID: ${sp.profile.profileId}, wallets: ${sp.wallets.length})`);
    sp.wallets.forEach((w) => log("info", `    wallet: ${w}`));
    if (sp.wallets.length === 0) {
      log("warn", `    No wallet addresses found in userkeys`);
    }
  });

  // =========================================
  // Step 1: Invitation analysis
  // =========================================
  log("info", "--- Step 1: Invitation analysis ---");

  const invitationMap = new Map<number, Invitation[]>();

  for (const sp of profiles) {
    const profileId = sp.profile.profileId!;
    log("info", `Fetching invitation tree for ${sp.profile.displayName}...`);
    try {
      const invitations = await fetchInvitationTree(profileId);
      invitationMap.set(profileId, invitations);
      if (invitations.length > 0) {
        log("success", `  Found ${invitations.length} invitation(s)`);
        invitations.forEach((inv) => {
          log("info", `    Invited: ${inv.user?.displayName || "unknown"} (profileId: ${inv.acceptedProfileId})`);
        });
      } else {
        log("info", `  No invitations found`);
      }
    } catch (err) {
      log("error", `  Failed to fetch invitations: ${err instanceof Error ? err.message : String(err)}`);
      invitationMap.set(profileId, []);
    }
  }

  // Check mutual invitations
  if (profiles.length >= 2) {
    log("info", "Checking for mutual invitations and shared inviters...");
    const profileIds = new Set(profiles.map((sp) => sp.profile.profileId!));

    for (let i = 0; i < profiles.length; i++) {
      for (let j = i + 1; j < profiles.length; j++) {
        const profileA = profiles[i].profile;
        const profileB = profiles[j].profile;
        const idA = profileA.profileId!;
        const idB = profileB.profileId!;

        const invitationsA = invitationMap.get(idA) || [];
        const invitationsB = invitationMap.get(idB) || [];

        log("info", `Comparing ${profileA.displayName} <-> ${profileB.displayName}`);

        // Check if A invited B
        const aInvitedB = invitationsA.some(
          (inv) => inv.acceptedProfileId === idB || inv.user?.profileId === idB
        );
        // Check if B invited A
        const bInvitedA = invitationsB.some(
          (inv) => inv.acceptedProfileId === idA || inv.user?.profileId === idA
        );

        if (aInvitedB) log("info", `  ${profileA.displayName} invited ${profileB.displayName}`);
        if (bInvitedA) log("info", `  ${profileB.displayName} invited ${profileA.displayName}`);

        if (aInvitedB && bInvitedA) {
          log("warn", `  FINDING: Mutual invitation detected!`);
          findings.push({
            type: "mutual-invitation",
            severity: "high",
            title: "Mutual invitation",
            description: `${profileA.displayName} and ${profileB.displayName} invited each other. This is a strong sybil indicator.`,
            profiles: [idA, idB],
          });
        } else if (aInvitedB || bInvitedA) {
          const inviter = aInvitedB ? profileA : profileB;
          const invitee = aInvitedB ? profileB : profileA;
          log("info", `  Direct invitation: ${inviter.displayName} -> ${invitee.displayName}`);
          findings.push({
            type: "invitation-timing",
            severity: "low",
            title: "Direct invitation link",
            description: `${inviter.displayName} invited ${invitee.displayName} to Ethos.`,
            profiles: [idA, idB],
          });
        } else {
          log("info", `  No invitation link found`);
        }

        // Check shared inviters
        const invitersOfA = new Set<number>();
        const invitersOfB = new Set<number>();

        invitationMap.forEach((invitations, inviterProfileId) => {
          invitations.forEach((inv) => {
            if (inv.acceptedProfileId === idA || inv.user?.profileId === idA) {
              invitersOfA.add(inviterProfileId);
            }
            if (inv.acceptedProfileId === idB || inv.user?.profileId === idB) {
              invitersOfB.add(inviterProfileId);
            }
          });
        });

        const commonInviters = [...invitersOfA].filter(
          (id) => invitersOfB.has(id) && !profileIds.has(id)
        );

        if (commonInviters.length > 0) {
          log("warn", `  FINDING: Shared inviter(s): ${commonInviters.join(", ")}`);
          findings.push({
            type: "invitation-timing",
            severity: "medium",
            title: "Shared inviter",
            description: `${profileA.displayName} and ${profileB.displayName} were both invited by the same external profile.`,
            profiles: [idA, idB],
            details: { commonInviters },
          });
        }
      }
    }
  } else {
    log("info", "Only 1 profile - skipping mutual invitation check");
  }

  // =========================================
  // Step 2: First funder analysis (Alchemy)
  // =========================================
  log("info", "--- Step 2: First funder analysis ---");

  const allWallets = profiles.flatMap((sp) =>
    sp.wallets.map((w) => ({ wallet: w, profileId: sp.profile.profileId!, name: sp.profile.displayName }))
  );

  if (allWallets.length === 0) {
    log("warn", "No wallets found on any profile - skipping funder analysis");
  }

  const funderResults = new Map<
    string,
    { funder: string; chain: string; txHash: string; profileId: number }[]
  >();

  const firstFunderData = new Map<number, { chain: string; funder: string; txHash: string }[]>();
  profiles.forEach((sp) => firstFunderData.set(sp.profile.profileId!, []));

  for (const { wallet, profileId, name } of allWallets) {
    for (const chain of CHAINS) {
      log("info", `Checking first funder for ${name} (${wallet.slice(0, 8)}...) on ${chain.name}...`);
      try {
        const result = await getFirstFunder(wallet, chain);
        if (result) {
          log("success", `  First funded by ${result.funder.slice(0, 8)}...${result.funder.slice(-4)} (${result.value} ETH)`);
          firstFunderData.get(profileId)!.push({
            chain: chain.name,
            funder: result.funder,
            txHash: result.txHash,
          });

          const funderKey = result.funder.toLowerCase();
          if (!funderResults.has(funderKey)) {
            funderResults.set(funderKey, []);
          }
          funderResults.get(funderKey)!.push({
            funder: result.funder,
            chain: chain.name,
            txHash: result.txHash,
            profileId,
          });
        } else {
          log("info", `  No incoming transfers found on ${chain.name}`);
        }
      } catch (err) {
        log("error", `  Alchemy error on ${chain.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // Look up funder wallets on Ethos to see if they belong to profiles
  const funderProfiles = new Map<string, { profileId: number; displayName: string; username: string | null; score: number }>();
  const uniqueFunderAddresses = [...funderResults.keys()];

  if (uniqueFunderAddresses.length > 0) {
    log("info", `Looking up ${uniqueFunderAddresses.length} funder wallet(s) on Ethos...`);
    for (const funderAddr of uniqueFunderAddresses) {
      try {
        const funderProfile = await fetchProfile(funderAddr);
        if (funderProfile && funderProfile.profileId) {
          funderProfiles.set(funderAddr, {
            profileId: funderProfile.profileId,
            displayName: funderProfile.displayName,
            username: funderProfile.username,
            score: funderProfile.score,
          });
          log("success", `  Funder ${funderAddr.slice(0, 8)}...${funderAddr.slice(-4)} is Ethos profile: ${funderProfile.displayName} (@${funderProfile.username || "?"})`);
        }
      } catch {
        // Not an Ethos profile
      }
    }
  }

  // Find shared first funders
  funderResults.forEach((funded, funderAddress) => {
    const uniqueProfiles = [...new Set(funded.map((f) => f.profileId))];
    const funderProfile = funderProfiles.get(funderAddress);

    if (uniqueProfiles.length >= 2) {
      const profileNames = uniqueProfiles
        .map((id) => {
          const sp = profiles.find((p) => p.profile.profileId === id);
          return sp?.profile.displayName || `Profile ${id}`;
        })
        .join(", ");

      const chains = [...new Set(funded.map((f) => f.chain))].join(", ");
      const funderLabel = funderProfile
        ? `${funderProfile.displayName} (@${funderProfile.username || "?"}) (${funderAddress.slice(0, 6)}...${funderAddress.slice(-4)})`
        : `${funderAddress.slice(0, 6)}...${funderAddress.slice(-4)}`;

      log("warn", `FINDING: Shared first funder! ${funderLabel} funded ${profileNames} on ${chains}`);
      findings.push({
        type: "shared-funder",
        severity: "high",
        title: "Shared first funder",
        description: `${profileNames} were all first funded by the same wallet${funderProfile ? ` belonging to ${funderProfile.displayName}` : ""} (${funderAddress.slice(0, 6)}...${funderAddress.slice(-4)}) on ${chains}.`,
        profiles: uniqueProfiles,
        details: {
          funderAddress,
          funderProfile: funderProfile || undefined,
          chains: funded.map((f) => f.chain),
          txHashes: funded.map((f) => f.txHash),
        },
      });
    }
  });

  if (funderResults.size > 0) {
    const sharedCount = [...funderResults.values()].filter(
      (f) => new Set(f.map((x) => x.profileId)).size >= 2
    ).length;
    if (sharedCount === 0) {
      log("info", "No shared first funders found across profiles");
    }
  }

  // =========================================
  // Step 3: Direct transfers between wallets
  // =========================================
  log("info", "--- Step 3: Direct transfer analysis ---");

  if (profiles.length < 2) {
    log("info", "Only 1 profile - skipping direct transfer check");
  } else if (allWallets.length < 2) {
    log("warn", "Not enough wallets to check transfers");
  } else {
    for (let i = 0; i < profiles.length; i++) {
      for (let j = i + 1; j < profiles.length; j++) {
        const walletsA = profiles[i].wallets;
        const walletsB = profiles[j].wallets;
        const nameA = profiles[i].profile.displayName;
        const nameB = profiles[j].profile.displayName;

        for (const walletA of walletsA) {
          for (const walletB of walletsB) {
            for (const chain of CHAINS) {
              log("info", `Checking transfers ${nameA} <-> ${nameB} on ${chain.name}...`);
              try {
                const transfers = await getTransfersBetween(walletA, walletB, chain);
                if (transfers.length > 0) {
                  log("warn", `  FINDING: ${transfers.length} transfer(s) found!`);
                  transfers.forEach((t) => {
                    log("info", `    ${t.from.slice(0, 8)}... -> ${t.to.slice(0, 8)}... (${t.value} ${t.asset || "ETH"})`);
                  });
                  findings.push({
                    type: "direct-transfer",
                    severity: "medium",
                    title: "Direct wallet transfer",
                    description: `${transfers.length} transfer(s) found between ${nameA} and ${nameB} on ${chain.name}.`,
                    profiles: [
                      profiles[i].profile.profileId!,
                      profiles[j].profile.profileId!,
                    ],
                    details: {
                      chain: chain.name,
                      transfers: transfers.map((t) => ({
                        from: t.from,
                        to: t.to,
                        value: t.value,
                        asset: t.asset,
                        txHash: t.txHash,
                      })),
                    },
                  });
                } else {
                  log("info", `  No transfers found on ${chain.name}`);
                }
              } catch (err) {
                log("error", `  Transfer check failed on ${chain.name}: ${err instanceof Error ? err.message : String(err)}`);
              }
            }
          }
        }
      }
    }
  }

  // =========================================
  // Step 4: Funder expansion - find other profiles funded by same wallets
  // =========================================
  log("info", "--- Step 4: Funder expansion (tracing funder wallets) ---");

  // Collect all unique first-funder addresses (deduplicated)
  const knownWallets = new Set(allWallets.map((w) => w.wallet.toLowerCase()));
  const knownProfileIds = new Set(profiles.map((sp) => sp.profile.profileId!));
  const uniqueFunders = new Map<string, { chains: string[]; fundedProfiles: string[] }>();

  firstFunderData.forEach((funders, profileId) => {
    const name = profiles.find((p) => p.profile.profileId === profileId)?.profile.displayName || `Profile ${profileId}`;
    funders.forEach((f) => {
      const key = f.funder.toLowerCase();
      if (!uniqueFunders.has(key)) {
        uniqueFunders.set(key, { chains: [], fundedProfiles: [] });
      }
      const entry = uniqueFunders.get(key)!;
      if (!entry.chains.includes(f.chain)) entry.chains.push(f.chain);
      if (!entry.fundedProfiles.includes(name)) entry.fundedProfiles.push(name);
    });
  });

  if (uniqueFunders.size === 0) {
    log("info", "No funder wallets to expand");
  } else {
    log("info", `Tracing ${uniqueFunders.size} unique funder wallet(s) for other funded Ethos profiles...`);

    const discoveredWallets = new Map<string, { funderAddress: string; chain: string; txHash: string }>();

    for (const [funderAddress, info] of uniqueFunders) {
      log("info", `Checking outgoing transfers from funder ${funderAddress.slice(0, 8)}...${funderAddress.slice(-4)} (funded: ${info.fundedProfiles.join(", ")})`);

      // Check Base first, then other chains
      for (const chain of CHAINS) {
        log("info", `  Fetching outgoing transfers on ${chain.name}...`);
        try {
          const outgoing = await getOutgoingTransfers(funderAddress, chain, 3);
          if (outgoing.length === 0) {
            log("info", `    No outgoing transfers on ${chain.name}`);
            continue;
          }

          log("info", `    Found ${outgoing.length} outgoing transfer(s)`);

          // Filter to wallets we don't already know about
          const newWallets = outgoing.filter(
            (t) => !knownWallets.has(t.to.toLowerCase())
          );

          // Deduplicate destination wallets
          const uniqueDestinations = new Map<string, { txHash: string }>();
          newWallets.forEach((t) => {
            const to = t.to.toLowerCase();
            if (!uniqueDestinations.has(to) && !discoveredWallets.has(to)) {
              uniqueDestinations.set(to, { txHash: t.txHash });
            }
          });

          log("info", `    ${uniqueDestinations.size} new unique destination wallet(s) to check`);

          // Look up each destination wallet on Ethos
          let matchCount = 0;
          for (const [destWallet, { txHash }] of uniqueDestinations) {
            try {
              const profile = await fetchProfile(destWallet);
              if (profile && profile.profileId && !knownProfileIds.has(profile.profileId)) {
                matchCount++;
                knownProfileIds.add(profile.profileId);
                const wallets = getWalletAddresses(profile);
                wallets.forEach((w) => knownWallets.add(w.toLowerCase()));

                log("warn", `    FOUND: ${profile.displayName} (@${profile.username || "?"}, score: ${profile.score}) - also funded by this wallet on ${chain.name}`);

                discoveredWallets.set(destWallet, {
                  funderAddress,
                  chain: chain.name,
                  txHash,
                });

                findings.push({
                  type: "shared-funder",
                  severity: "high",
                  title: "Shared funder (expanded)",
                  description: `${profile.displayName} (@${profile.username || "?"}) was also funded by the same wallet${funderProfiles.has(funderAddress) ? ` belonging to ${funderProfiles.get(funderAddress)!.displayName}` : ""} (${funderAddress.slice(0, 6)}...${funderAddress.slice(-4)}) on ${chain.name}. This wallet also funded ${info.fundedProfiles.join(", ")}.`,
                  profiles: [...knownProfileIds].filter((id) => id !== profile.profileId).slice(0, 5).concat(profile.profileId!),
                  details: {
                    funderAddress,
                    funderProfile: funderProfiles.get(funderAddress) || undefined,
                    discoveredProfile: {
                      profileId: profile.profileId,
                      displayName: profile.displayName,
                      username: profile.username,
                      score: profile.score,
                      wallet: destWallet,
                    },
                    chain: chain.name,
                    txHash,
                  },
                });
              }
            } catch {
              // Not an Ethos profile, skip
            }
          }

          if (matchCount === 0) {
            log("info", `    No Ethos profiles found among funded wallets on ${chain.name}`);
          }
        } catch (err) {
          log("error", `    Error tracing funder on ${chain.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    if (discoveredWallets.size === 0) {
      log("info", "No additional Ethos profiles found via funder expansion");
    } else {
      log("warn", `Funder expansion discovered ${discoveredWallets.size} additional Ethos profile(s)!`);
    }
  }

  // Sort findings by severity
  const severityOrder = { high: 0, medium: 1, low: 2 };
  findings.sort(
    (a, b) => severityOrder[a.severity] - severityOrder[b.severity]
  );

  log("info", `--- Scan complete: ${findings.length} finding(s) ---`);

  // Build profile scan data for overview
  const profileScanData: ProfileScanData[] = profiles.map((sp) => {
    const pid = sp.profile.profileId!;
    return {
      profileId: pid,
      displayName: sp.profile.displayName,
      username: sp.profile.username,
      score: sp.profile.score,
      wallets: sp.wallets,
      invitationCount: (invitationMap.get(pid) || []).length,
      firstFunders: (firstFunderData.get(pid) || []).map((ff) => ({
        ...ff,
        funderProfile: funderProfiles.get(ff.funder.toLowerCase()) || undefined,
      })),
    };
  });

  return { findings, logs, profileData: profileScanData };
}
