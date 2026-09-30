import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const src = fileURLToPath(new URL("./src", import.meta.url));

// Tests that talk to the real database. Each one works inside a transaction it
// rolls back, so running them leaves no trace. Standalone rather than merged
// with vitest.config.mts: mergeConfig concatenates arrays, so the base
// exclude of *.db.test.ts survived the merge and no database test ran.
export default defineConfig({
  resolve: {
    alias: {
      "@": src,
      "server-only": `${src}/lib/testing/server-only-stub.ts`,
    },
  },
  test: {
    include: ["src/**/*.db.test.ts"],
    environment: "node",
    testTimeout: 30_000,
  },
});
