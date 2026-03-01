import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { toPositiveInt } from "../../packages/tooling/create-app/templates/base-shell/vite.shared.mjs";

const devPort = toPositiveInt(process.env.VITE_DEV_PORT, 5173);
const apiProxyTarget = String(process.env.VITE_API_PROXY_TARGET || "").trim() || "http://localhost:3000";

export default defineConfig({
  plugins: [vue()],
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
