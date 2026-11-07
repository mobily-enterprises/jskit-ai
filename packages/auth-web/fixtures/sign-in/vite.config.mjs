import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  root: fileURLToPath(new URL("./", import.meta.url)),
  // The auth-surface pattern's pages and view wrappers import the app's own files through "@/", as in an app.
  resolve: { alias: { "@": fileURLToPath(new URL("../../patterns/auth-surface/example/src", import.meta.url)) } },
  plugins: [vue()],
  server: { host: "127.0.0.1", strictPort: true }
});
