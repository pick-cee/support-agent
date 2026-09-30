import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const src = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": src,
      // The marker throws outside Next's react-server bundle; tests run plain Node.
      "server-only": `${src}/lib/testing/server-only-stub.ts`,
    },
  },
  test: {
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    // Database tests need a live Supabase; they run with npm run test:db.
    exclude: ["**/node_modules/**", "**/*.db.test.ts"],
    environment: "node",
  },
});
