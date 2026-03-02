import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadServerAppDropins } from "@jskit-ai/module-framework-core/server";

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));

async function loadServerAppExtensions({ appDir = APP_DIR } = {}) {
  return loadServerAppDropins({ appDir });
}

const __testables = {
  APP_DIR
};

export { loadServerAppExtensions, __testables };
