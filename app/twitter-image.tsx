// Reuse the same generated image for Twitter Card previews. Re-exporting the
// default + metadata exports keeps a single source of truth for the static
// preview card. Per-segment overrides (e.g. /s/[shareId]) still take precedence.
export { default, alt, size, contentType } from "./opengraph-image";
