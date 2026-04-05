"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Loader2, Wallet } from "lucide-react";

interface ScanInputProps {
  walletInput: string;
  setWalletInput: (value: string) => void;
  scanning: boolean;
  error: string | null;
  onSubmit: (e: React.FormEvent) => void;
}

export function ScanInput({ walletInput, setWalletInput, scanning, error, onSubmit }: ScanInputProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Wallet Cluster Scan</CardTitle>
        <CardDescription className="text-xs">
          Enter any EVM wallet address to discover related wallets across 5 chains.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <form onSubmit={onSubmit} className="flex gap-2">
          <div className="relative flex-1">
            <Wallet className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              placeholder="0x..."
              value={walletInput}
              onChange={(e) => setWalletInput(e.target.value)}
              className="pl-10 h-9 font-mono"
              disabled={scanning}
            />
          </div>
          <Button type="submit" size="sm" disabled={scanning || !walletInput.trim()}>
            {scanning ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
          </Button>
        </form>

        {error && <div className="text-xs text-red-500">{error}</div>}

        <div className="text-[10px] text-muted-foreground space-y-0.5">
          <p>Scans Ethereum, Base, Arbitrum, Optimism, and Polygon in parallel.</p>
          <p>Analyzes direct transfers, funding sources, and CEX deposit addresses.</p>
        </div>
      </CardContent>
    </Card>
  );
}
