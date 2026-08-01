import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    testTimeout: 20000,
    hookTimeout: 20000,
    include: ["lib/__tests__/**/*.test.ts"],
    setupFiles: ["lib/__tests__/setup.ts"],
  },
});
