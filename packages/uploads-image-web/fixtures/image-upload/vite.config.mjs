import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  root: fileURLToPath(new URL("./", import.meta.url)),
  plugins: [vue()],
  // The same pre-bundling the package's client metadata asks of an application.
  optimizeDeps: {
    include: ["@uppy/core", "@uppy/dashboard", "@uppy/image-editor", "@uppy/compressor", "@uppy/xhr-upload"]
  },
  server: { host: "127.0.0.1", strictPort: true }
});
