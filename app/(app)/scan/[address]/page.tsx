import type { Metadata } from "next";
import { ScannerView } from "@/components/scanner/scanner-view";

export const metadata: Metadata = { title: "Scanner" };

export default async function ScanAddressPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  return <ScannerView target={address.toLowerCase()} />;
}
