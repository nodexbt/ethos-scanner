import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Supabase / Alchemy are never hit: tests mock the modules that reach
    // them. Set dummy env so getSupabase() doesn't throw on import paths.
    env: {
      SUPABASE_URL: "http://localhost",
      SUPABASE_SERVICE_KEY: "test",
      ALCHEMY_API_KEY: "test",
    },
  },
});
