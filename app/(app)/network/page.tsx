import type { Metadata } from "next";
import { NetworkView } from "@/components/network/network-view";

export const metadata: Metadata = { title: "Network" };

export default function NetworkPage() {
  return <NetworkView />;
}
