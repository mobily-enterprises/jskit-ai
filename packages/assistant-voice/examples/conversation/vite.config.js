import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { createJskitClientBootstrapPlugin } from "@jskit-ai/kernel/client/vite";
const apiTarget = "http://127.0.0.1:3042";
export default defineConfig({ plugins: [vue(), createJskitClientBootstrapPlugin({ proxyTarget: apiTarget })],
  server: { proxy: {
    "/api": { target: apiTarget, ws: true }
  } }
});
