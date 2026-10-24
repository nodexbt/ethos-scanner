import { LandingPage } from "@/components/landing/landing-page";

// ethos.tools root. app.ethos.tools/ redirects to /scanner (next.config.ts),
// so this only renders on the landing host and in local development.
export default function Home() {
  return <LandingPage />;
}
