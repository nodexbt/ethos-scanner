# Design decisions

The non-obvious calls, each with the problem that forced it. Newest first.

## Scans run as background jobs, and the server saves the result

**Problem.** The first version streamed the scan over one long HTTP response and the browser posted the finished result back to be saved. Closing the tab lost the scan, a slow scan could exceed the function limit mid-stream, and anything the client could submit the client could forge.

**Decision.** `POST /api/scan` creates a `scan_jobs` row and returns 202; the work continues in Next's `after()` hook, flushing logs and progress to the row every second. The client polls. The result is saved server-side before the job is marked done. Streaming survives only as a fallback for clients that do not send the job header.

**Consequence.** Quotas, the edge graph and public pages can trust what is in the database. A reload resumes the running job. Jobs without a heartbeat for six minutes are marked stale instead of spinning forever.

## A degraded scan never overwrites a complete one

**Problem.** When one chain or one Ethos lookup failed mid-scan, the scan "completed" with fewer findings. Saving it silently erased real links from an earlier good scan.

**Decision.** Any failure during a scan marks the result `degraded` with the failed networks and reasons. Degraded results are shown with a banner and saved only when no complete result exists; otherwise the save is refused with a 409 the UI explains. Coverage caps that bite are recorded as `coverageNotes` on the result, so bounded coverage is visible rather than silent.

## EIP-7702 delegated wallets are personal wallets

**Problem.** The scanner skips smart-contract wallets because many profiles share the same proxy implementation and the same Ethos contracts, which manufactures false clusters. The original test was "any bytecode means contract". MetaMask and Coinbase smart accounts upgrade a normal wallet with EIP-7702, which leaves a 23-byte delegation designator as code. Around 21,000 of 29,500 flagged wallets were really people, and their profiles scanned as empty.

**Decision.** Code that is exactly `0xef0100 || 20-byte address` counts as an EOA. The length check is exact so nothing else starting with `0xef` is exempted.

## Classification is failure-safe

**Problem.** A transient RPC failure while classifying wallets used to default to "no code", which was then persisted as "personal wallet" for a real smart wallet.

**Decision.** `batchGetCode` returns only the addresses the RPC answered for. A wallet is recorded as an EOA only when every chain answered and none had contract code; otherwise it stays unclassified and is re-checked next time.

## Social signals score zero

**Problem.** Mutual vouches, mutual reviews and invitations each added two points. People legitimately vouch for, review and invite each other all the time, and the points pushed unrelated profiles over the "possible" threshold.

**Decision.** Social signals and direct transfers are recorded and displayed for context, but carry no weight. Only on-chain origin signals (who funded whom, shared exchange deposit addresses) move the score. Direct transfers are how candidates are *found*, not how they are scored.

## Results are per profile, not per wallet

**Problem.** One person has several attested wallets. Scoring wallets individually split one person's evidence across several cards and double-counted links.

**Decision.** All attested EOAs of the target are scanned as one. Candidates are merged by Ethos profile id across wallets and chains, with one instance of each signal type kept. Confidence is recomputed after every merge and can only go up.

## Ethos profiles are mirrored, not fetched per scan

**Problem.** Mapping thousands of counterparty wallets to Ethos profiles per scan meant thousands of API calls, and the public API has no "which profile owns this wallet" bulk endpoint fast enough for that.

**Decision.** A daily GitHub Actions job mirrors every profile and its wallets into Supabase from the public Ethos API. A scan does one local query. The mirror also pre-classifies new wallets so the hot path never calls `eth_getCode` for known ones.

## Sturdy over cheap

**Problem.** A capped "quick" scan was cheap but missed links, and a tool whose answer depends on which mode you picked is not evidence.

**Decision.** One mode. Target history up to 50 pages per direction per chain, all transfer categories for discovery, native transfers only for funding analysis. Heavy profiles cost roughly 235k Alchemy compute units (about twelve cents). Wherever a cap still bites, the result says so.

## Access: open bar plus allowlist

**Problem.** The tool started as an internal allowlist. Opening it to all of Ethos risked abuse of a paid data source.

**Decision.** Anyone with a human-verified Ethos profile and a score of at least 1800, or a validator NFT, may sign in. A manual allowlist, with an audit log, covers everyone else. Sign-in requires the X account to be attested to the Ethos profile by immutable X user id, not by handle, because handles are recyclable.

## AI-assisted development

Most of the code was written with Claude Code in a pair-programming loop: I set the product direction, made the decisions above, reviewed every diff and tested against production data. Commits carry a co-author line where that is the case.
