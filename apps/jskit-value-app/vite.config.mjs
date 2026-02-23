import { defineConfig, loadEnv } from "vite";
import vue from "@vitejs/plugin-vue";
import vuetify from "vite-plugin-vuetify";

function resolvePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }

  return fallback;
}

export default defineConfig(({ mode }) => {
  const viteEnv = loadEnv(mode, process.cwd(), "VITE_");
  const devPortSource = process.env.VITE_DEV_PORT ?? viteEnv.VITE_DEV_PORT;
  const apiProxyTargetSource = process.env.VITE_API_PROXY_TARGET ?? viteEnv.VITE_API_PROXY_TARGET;

  const devPort = resolvePositiveInt(devPortSource, 5173);
  const apiProxyTarget = String(apiProxyTargetSource || "").trim() || "http://localhost:3000";

  return {
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
        exclude: ["src/main.admin.js", "src/main.app.js"],
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
      port: devPort,
      proxy: {
        "/api": {
          target: apiProxyTarget,
          changeOrigin: true,
          ws: true
        },
        "/uploads": {
          target: apiProxyTarget,
          changeOrigin: true
        }
      }
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
      chunkSizeWarningLimit: 800
    }
  };
});
