import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import { resolveSideEffectsMode, withSideEffectsMeta } from "@jskit-ai/kernel/shared/support/sideEffects";

// The page names the server's SIDE_EFFECTS as a JSKIT server or development server names it.
const sideEffectsPage = {
  name: "fixture-side-effects-page",
  transformIndexHtml: (html) => withSideEffectsMeta(html, resolveSideEffectsMode(process.env))
};

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [sideEffectsPage],
  server: {
    host: "127.0.0.1"
  }
});
