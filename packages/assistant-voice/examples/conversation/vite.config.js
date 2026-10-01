import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
export default defineConfig({ plugins: [vue()], resolve: { dedupe: ["vue", "vuetify"] },
  server: { proxy: { "/api": { target: "http://127.0.0.1:3042", ws: true } } }
});
