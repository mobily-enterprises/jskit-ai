import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: "jsdom",
    include: ["tests/views/**/*.vitest.js"],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "lcov"],
      all: true,
      include: ["src/shells/**/*.js", "src/views/**/*.js"],
      reportsDirectory: "./coverage-vue",
      thresholds: {
        lines: 62,
        statements: 62,
        branches: 41,
        functions: 70
      }
    }
  }
});
