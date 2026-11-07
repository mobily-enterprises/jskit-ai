import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

const fixtureRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: fixtureRoot,
  resolve: {
    alias: {
      // The crud-screen-set pattern's pages import the app's shared book resource from here.
      "@local/books/shared": path.resolve(
        fixtureRoot,
        "../../../resource-crud-core/patterns/crud-contract/example/bookResource.js"
      )
    }
  },
  plugins: [vue()],
  server: {
    host: "127.0.0.1",
    strictPort: true
  }
});
