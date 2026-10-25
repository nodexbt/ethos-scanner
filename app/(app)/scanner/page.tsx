import type { Metadata } from "next";
import { ScannerView } from "@/components/scanner/scanner-view";

export const metadata: Metadata = {
  title: "Scanner",
  description: "Sybil cluster detection on Ethos Network via on-chain transaction analysis.",
};

export default function ScannerPage() {
  return <ScannerView />;
}
