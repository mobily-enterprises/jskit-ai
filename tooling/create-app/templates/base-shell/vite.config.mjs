import { readFile } from "node:fs/promises";
import path from "node:path";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import VueRouter from "unplugin-vue-router/vite";
import { toPositiveInt } from "./vite.shared.mjs";

const devPort = toPositiveInt(process.env.VITE_DEV_PORT, 5173);
const apiProxyTarget = String(process.env.VITE_API_PROXY_TARGET || "").trim() || "http://localhost:3000";
const clientEntry = (() => {
  const normalized = String(process.env.VITE_CLIENT_ENTRY || "").trim();
  if (!normalized) {
    return "/src/main.js";
  }
  if (normalized.startsWith("/")) {
    return normalized;
  }
  if (normalized.startsWith("src/")) {
    return `/${normalized}`;
  }
  return `/src/${normalized}`;
})();

const CLIENT_MODULES_VIRTUAL_ID = "virtual:jskit-client-modules";
const CLIENT_MODULES_RESOLVED_ID = `\0${CLIENT_MODULES_VIRTUAL_ID}`;

function hasClientExport(packageJson) {
  const exportsField = packageJson?.exports;
  if (!exportsField || typeof exportsField !== "object" || Array.isArray(exportsField)) {
    return false;
  }
  return Boolean(exportsField["./client"]);
}

function jskitClientModulesPlugin({ lockPath = ".jskit/lock.json" } = {}) {
  return {
    name: "jskit-client-modules",
    resolveId(source) {
      if (source === CLIENT_MODULES_VIRTUAL_ID) {
        return CLIENT_MODULES_RESOLVED_ID;
      }
      return null;
    },
    async load(id) {
      if (id !== CLIENT_MODULES_RESOLVED_ID) {
        return null;
      }

      const absoluteLockPath = path.resolve(process.cwd(), lockPath);
      let lockPayload = {};
      try {
        const rawLock = await readFile(absoluteLockPath, "utf8");
        lockPayload = JSON.parse(rawLock);
      } catch {
        lockPayload = {};
      }

      const installedPackages =
        lockPayload && typeof lockPayload === "object" && lockPayload.installedPackages
          ? lockPayload.installedPackages
          : {};
      const packageIds = Object.keys(installedPackages)
        .map((value) => String(value || "").trim())
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right));

      const resolvedPackageIds = [];
      for (const packageId of packageIds) {
        const packageJsonPath = path.resolve(process.cwd(), "node_modules", ...packageId.split("/"), "package.json");
        try {
          const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
          if (hasClientExport(packageJson)) {
            resolvedPackageIds.push(packageId);
          }
        } catch {
          // Skip missing/unreadable package manifests.
        }
      }

      if (resolvedPackageIds.length < 1) {
        return "export const clientModules = Object.freeze([]);";
      }

      const importLines = resolvedPackageIds.map(
        (packageId, index) => `import * as clientModule${index} from ${JSON.stringify(`${packageId}/client`)};`
      );
      const entryLines = resolvedPackageIds.map(
        (packageId, index) =>
          `  { packageId: ${JSON.stringify(packageId)}, module: clientModule${index} }`
      );

      return `${importLines.join("\n")}\n\nexport const clientModules = Object.freeze([\n${entryLines.join(
        ",\n"
      )}\n]);\n`;
    }
  };
}

export default defineConfig({
  resolve: {
    preserveSymlinks: true
  },
  plugins: [
    jskitClientModulesPlugin(),
    VueRouter({
      routesFolder: "src/pages",
      dts: "src/typed-router.d.ts"
    }),
    vue(),
    {
      name: "jskit-client-entry",
      transformIndexHtml(source) {
        return String(source || "")
          .replace(/\/src\/%VITE_CLIENT_ENTRY%/g, clientEntry)
          .replace(/\/src\/main\.js/g, clientEntry);
      }
    }
  ],
  test: {
    include: ["tests/client/**/*.vitest.js"]
  },
  server: {
    port: devPort,
    proxy: {
      "/api": {
        target: apiProxyTarget,
        changeOrigin: true
      }
    }
  }
});
