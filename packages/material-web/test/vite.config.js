import { readFile } from "node:fs/promises";
import process from "node:process";
import { fileURLToPath } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";
import { PATCH, TARGETS, patchSource } from "../scripts/patch-vuetify-loaders.mjs";

// JSKIT_VUETIFY_LOADERS=published serves Vuetify's three loader modules as Vuetify publishes them, and =patched as
// material-web's install patch leaves them, whatever this checkout's install did to node_modules. Vuetify stays out of
// dependency pre-bundling, so its modules come through this plugin.
const LOADERS = process.env.JSKIT_VUETIFY_LOADERS;
if (!["published", "patched"].includes(LOADERS)) throw new Error("Set JSKIT_VUETIFY_LOADERS to published or patched.");
const LOADER_MODULES = Object.entries(TARGETS).filter(([file]) => file.startsWith("lib/"));

function vuetifyLoaders() {
  return {
    name: "jskit-vuetify-loaders",
    enforce: "pre",
    async load(id) {
      const file = id.split("?")[0];
      const [target, loaders] = LOADER_MODULES.find(([module]) => file.endsWith(`/vuetify/${module}`)) ?? [];
      if (!target) return null;
      const published = (await readFile(file, "utf8")).replaceAll(PATCH, "");
      if (LOADERS === "published") return published;
      const patched = patchSource(published, loaders);
      if (!patched.source) throw new Error(`${target}: ${patched.changed}`);
      return patched.source;
    }
  };
}

export default defineConfig({
  root: fileURLToPath(new URL("./fixtures/idle-loaders", import.meta.url)),
  plugins: [vuetifyLoaders(), vue()],
  optimizeDeps: { exclude: ["vuetify"], include: ["vue", "@vuetify/v0"] },
  server: { host: "127.0.0.1" }
});
