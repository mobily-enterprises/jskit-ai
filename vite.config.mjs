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
      include: [
        "src/*.js",
        "src/components/**/*.js",
        "src/composables/**/*.js",
        "src/features/**/*.js",
        "src/services/**/*.js",
        "src/stores/**/*.js",
        "src/utils/**/*.js"
      ],
      exclude: [
        "src/main.admin.js",
        "src/main.app.js"
      ],
      reportsDirectory: "./coverage-client",
      thresholds: {
        lines: 85,
        functions: 79,
        branches: 80,
        statements: 85,
        perFile: false
      }
    }
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true
      },
      "/uploads": {
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
