import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }
  return fallback;
}

const devPort = toPositiveInt(process.env.VITE_DEV_PORT, 5173);
const apiProxyTarget = String(process.env.VITE_API_PROXY_TARGET || "").trim() || "http://localhost:3000";
const clientEntry = (() => {
  const normalized = String(process.env.VITE_CLIENT_ENTRY || "").trim();
  if (!normalized) {
    return "/src/main.js";
  }
  if (normalized.startsWith("/")) {
    return normalized;
  }
  if (normalized.startsWith("src/")) {
    return `/${normalized}`;
  }
  return `/src/${normalized}`;
})();

export default defineConfig({
  plugins: [
    vue(),
    {
      name: "jskit-client-entry",
      transformIndexHtml(source) {
        return String(source || "").replace(/\/src\/main\.js/g, clientEntry);
      }
    }
  ],
  test: {
    include: ["tests/client/**/*.vitest.js"]
  },
  server: {
    port: devPort,
    proxy: {
      "/api": {
        target: apiProxyTarget,
        changeOrigin: true
      }
    }
  }
});
