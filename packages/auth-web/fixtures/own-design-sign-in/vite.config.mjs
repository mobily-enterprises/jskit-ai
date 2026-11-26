import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

const patternSource = (pattern, file) => fileURLToPath(new URL(`../../patterns/${pattern}/example/src/${file}`, import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL("./", import.meta.url)),
  // An app that took auth-surface's pages and brand and this pattern's views: its "@/" files are the own-design
  // example's, but for AppBrand.vue, which stays auth-surface's.
  resolve: {
    alias: [
      { find: /^@\/components\/AppBrand\.vue$/u, replacement: patternSource("auth-surface", "components/AppBrand.vue") },
      { find: /^@\//u, replacement: patternSource("own-design-sign-in", "") }
    ]
  },
  plugins: [vue()],
  server: { host: "127.0.0.1", strictPort: true }
});
