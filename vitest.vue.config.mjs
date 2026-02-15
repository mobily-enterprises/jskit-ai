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
      include: ["src/views/**/*.vue", "src/App.vue"],
      reportsDirectory: "./coverage-vue",
      thresholds: {
        lines: 45,
        statements: 45,
        branches: 20,
        functions: 20
      }
    }
  }
});
