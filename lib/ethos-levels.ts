/**
 * Ethos credibility levels and the colours the Ethos app uses for them,
 * taken from app.ethos.network (light / dark theme). Neutral has no colour
 * of its own there: it uses the normal text colour, and so do we.
 */
import type { CSSProperties } from "react";

export interface EthosLevel {
  name: string;
  min: number;
  max: number;
  light: string | null;
  dark: string | null;
}

export const ETHOS_LEVELS: EthosLevel[] = [
  { name: "Untrusted", min: 0, max: 799, light: "#b72b38", dark: "#b72b38" },
  { name: "Questionable", min: 800, max: 1199, light: "#cc9a1a", dark: "#C29010" },
  { name: "Neutral", min: 1200, max: 1399, light: null, dark: null },
  { name: "Known", min: 1400, max: 1599, light: "#41517A", dark: "#7C8DA8" },
  { name: "Established", min: 1600, max: 1799, light: "#2F4290", dark: "#4E86B9" },
  { name: "Reputable", min: 1800, max: 1999, light: "#1F21B6", dark: "#2E7BC3" },
  { name: "Exemplary", min: 2000, max: 2199, light: "#37874E", dark: "#427B56" },
  { name: "Distinguished", min: 2200, max: 2399, light: "#127f31", dark: "#127f31" },
  { name: "Revered", min: 2400, max: 2599, light: "#836DA6", dark: "#836DA6" },
  { name: "Renowned", min: 2600, max: 2800, light: "#7A5EAF", dark: "#7A5EAF" },
];

export function ethosLevel(score: number): EthosLevel {
  return ETHOS_LEVELS.find((l) => score <= l.max) ?? ETHOS_LEVELS[ETHOS_LEVELS.length - 1];
}

/**
 * CSS variables carrying a level's light and dark colour. Pair with the
 * `level-text` / `level-ring` utilities in globals.css, which pick the
 * right one for the active theme. Empty for Neutral (inherit).
 */
export function levelVars(score: number): CSSProperties {
  const l = ethosLevel(score);
  if (!l.light || !l.dark) return {};
  return { "--level-light": l.light, "--level-dark": l.dark } as CSSProperties;
}
