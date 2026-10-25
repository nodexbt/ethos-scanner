import type { Metadata } from "next";
import { ScannerView } from "@/components/scanner/scanner-view";

export const metadata: Metadata = { title: "Scanner" };

export default async function ScanHandlePage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  return <ScannerView target={`@${handle}`} />;
}
