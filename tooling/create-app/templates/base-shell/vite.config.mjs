import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import VueRouter from "vue-router/vite";
import { createJskitClientBootstrapPlugin } from "@jskit-ai/kernel/client/vite";
import { loadViteDevProxyEntries, toPositiveInt } from "./vite.shared.mjs";

const NESTED_CHILDREN_GROUP_SEGMENTS = Object.freeze(["/(nestedChildren)/", "/(nested-children)/"]);

function toPosixPath(value = "") {
  return String(value || "").replaceAll("\\", "/");
}

function nodeDeclaresNestedChildrenSource(node) {
  const sourcePaths = [];
  if (node.component) {
    sourcePaths.push(node.component);
  }
  for (const filePath of node.components.values()) {
    sourcePaths.push(filePath);
  }

  for (const sourcePath of sourcePaths) {
    const normalizedSourcePath = toPosixPath(sourcePath);
    if (NESTED_CHILDREN_GROUP_SEGMENTS.some((segment) => normalizedSourcePath.includes(segment))) {
      return true;
    }
  }

  return false;
}

function collectBranchComponentNodes(node) {
  const entries = [];
  const stack = [node];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current.component || current.components.size > 0) {
      entries.push(current);
    }
    stack.push(...current.children);
  }
  return entries.sort((left, right) => String(left.fullPath).localeCompare(String(right.fullPath)));
}

function isNestedChildrenBranch(node) {
  const componentNodes = collectBranchComponentNodes(node);
  if (componentNodes.length < 1) {
    return false;
  }

  return componentNodes.every((entry) => nodeDeclaresNestedChildrenSource(entry));
}

function reparentNestedChildrenToIndexOwners(rootRoute) {
  for (const owner of rootRoute.traverseDFS()) {
    const indexChild = owner.children.find((child) => child.path === "" && child.component) || null;
    if (!indexChild) {
      continue;
    }

    const siblingBranches = owner.children.filter((child) => child !== indexChild && isNestedChildrenBranch(child));
    if (siblingBranches.length === 0) {
      continue;
    }

    for (const branch of siblingBranches) {
      for (const sourceNode of collectBranchComponentNodes(branch)) {
        let relativePath = String(sourceNode.fullPath).slice(String(owner.fullPath).length);
        if (relativePath.startsWith("/")) {
          relativePath = relativePath.slice(1);
        }
        if (!relativePath) {
          continue;
        }

        const sourceComponentPath = sourceNode.component
          ? toPosixPath(sourceNode.component)
          : toPosixPath(sourceNode.components.values().next().value || "");
        if (!sourceComponentPath) {
          continue;
        }

        const cloned = indexChild.insert(relativePath, sourceComponentPath);
        for (const [viewName, filePath] of sourceNode.components.entries()) {
          cloned.components.set(viewName, toPosixPath(filePath));
        }
        if (typeof sourceNode.name === "string" && sourceNode.name) {
          cloned.name = sourceNode.name;
        }
        if (sourceNode.meta) {
          cloned.addToMeta(sourceNode.meta);
        }
        for (const alias of sourceNode.alias || []) {
          cloned.addAlias(alias);
        }
      }

      branch.delete();
    }
  }
}

const devPort = toPositiveInt(process.env.VITE_DEV_PORT, 5173);
const apiProxyTarget = String(process.env.VITE_API_PROXY_TARGET || "").trim() || "http://localhost:3000";
const viteModuleProxyEntries = loadViteDevProxyEntries({
  appRootUrl: import.meta.url,
  fallbackTarget: apiProxyTarget
});
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

export default defineConfig({
  resolve: {
    preserveSymlinks: true,
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  },
  plugins: [
    createJskitClientBootstrapPlugin(),
    VueRouter({
      routesFolder: "src/pages",
      dts: "src/typed-router.d.ts",
      beforeWriteFiles: reparentNestedChildrenToIndexOwners
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
      },
      ...viteModuleProxyEntries
    }
  }
});
