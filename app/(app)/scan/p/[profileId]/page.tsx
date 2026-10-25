import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ScannerView } from "@/components/scanner/scanner-view";

export const metadata: Metadata = { title: "Scanner" };

// Profiles addressed by Ethos profile id (no X handle, or a link built from
// a saved scan). Kept off /scan/x/ so an all-digit X handle is never read
// as an id.
export default async function ScanProfileIdPage({ params }: { params: Promise<{ profileId: string }> }) {
  const { profileId } = await params;
  if (!/^\d{1,12}$/.test(profileId)) notFound();
  return <ScannerView target={`https://app.ethos.network/profile/${profileId}`} />;
}
