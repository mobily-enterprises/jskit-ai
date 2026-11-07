import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { createJskitClientBootstrapPlugin } from "@jskit-ai/kernel/client/vite";

// A JSKIT app's Vite setup, as the shell-foundation pattern has it: built for production by the browser test.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [createJskitClientBootstrapPlugin(), vue()],
  server: { host: "127.0.0.1" },
  preview: { host: "127.0.0.1" }
});
