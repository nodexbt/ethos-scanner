"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, ArrowRight, ArrowLeftRight, Check, X, Users, Shield } from "lucide-react";
import { motion } from "framer-motion";
import { useSession, signIn } from "next-auth/react";
import { AppHeader } from "@/components/app-header";
import { ThemeToggle } from "@/components/theme-toggle";
import type { FollowRelationship } from "@/lib/twitter-search";

export default function FollowsPage() {
  const { data: session, status: sessionStatus } = useSession();
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FollowRelationship | null>(null);

  const canSubmit = source.trim().length > 0 && target.trim().length > 0 && !loading;

  async function check() {
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const params = new URLSearchParams({ source, target });
      const res = await fetch(`/api/twitter/follow-check?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Follow check failed");
        return;
      }
      setResult(data as FollowRelationship);
    } catch {
      setError("Network error — please try again");
    } finally {
      setLoading(false);
    }
  }

  // Loading session
  if (sessionStatus === "loading") {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Not logged in — mirror the home page sign-in gate.
  if (!session) {
    return (
      <div className="flex items-center justify-center min-h-screen p-4">
        <div className="fixed top-4 right-4 z-10">
          <ThemeToggle />
        </div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="w-full max-w-md"
        >
          <Card className="w-full backdrop-blur-sm bg-card/80">
            <CardHeader className="text-center space-y-3 pb-6">
              <div className="inline-flex items-center justify-center h-14 w-14 rounded-full border border-border bg-background/60 mx-auto">
                <Shield className="h-7 w-7" />
              </div>
              <div className="space-y-1.5">
                <CardTitle className="text-2xl tracking-tight">Follow Check</CardTitle>
                <CardDescription className="text-sm max-w-sm mx-auto">
                  Sign in to check the follow relationship between two X accounts.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <Button
                onClick={() => signIn("twitter", { callbackUrl: "/follows" })}
                className="w-full gap-2 h-10"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
                Sign in with X
              </Button>
              <p className="mt-2 text-[11px] text-muted-foreground text-center">
                Access restricted to approved Ethos profiles.
              </p>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-7xl mx-auto">
      <AppHeader />

      <div className="mx-auto mt-6 max-w-2xl">
        <div className="mb-6 flex items-center gap-2">
          <Users className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-2xl font-semibold tracking-tight">Follow Check</h1>
        </div>

        <Card className="backdrop-blur-sm bg-card/80">
          <CardHeader>
            <CardTitle>Do these two accounts follow each other?</CardTitle>
            <CardDescription>
              Enter two X handles to check the follow relationship in both directions.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="flex flex-col gap-3 sm:flex-row sm:items-center"
              onSubmit={(e) => {
                e.preventDefault();
                check();
              }}
            >
              <Input
                placeholder="@source"
                value={source}
                onChange={(e) => setSource(e.target.value)}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                aria-label="Source handle"
              />
              <ArrowLeftRight className="hidden h-4 w-4 shrink-0 text-muted-foreground sm:block" />
              <Input
                placeholder="@target"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                aria-label="Target handle"
              />
              <Button type="submit" disabled={!canSubmit} className="shrink-0">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Check"}
              </Button>
            </form>

            {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

            {result && (
              <div className="mt-6 space-y-3">
                <RelationRow
                  from={result.source}
                  to={result.target}
                  follows={result.sourceFollowsTarget}
                />
                <RelationRow
                  from={result.target}
                  to={result.source}
                  follows={result.targetFollowsSource}
                />
                <div
                  className={`rounded-md border p-3 text-sm font-medium ${
                    result.mutual
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      : "border-border bg-muted/40 text-muted-foreground"
                  }`}
                >
                  {result.mutual
                    ? "✓ Mutual — both accounts follow each other."
                    : result.sourceFollowsTarget || result.targetFollowsSource
                    ? "One-way follow only — not mutual."
                    : "Neither account follows the other."}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function RelationRow({
  from,
  to,
  follows,
}: {
  from: string;
  to: string;
  follows: boolean;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border p-3 text-sm">
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
          follows
            ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
            : "bg-muted text-muted-foreground"
        }`}
      >
        {follows ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
      </span>
      <span className="font-medium">@{from}</span>
      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="font-medium">@{to}</span>
      <span className="ml-auto text-muted-foreground">
        {follows ? "follows" : "does not follow"}
      </span>
    </div>
  );
}
