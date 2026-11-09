# Security

How ethos-scanner is defended, what it is defended against, and what is deliberately left open. Controls are mapped to the [OWASP Application Security Verification Standard 5.0](https://owasp.org/www-project-application-security-verification-standard/) (ASVS, the chapter in brackets) and, where it helps, to the [OWASP Top 10:2021](https://owasp.org/Top10/). Every control names the file that implements it so a reviewer can check the claim rather than take it.

## Threat model

**What is worth protecting.**

- The database. Scan results, the link graph between Ethos profiles, who scanned whom, and the allowlist of who may use the tool.
- The scanner's integrity. A result the UI calls "Strong" leads to real consequences for a real person's reputation. A wrong result is a security failure, not only a bug.
- Third-party credentials and budget. The Alchemy key spends money per call; the Supabase service key can read and write every table.
- Users' sessions. Access is gated on Ethos reputation; a stolen or over-long session hands that access to someone who did not earn it.

**Who the adversaries are.**

- Anyone on the internet, against the public pages and the API, with and without a session.
- A signed-in user acting beyond their role: reading another user's private scan, writing into another user's investigation, running more scans than the quota allows.
- A person being investigated, who wants a scan of themselves to come out clean, or a scan of someone else to come out dirty.
- Upstream services behaving badly: Alchemy or the Ethos API hanging, rate-limiting, or answering with the wrong shape.
- The supply chain: a compromised npm package or a known-vulnerable dependency.

**Trust boundaries.**

1. Browser to server. Nothing the browser says is trusted: the server resolves the target, runs the scan, saves the result and computes the quota. The browser only asks and polls.
2. Server to database. One credential, the Supabase service role, used only from server code. The database itself refuses every other role (see Data layer).
3. Server to upstream APIs. Alchemy, the Ethos API and the X API are treated as unreliable inputs: validated, timed out, and never allowed to turn a failure into a clean-looking result.
4. Public pages. `/p/<handle>` and `/s/<id>` are reachable without a session and are the surface most people will see. They get the least data and the strictest headers.

## Controls

### Authentication and session (ASVS V3, V7; Top 10 A07)

- **Identity is the immutable X user id, not the handle.** Sign-in resolves the X account to an Ethos profile and requires the profile to carry a `service:x.com:<id>` attestation for exactly that id. Handles are recyclable; ids are not. `app/api/auth/[...nextauth]/route.ts`, `fetchAttestedProfile`.
- **Access is a live property, not a sign-in snapshot.** Eligibility is validator NFT, or human-verified plus a score floor, or the manual allowlist (`lib/access.ts`). The score and verification fields in the session token are re-read from Ethos at most hourly, and the allowlist is re-checked on every protected request (`lib/auth.ts`, `lib/db/allowed-users.ts`). Losing eligibility ends access within an hour, not after the 30-day session.
- **An Ethos outage does not sign everyone out.** If the refresh fails the cached values are kept and retried; a profile that is no longer attested is revoked. Fail safe without failing closed on the whole user base.
- **Sessions are signed JSON Web Tokens (NextAuth).** No session store to leak; secrets live only in environment variables.
- **No password handling anywhere.** OAuth 2.0 with PKCE via X; the app never sees a password.

### Access control (ASVS V4; Top 10 A01)

- **Every API route goes through `requireAuth` or `requireAdmin`** (`lib/auth.ts`), which checks session, eligibility and role server-side. There is no client-side-only gate on data.
- **Ownership checks on mutation.** Sharing an investigation, watching a profile and reading job progress are scoped to the caller's profile id (`app/api/investigations/[id]/route.ts`, `app/api/scan/jobs/[id]/route.ts`, `app/api/watchlist/route.ts`).
- **Admin is an environment setting, not a database flag** (`lib/admin.ts`), so a database write cannot grant it.
- **Attribution is admin-only.** Who scanned a wallet is stripped from API responses for non-admins before it reaches the wire (`app/api/investigations/route.ts`).
- **Removed rather than restricted.** The old `POST /api/investigations` let any signed-in user write arbitrary JSON into any investigation's evidence. Nothing used it; it was deleted.

### Cross-site request forgery (ASVS V4.2.2)

- **Two independent locks.** NextAuth's session cookie is `SameSite=Lax`, so browsers withhold it on cross-site POSTs. On top of that, `requireAuth` refuses any request whose `Sec-Fetch-Site` says `cross-site` or whose `Origin` does not match the serving host (`lib/origin.ts`, tested in `tests/origin.test.ts`). The second lock is there so protection does not rest on one cookie attribute, and so it keeps holding when automation adds non-cookie credentials.

### Input validation (ASVS V5; Top 10 A03)

- **The scan target is parsed, not trusted.** `parseScanInput` (`lib/scan-target.ts`) accepts an address, an `@handle` or an Ethos profile URL on an allow-listed host, and nothing else. The server then resolves the profile's attested wallets itself; a client cannot supply a wallet list. There is no fetch of a user-supplied URL anywhere, so no server-side request forgery path.
- **Bodies are parsed defensively.** Malformed JSON is a 400 with a plain message, never a 500 with a stack trace in the logs; the target is length-capped before anything reads it (`app/api/scan/route.ts`, tested in `tests/scan-route.test.ts`).
- **Database filters are sanitised** before reaching PostgREST (`lib/list-params.ts`), and all queries use the Supabase client's parameterised builder. No string-built SQL.
- **Outbound links are checked.** `safeExternalUrl` on every external `href`; `safeCallbackUrl` keeps post-login redirects on this host (no open redirect).

### Data layer (ASVS V1.4, V6; Top 10 A01, A02)

- **Row-level security is enabled on every table with no policies** (`scripts/migrations/2026-11-08-row-level-security.sql`). Only the service role, which bypasses RLS, can read or write. Supabase issues a public `anon` key to every project; with RLS on, that key can do nothing here even if it leaks or another product shares the project.
- **The quota function is revoked from `anon` and `authenticated`.** The database-side counter (`increment_scan_quota`) is callable only by the service role.
- **The service key never reaches the client.** It is read only in `lib/db/supabase.ts` on the server. No `NEXT_PUBLIC_` secret exists.
- **Secrets live in the environment.** `.env.example` lists names only. The repository holds no credentials, and `.env.local` is ignored.

### Output and the public surface (ASVS V5.3, V14.4; Top 10 A05)

- **Public share links return a defined payload, not the stored row.** `lib/share-payload.ts` is the single place that decides what `/s/<id>` can see: the result, the target and the time. The scan log (which names every wallet touched), the Alchemy usage, investigator notes and internal ids stay server-side. Tested in `tests/share-payload.test.ts`.
- **Share ids are 22 characters from a cryptographically secure generator** (about 114 bits), so enumeration is not practical even before the per-IP rate limit on the endpoint.
- **Security headers on every response** (`next.config.ts`): a Content-Security-Policy (below), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` plus `frame-ancestors 'none'`, `Referrer-Policy: strict-origin-when-cross-origin`, a restrictive `Permissions-Policy`, and `Strict-Transport-Security` for two years in production.
- **Content-Security-Policy.** `default-src 'self'`; scripts, fetches and workers only from this origin plus Vercel's analytics; `object-src 'none'`; `base-uri 'self'`; `form-action 'self'`; images from any HTTPS host because Ethos avatars live on many CDNs. `script-src` still carries `'unsafe-inline'`, see Accepted risks. The policy was verified with a `securitypolicyviolation` listener installed before page load on every public route: zero violations, fonts loaded, WebGL background running.

### Resilience and fail-safe behaviour (ASVS V7.4, V10; Top 10 A04, A09)

A scan that silently loses data is worse than one that fails, because the saved result is then wrong with confidence. The pipeline is built so every failure is either retried or recorded on the result.

- **Every outbound request has a timeout** (20 s for Alchemy and Ethos, less for the small lookups). A hung socket cannot stall a chain while the job heartbeat keeps saying "running". `lib/alchemy.ts`, `lib/ethos.ts`, `lib/twitter-search.ts`.
- **Lookups that cannot tell "nothing there" from "could not check" throw** (`AlchemyError`) instead of returning empty, and every call site turns that into a `degraded` mark on the result (`lib/cluster-scanner.ts`). This covers first-funder lookups, outgoing and incoming transfer traces and exchange-deposit checks.
- **A degraded result is shown with a banner and never saved over a complete one** (`lib/db/investigations.ts`, tested in `tests/degraded-guard.test.ts`).
- **Coverage caps are recorded, not hidden.** When the target's or a candidate's history exceeds the fetch cap, the result carries a `coverageNotes` entry saying so.
- **Rate limits are respected, not hammered.** A rate-limited Ethos bulk lookup is retried with backoff; the old per-address fallback (up to 500 sequential calls into a 429) is gone. A 200 with an unexpected body is treated as a failure, not as "no profiles". `lib/ethos.ts`, tested in `tests/ethos-bulk.test.ts`.
- **The background job runner cannot die silently.** Progress flushes and final status writes are wrapped so a transient database error is logged and retried on the next tick rather than becoming an unhandled rejection that leaves the job "running" forever (`lib/scan-runner.ts`).
- **Scoring is tested end to end on a fixture chain** (`tests/scan-pipeline.test.ts`), including the cases that used to inflate confidence: exchange hot wallets as shared senders, the same funding event counted twice, and auto-Strong from a wallet that was never in the results.

### Abuse limits (ASVS V11)

- **Daily scan quota per profile**, counted in the database so it survives redeploys and multiple instances (`lib/db/scan-quota.ts`). Admins are exempt.
- **One active scan per user.** A second request returns the running job instead of starting another.
- **The quota is charged after validation**, so malformed input cannot burn a scan, and the client only starts a scan when the server says a saved one does not exist (a 404), not on any error.

### Supply chain and build (ASVS V1.14, V14.2; Top 10 A06, A08)

- **CI fails on any high or critical advisory in production dependencies** (`npm audit --omit=dev --audit-level=high` in `.github/workflows/ci.yml`), alongside typecheck, lint and tests on every pull request.
- **Dependabot** opens security updates as they are published and batches the rest weekly, for npm and for the GitHub Actions themselves (`.github/dependabot.yml`).
- **Lockfile committed; `npm ci` in CI**, so the build is reproducible and a tampered registry version cannot slip in unnoticed.
- **Vercel preview deployments per pull request** give a running copy to check before merge.

## Accepted risks and open decisions

Written down so they are decisions, not omissions.

| Item | Status | Reasoning |
| --- | --- | --- |
| `script-src 'unsafe-inline'` in the CSP | Accepted for now | Next.js emits its server-component payload as inline scripts and only nonces them on per-request rendering. The public pages are cached (ISR). The rest of the policy (`object-src`, `base-uri`, `form-action`, `connect-src`, `frame-ancestors`) still limits what an injected script could do. Upgrade path: a `proxy.ts` nonce with `'strict-dynamic'` once those pages can be rendered dynamically. |
| Share-endpoint rate limit is per instance | Accepted | `lib/rate-limit.ts` is in-process memory, so the real limit is multiplied by the number of warm instances. With 114-bit share ids this is a speed bump, not the control. It must not be reused for anything that matters; a shared store (Upstash) is the upgrade. |
| Public profile pages show the link graph of scans their owners never shared | Open product decision | `/p/<handle>` is public by design and shows who is linked and how strongly, with no evidence. The share dialog meanwhile says "This scan is private". Either the public page should count only shared scans, or the copy should say what the page does. The data exposure is the summary already visible to any signed-in user. |
| No API keys or service identity | Open, blocks automation | Everything runs as a person's session. Before a scheduler or external caller is added, `requireAuth` needs a key path with its own quota and audit trail rather than a borrowed session. |
| Admin via environment variable | Accepted | Simple and database-independent; the cost is a redeploy to change admins. Fine at the current team size. |

## Verifying the claims

```sh
npm run typecheck && npm run lint && npm test     # 56 tests, including the security ones named above
npm audit --omit=dev --audit-level=high           # production dependency gate
curl -sI https://ethos.tools/ | grep -i -E "content-security|strict-transport|x-frame|permissions-policy"
curl -s -X POST https://ethos.tools/api/watchlist -H "Origin: https://evil.example" -d '{}'   # 403 Cross-site request refused
```

The review that produced most of these controls, with the findings that are still open, is in [`review-2026-11-08.md`](review-2026-11-08.md). Vulnerability reports: see [`SECURITY.md`](../SECURITY.md) at the repository root.
