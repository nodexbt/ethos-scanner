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
      className="fixed -z-10 pointer-events-none"
      style={{
        // Cover the full visual viewport including mobile safe areas
        top: "calc(env(safe-area-inset-top, 0px) * -1)",
        right: "calc(env(safe-area-inset-right, 0px) * -1)",
        bottom: "calc(env(safe-area-inset-bottom, 0px) * -1)",
        left: "calc(env(safe-area-inset-left, 0px) * -1)",
        width: "100vw",
        height: "100dvh",
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
