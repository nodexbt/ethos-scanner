import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Scanner",
  description: "Sybil cluster detection on Ethos Network via on-chain transaction analysis.",
};

export default function ScannerLayout({ children }: { children: React.ReactNode }) {
  return children;
}
