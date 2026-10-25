import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ScannerView } from "@/components/scanner/scanner-view";

export const metadata: Metadata = { title: "Scanner" };

/** /scan/x/<handle>: an X handle, even when it is all digits. */
export default async function ScanHandlePage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) notFound();
  return <ScannerView key={handle} target={{ kind: "handle", value: handle }} />;
}
