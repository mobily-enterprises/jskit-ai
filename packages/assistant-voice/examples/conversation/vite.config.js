import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { createJskitClientBootstrapPlugin } from "@jskit-ai/kernel/client/vite";
// The example API, on 3042 unless VOICE_EXAMPLE_API_PORT names another port (server.js listens on the same one).
const apiTarget = `http://127.0.0.1:${process.env.VOICE_EXAMPLE_API_PORT || 3042}`;
export default defineConfig({ plugins: [vue(), createJskitClientBootstrapPlugin({ proxyTarget: apiTarget })],
  server: { proxy: {
    "/api": { target: apiTarget, ws: true }
  } }
});
