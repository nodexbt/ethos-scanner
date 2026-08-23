"use client";

import { signIn } from "next-auth/react";
import { motion } from "framer-motion";
import {
  Shield,
  Search,
  GitBranch,
  FileText,
  ArrowRight,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import DecryptedText from "@/components/ui/decrypted-text";
import { MIN_SCORE } from "@/lib/access";

// Mirrors DAILY_SCAN_LIMIT in lib/db/scan-quota.ts, which can't be imported
// here without pulling the server-side Supabase client into the bundle.
const DAILY_SCAN_LIMIT = 25;

/**
 * Public landing page shown at "/" when there is no session. Everything on
 * it is static marketing content — the only interactive element is the
 * sign-in button — so it can render before auth resolves without flashing.
 */

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function SignInButton({ className }: { className?: string }) {
  return (
    <Button
      onClick={() => signIn("twitter", { callbackUrl: "/" })}
      className={`gap-2 h-10 px-5 ${className ?? ""}`}
    >
      <XIcon className="h-4 w-4" />
      Sign in with X
    </Button>
  );
}

/* ------------------------------------------------------------------ */
/* Mock scan demo                                                      */
/* ------------------------------------------------------------------ */

const DEMO_LOG: { text: string; dim?: boolean }[] = [
  { text: "$ scan 0x3f9c…a21c" },
  { text: "[base]      1,204 transfers fetched", dim: true },
  { text: "[ethereum]    356 transfers fetched", dim: true },
  { text: "[arbitrum]     89 transfers fetched", dim: true },
  { text: "→ 41 counterparties · 12 promising candidates", dim: true },
  { text: "→ correlation: first funders, CEX deposits, funding chains", dim: true },
  { text: "✓ scan complete — 2 linked profiles found" },
];

const DEMO_SIGNALS: { name: string; weight: number; detail: string }[] = [
  {
    name: "funded_by_target",
    weight: 10,
    detail: "wallet's first-ever transaction came from the target",
  },
  {
    name: "shared_cex_deposit",
    weight: 8,
    detail: "both wallets consolidate to the same exchange deposit address",
  },
  {
    name: "mutual_vouches",
    weight: 2,
    detail: "profiles vouched for each other on Ethos",
  },
];

function DemoScanPanel() {
  return (
    <div className="w-full rounded-lg border border-border bg-card/70 backdrop-blur-sm overflow-hidden text-left">
      {/* Terminal chrome */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border bg-background/40">
        <span className="h-2.5 w-2.5 rounded-full border border-border" />
        <span className="h-2.5 w-2.5 rounded-full border border-border" />
        <span className="h-2.5 w-2.5 rounded-full border border-border" />
        <span className="ml-2 text-[10px] text-muted-foreground font-mono truncate">
          ethos-scanner — example result
        </span>
      </div>

      <div className="p-4 font-mono text-[11px] leading-relaxed">
        {DEMO_LOG.map((line, i) => (
          <div
            key={i}
            className={line.dim ? "text-muted-foreground" : "text-foreground"}
          >
            {line.text}
          </div>
        ))}

        {/* Result card */}
        <div className="mt-3 rounded-md border border-border bg-background/50 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-xs font-semibold">@an•••••us</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-foreground text-background font-semibold uppercase tracking-wide">
              high confidence
            </span>
          </div>
          {DEMO_SIGNALS.map((s) => (
            <div key={s.name} className="flex items-start gap-2">
              <span className="shrink-0 text-[10px] px-1 rounded bg-muted font-semibold tabular-nums">
                +{s.weight}
              </span>
              <div className="min-w-0">
                <div className="text-[11px] font-medium">{s.name}</div>
                <div className="text-[10px] text-muted-foreground">{s.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sections                                                            */
/* ------------------------------------------------------------------ */

const STEPS = [
  {
    icon: Search,
    title: "Paste a profile or wallet",
    body: "An Ethos profile, X handle, or any EVM address. The scanner pulls its full transfer history across Base, Ethereum, Arbitrum, Optimism, and Polygon in parallel.",
  },
  {
    icon: GitBranch,
    title: "Correlate the cluster",
    body: "Fourteen weighted signals — shared first funders, common exchange deposit addresses, multi-hop funding chains, mutual vouches — separate coordination from coincidence.",
  },
  {
    icon: FileText,
    title: "Get evidence you can share",
    body: "A scored, human-readable report of every linked profile and the exact on-chain evidence behind each signal, with a shareable link.",
  },
];

const SIGNAL_HIGHLIGHTS = [
  {
    name: "First-funder tracing",
    body: "A wallet's first incoming transaction is its on-chain birth certificate. When it comes from the target — or the target's cluster — the wallets almost always share an owner.",
  },
  {
    name: "Shared CEX deposits",
    body: "Exchange deposit addresses are unique per customer. Two wallets consolidating to the same one is the cleanest smoking gun there is.",
  },
  {
    name: "Funding-chain discovery",
    body: "Funders are traced a hop deeper to surface Ethos profiles connected through shared funding chains, not just direct transfers.",
  },
  {
    name: "Social corroboration",
    body: "Mutual vouches, mutual reviews, and invitation trees from the Ethos graph stack on top of the on-chain evidence.",
  },
];

interface LandingPageProps {
  /** Auth/eligibility error carried over from the NextAuth redirect. */
  authError?: string | null;
}

export function LandingPage({ authError }: LandingPageProps) {
  return (
    <div className="relative min-h-screen">
      {/* Soft veil over the dither shader so long-form text stays readable —
          the noise is much denser in light mode than dark. Sits between the
          -z-10 background and the content. */}
      <div className="fixed inset-0 -z-[5] bg-background/65 pointer-events-none" />
      <div className="fixed top-4 right-4 z-10">
        <ThemeToggle />
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 pb-16">
        {/* Hero */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="pt-24 sm:pt-32 pb-16 text-center"
        >
          <div className="inline-flex items-center gap-2 h-10 bg-card/70 backdrop-blur-sm border border-border rounded-lg px-3 mb-8">
            <Shield className="h-4.5 w-4.5 shrink-0" />
            <DecryptedText
              text="Ethos Scanner"
              speed={40}
              maxIterations={12}
              sequential
              revealDirection="start"
              animateOn="view"
              useOriginalCharsOnly={false}
              parentClassName="font-[family-name:var(--font-ibm-plex-mono)] font-semibold text-base tracking-tight"
              className="text-foreground"
              encryptedClassName="text-muted-foreground"
            />
          </div>

          <h1 className="font-[family-name:var(--font-ibm-plex-mono)] text-3xl sm:text-5xl font-semibold tracking-tight text-balance">
            Reputation you can verify.
          </h1>
          <p className="mt-4 text-sm sm:text-base text-muted-foreground max-w-xl mx-auto text-balance">
            Scan any Ethos profile for hidden wallet clusters — accounts
            linked by shared funding, exchange deposits, and transfer
            patterns across five networks.
          </p>

          <div className="mt-8 flex flex-col items-center gap-3">
            <SignInButton />
            {authError && (
              <div className="text-xs text-red-500 max-w-sm">{authError}</div>
            )}
            <p className="text-[11px] text-muted-foreground">
              Open to Ethos validators and human-verified profiles with a score
              of {MIN_SCORE}+.
            </p>
          </div>
        </motion.section>

        {/* Demo */}
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.4 }}
          className="pb-20 max-w-2xl mx-auto"
        >
          <DemoScanPanel />
        </motion.section>

        {/* How it works */}
        <section className="pb-20">
          <h2 className="font-[family-name:var(--font-ibm-plex-mono)] text-lg font-semibold text-center mb-8">
            How it works
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {STEPS.map((step, i) => {
              const Icon = step.icon;
              return (
                <div
                  key={step.title}
                  className="rounded-lg border border-border bg-card/70 backdrop-blur-sm p-5 space-y-3"
                >
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-md border border-border bg-background/60 flex items-center justify-center">
                      <Icon className="h-4 w-4" />
                    </div>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      0{i + 1}
                    </span>
                  </div>
                  <div className="text-sm font-medium">{step.title}</div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {step.body}
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        {/* Signals */}
        <section className="pb-20">
          <h2 className="font-[family-name:var(--font-ibm-plex-mono)] text-lg font-semibold text-center mb-2">
            Signals that don&apos;t happen by accident
          </h2>
          <p className="text-xs text-muted-foreground text-center mb-8 max-w-md mx-auto">
            Every flag is built from patterns that are cheap to fake socially
            but expensive to fake on-chain.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {SIGNAL_HIGHLIGHTS.map((s) => (
              <div
                key={s.name}
                className="rounded-lg border border-border bg-card/70 backdrop-blur-sm p-5"
              >
                <div className="text-sm font-medium mb-1.5">{s.name}</div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {s.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Access + honesty */}
        <section className="pb-20 max-w-2xl mx-auto">
          <div className="rounded-lg border border-border bg-card/70 backdrop-blur-sm p-6 space-y-4">
            <h2 className="font-[family-name:var(--font-ibm-plex-mono)] text-base font-semibold">
              Who can use it
            </h2>
            <ul className="space-y-2 text-xs text-muted-foreground">
              {[
                "Ethos validator NFT holders",
                `Human-verified Ethos profiles with a score of ${MIN_SCORE} or higher`,
                `${DAILY_SCAN_LIMIT} scans per day included`,
              ].map((line) => (
                <li key={line} className="flex items-start gap-2">
                  <Check className="h-3.5 w-3.5 shrink-0 mt-px" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-muted-foreground border-t border-border pt-4 leading-relaxed">
              The scanner surfaces evidence, not verdicts. Every signal can
              have an innocent explanation, and confidence tiers reflect the
              strength of the on-chain evidence — the final call is always
              yours.
            </p>
          </div>
        </section>

        {/* Bottom CTA */}
        <section className="text-center pb-8">
          <h2 className="font-[family-name:var(--font-ibm-plex-mono)] text-xl font-semibold mb-6 text-balance">
            Know who you&apos;re verifying.
          </h2>
          <SignInButton />
        </section>

        <footer className="pt-8 border-t border-border flex items-center justify-between text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Shield className="h-3.5 w-3.5" />
            Ethos Scanner
          </span>
          <a
            href="https://app.ethos.network/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
          >
            Built for Ethos Network
            <ArrowRight className="h-3 w-3" />
          </a>
        </footer>
      </div>
    </div>
  );
}
