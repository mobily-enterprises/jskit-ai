import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import { appEnvironment, withAppEnvironmentMeta } from "@jskit-ai/kernel/shared/support/appEnvironment";

// The page names the server's APP_ENV as a JSKIT server or development server names it.
const appEnvironmentPage = {
  name: "fixture-app-environment-page",
  transformIndexHtml: (html) => withAppEnvironmentMeta(html, appEnvironment(process.env))
};

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [appEnvironmentPage],
  server: {
    host: "127.0.0.1"
  }
});
