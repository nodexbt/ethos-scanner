"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useSession } from "next-auth/react";
import { useTheme } from "@/components/theme-provider";

// Dynamically import Dither so WebGL/three.js code never runs server-side
const Dither = dynamic(() => import("@/components/ui/dither"), { ssr: false });

export function Background() {
  const { data: session, status } = useSession();
  const { theme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Avoid hydration mismatch on theme
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || status === "loading") {
    return null;
  }

  const loggedIn = !!session;
  const waveColor: [number, number, number] = [0.5, 0.5, 0.5];

  return (
    <div
      aria-hidden
      className="fixed inset-0 -z-10 pointer-events-none"
      style={{
        // Re-enable pointer events only when we want mouse interaction
        pointerEvents: loggedIn ? "none" : "auto",
        // Invert the shader output for light mode (shader is hardcoded to mix from black)
        filter: theme === "light" ? "invert(1) contrast(1.25)" : undefined,
      }}
    >
      <Dither
        waveColor={waveColor}
        // Login screen: animated + interactive; after login: static
        disableAnimation={loggedIn}
        enableMouseInteraction={!loggedIn}
        mouseRadius={0.3}
        colorNum={7.3}
        waveAmplitude={0.18}
        waveFrequency={1.8}
        waveSpeed={0.01}
      />
    </div>
  );
}
