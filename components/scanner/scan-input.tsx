"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Loader2, Wallet } from "lucide-react";

interface ScanInputProps {
  walletInput: string;
  setWalletInput: (value: string) => void;
  scanning: boolean;
  error: string | null;
  onSubmit: (e: React.FormEvent) => void;
  /** One-line bar without title or hints — used above results so the
      input doesn't take a whole column once there's something to show. */
  compact?: boolean;
}

export function ScanInput({ walletInput, setWalletInput, scanning, error, onSubmit, compact }: ScanInputProps) {
  if (compact) {
    return (
      <Card>
        <CardContent className="p-3 space-y-2">
          <form onSubmit={onSubmit} className="flex gap-2">
            <div className="relative flex-1">
              <Wallet className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Scan another: 0x address or @handle"
                value={walletInput}
                onChange={(e) => setWalletInput(e.target.value)}
                className="pl-10 h-9 font-mono"
                disabled={scanning}
              />
            </div>
            <Button type="submit" size="sm" disabled={scanning || !walletInput.trim()}>
              {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            </Button>
          </form>
          {error && <div className="text-xs text-red-600 dark:text-red-500">{error}</div>}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-4 sm:p-5 space-y-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Scan a profile</h1>
          <p className="text-sm text-muted-foreground">
            Paste an X handle, an Ethos profile link or a wallet address. Every wallet attested to the profile is
            scanned across Ethereum, Base, Arbitrum, Optimism and Polygon.
          </p>
        </div>
        <form onSubmit={onSubmit} className="flex gap-2">
          <div className="relative flex-1">
            <Wallet className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              placeholder="@handle or 0x address"
              aria-label="Profile or wallet to scan"
              value={walletInput}
              onChange={(e) => setWalletInput(e.target.value)}
              className="pl-10 h-11 font-mono md:text-base"
              disabled={scanning}
            />
          </div>
          <Button type="submit" className="h-11 px-5" disabled={scanning || !walletInput.trim()}>
            {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Scan
          </Button>
        </form>
        {error && <div className="text-sm text-red-600 dark:text-red-500">{error}</div>}
      </CardContent>
    </Card>
  );
}
