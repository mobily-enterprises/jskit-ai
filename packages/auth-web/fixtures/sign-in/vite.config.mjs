import process from "node:process";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// A test with a real auth server behind the page names it here, and /api goes to it; the other tests answer /api in
// the page themselves.
const apiServer = process.env.JSKIT_AUTH_WEB_FIXTURE_API_SERVER;

export default defineConfig({
  root: fileURLToPath(new URL("./", import.meta.url)),
  // The auth-surface pattern's pages and view wrappers import the app's own files through "@/", as in an app.
  resolve: { alias: { "@": fileURLToPath(new URL("../../patterns/auth-surface/example/src", import.meta.url)) } },
  plugins: [vue()],
  server: { host: "127.0.0.1", strictPort: true, ...(apiServer ? { proxy: { "/api": apiServer } } : {}) }
});
