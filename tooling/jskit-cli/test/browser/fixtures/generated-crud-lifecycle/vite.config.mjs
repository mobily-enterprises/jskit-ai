import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

const fixtureRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: fixtureRoot,
  plugins: [vue()],
  resolve: {
    preserveSymlinks: true
  },
  server: {
    host: "127.0.0.1",
    strictPort: true
  }
});
