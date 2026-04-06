"use client";

import { useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { useSession } from "next-auth/react";
import { useTheme } from "@/components/theme-provider";

// Dynamically import Dither so WebGL/three.js code never runs server-side
const Dither = dynamic(() => import("@/components/ui/dither"), { ssr: false });

// Subscribe to the "(pointer: coarse)" media query via useSyncExternalStore
// so we can safely read it without causing hydration mismatch or setState-in-effect.
function subscribeToCoarsePointer(callback: () => void): () => void {
  const mql = window.matchMedia("(pointer: coarse)");
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}
function getCoarsePointerSnapshot(): boolean {
  return window.matchMedia("(pointer: coarse)").matches;
}
function getCoarsePointerServerSnapshot(): boolean {
  return false;
}

export function Background() {
  const { data: session, status } = useSession();
  const { theme } = useTheme();
  const isTouchDevice = useSyncExternalStore(
    subscribeToCoarsePointer,
    getCoarsePointerSnapshot,
    getCoarsePointerServerSnapshot
  );

  if (status === "loading") {
    return null;
  }

  const loggedIn = !!session;
  // Mouse interaction only on login screen AND only on devices with a fine pointer (non-touch)
  const interactive = !loggedIn && !isTouchDevice;
  const waveColor: [number, number, number] = [0.5, 0.5, 0.5];

  return (
    <div
      aria-hidden
      className="fixed -z-10 pointer-events-none"
      style={{
        // Oversized to guarantee coverage of iOS safe areas (notch, home bar)
        // which aren't reliably included in `inset: 0` on all browsers.
        top: "-200px",
        left: "-200px",
        right: "-200px",
        bottom: "-200px",
        // Invert the shader output for light mode (shader is hardcoded to mix from black)
        filter: theme === "light" ? "invert(1) contrast(1.25)" : undefined,
      }}
    >
      <Dither
        waveColor={waveColor}
        // Login screen on desktop: animated + interactive.
        // Mobile/tablet or logged in: static, no mouse interaction.
        disableAnimation={loggedIn}
        enableMouseInteraction={interactive}
        mouseRadius={0.2}
        colorNum={7.3}
        waveAmplitude={0.18}
        waveFrequency={1.8}
        waveSpeed={0.01}
      />
    </div>
  );
}
