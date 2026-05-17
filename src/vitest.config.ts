import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@/ui": path.resolve(__dirname, "./features/ui"),
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./__tests__/setup.ts"],
    css: false,
    include: ["**/*.{test,spec}.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/.next/**", "e2e/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "json", "html"],
      reportsDirectory: "./coverage",
      include: [
        "features/**/*.{ts,tsx}",
        "app/**/*.{ts,tsx}",
        "proxy.ts",
        "instrumentation.ts",
        "span-enriching-processor.ts",
      ],
      exclude: [
        "**/*.test.{ts,tsx}",
        "**/*.spec.{ts,tsx}",
        "**/*.d.ts",
        "features/ui/**",
        "**/index.ts",
        "__tests__/**",
        "e2e/**",
      ],
      thresholds: {
        statements: 100,
        functions: 100,
        branches: 95,
        lines: 100,
      },
    },
    server: {
      deps: {
        inline: ["next-auth"],
      },
    },
  },
});
