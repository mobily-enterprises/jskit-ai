import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import vuetify from "vite-plugin-vuetify";

export default defineConfig({
  plugins: [vue(), vuetify({ autoImport: true })],
  test: {
    environment: "jsdom",
    css: true,
    include: ["tests/client/**/*.vitest.js"],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "lcov"],
      all: true,
      include: ["src/**/*.js"],
      reportsDirectory: "./coverage-client",
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
        perFile: true
      }
    }
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 800
  }
});
