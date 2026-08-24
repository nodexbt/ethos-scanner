import { Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Attention points shown beneath every scan result — in-app and on the
 * public share page — so nobody treats a scan as a verdict in either
 * direction: flagged isn't guilty, and clean isn't innocent.
 */

const POINTS: { title: string; body: string }[] = [
  {
    title: "Signals, not a verdict",
    body: "Every flag is an on-chain pattern with a weight, and several have innocent explanations — a friend funding a new wallet, an OTC desk, a shared custodian. Confidence tiers reflect the strength of the evidence, not certainty of guilt.",
  },
  {
    title: "A clean result is not proof of innocence",
    body: "This tool only sees on-chain links. Someone using independently funded, clean wallets that never touch each other — or coordination that is purely social — will not show up here.",
  },
  {
    title: "Do your own research",
    body: "Treat these results as one input in a broader investigation: posting behavior, timelines, community context, and anything else off-chain. This tool exists to support that research, not to replace it.",
  },
];

export function ResearchDisclaimer() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Info className="h-4 w-4" />
          Before you draw conclusions
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {POINTS.map((p) => (
          <div key={p.title} className="text-xs">
            <span className="font-medium">{p.title}.</span>{" "}
            <span className="text-muted-foreground">{p.body}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
