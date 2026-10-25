import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ScannerView } from "@/components/scanner/scanner-view";

export const metadata: Metadata = { title: "Scanner" };

/** /scan/<0x address>: a wallet, which may belong to a profile. */
export default async function ScanAddressPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) notFound();
  const value = address.toLowerCase();
  return <ScannerView key={value} target={{ kind: "address", value }} />;
}
