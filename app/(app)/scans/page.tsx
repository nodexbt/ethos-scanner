import type { Metadata } from "next";
import { Suspense } from "react";
import { ScansView } from "@/components/scans/scans-view";
import { ScansListSkeleton } from "@/components/scans/scans-list";

export const metadata: Metadata = { title: "Scans" };

export default function ScansPage() {
  // useSearchParams (the scope) needs a Suspense boundary.
  return (
    <Suspense fallback={<ScansListSkeleton />}>
      <ScansView />
    </Suspense>
  );
}
