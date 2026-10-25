import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ScannerView } from "@/components/scanner/scanner-view";

export const metadata: Metadata = { title: "Scanner" };

/** /scan/p/<profileId>: an Ethos profile id (no handle, or a saved-scan link). */
export default async function ScanProfileIdPage({ params }: { params: Promise<{ profileId: string }> }) {
  const { profileId } = await params;
  if (!/^\d{1,12}$/.test(profileId)) notFound();
  return <ScannerView key={profileId} target={{ kind: "profileId", value: profileId }} />;
}
