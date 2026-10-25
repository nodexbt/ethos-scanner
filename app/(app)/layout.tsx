import { AppShell } from "@/components/app-shell";

// Every signed-in page shares one shell, so the running scan, header and
// navigation survive moving between Scanner, Scans and Network.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
