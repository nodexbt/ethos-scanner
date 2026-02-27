"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Users, Search } from "lucide-react";
import Link from "next/link";

export default function Home() {
  return (
    <div className="p-4 md:p-8">
      <div className="mx-auto max-w-4xl space-y-8">
        <div className="space-y-2 py-8">
          <h1 className="text-4xl font-bold tracking-tight">Ethos Scanner</h1>
          <p className="text-muted-foreground">
            Look up Ethos Network profiles by X username or EVM address
          </p>
          <p className="text-sm text-muted-foreground flex items-center gap-1.5 pt-2">
            <Search className="h-3.5 w-3.5" />
            Use the search in the sidebar to get started
          </p>
        </div>

        <Card>
          <CardContent className="pt-6">
            <Link href="/cluster">
              <Button variant="outline" className="w-full gap-2">
                <Users className="h-4 w-4" />
                Cluster Investigation
                <span className="text-xs text-muted-foreground ml-2">
                  Investigate connections between multiple profiles
                </span>
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
