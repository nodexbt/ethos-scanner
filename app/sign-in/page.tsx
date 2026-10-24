"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession, signIn } from "next-auth/react";
import { Shield } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SiteHeader } from "@/components/site-header";
import { AppFooter } from "@/components/app-footer";
import { authErrorMessage } from "@/lib/auth-errors";
import { MIN_SCORE } from "@/lib/access";

/** Only ever send people back to a path on this host. */
function safeCallbackUrl(raw: string | null): string {
  if (raw && raw.startsWith("/") && !raw.startsWith("//")) return raw;
  return "/scanner";
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function SignInCard() {
  const params = useSearchParams();
  const router = useRouter();
  const { status } = useSession();
  const callbackUrl = safeCallbackUrl(params.get("callbackUrl"));
  const error = authErrorMessage(params.get("error"));

  // Already signed in (e.g. pressed back after signing in): carry on.
  useEffect(() => {
    if (status === "authenticated") router.replace(callbackUrl);
  }, [status, callbackUrl, router]);

  return (
    <Card className="max-w-md mx-auto">
      <CardHeader className="text-center space-y-3 pb-6">
        <div className="inline-flex items-center justify-center h-14 w-14 rounded-full border border-border bg-background/60 mx-auto">
          <Shield className="h-7 w-7" />
        </div>
        <div className="space-y-1.5">
          <CardTitle className="text-2xl tracking-tight">Scanner</CardTitle>
          <CardDescription className="text-sm max-w-sm mx-auto">
            Sign in with X to run wallet cluster scans, browse saved scans and
            watch profiles. Your X account must be attested to your Ethos profile.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button
          onClick={() => signIn("twitter", { callbackUrl })}
          disabled={status === "loading"}
          className="w-full gap-2 h-10"
        >
          <XIcon className="h-4 w-4" />
          Sign in with X
        </Button>
        {error && <p className="text-xs text-red-500 text-center">{error}</p>}
        <p className="text-[11px] text-muted-foreground text-center">
          Open to Ethos validators and human-verified profiles with a score of {MIN_SCORE}+.
        </p>
      </CardContent>
    </Card>
  );
}

export default function SignInPage() {
  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-4xl mx-auto min-h-screen flex flex-col">
      <SiteHeader cta={null} />
      <div className="flex-1 flex items-center py-10">
        <div className="w-full">
          {/* useSearchParams needs a Suspense boundary in the app router. */}
          <Suspense fallback={null}>
            <SignInCard />
          </Suspense>
        </div>
      </div>
      <AppFooter />
    </div>
  );
}
