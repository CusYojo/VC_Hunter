import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/domain/**/*.ts", "src/security/**/*.ts", "src/services/**/*.ts", "src/repositories/**/*.ts", "src/intelligence/**/*.ts", "src/connectors/local-public-search.ts", "src/prototype/navigation.ts", "src/prototype/store-core.ts"],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 80 },
    },
  },
});
