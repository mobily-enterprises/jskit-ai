import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { optimizeDeps, resolveConfig } from "vite";
import { createJskitClientBootstrapPlugin } from "./clientBootstrapPlugin.js";

const scanCases = [
  { name: "workspace with explicit entries", localDependency: "1.0.0", config: { optimizeDeps: { entries: ["src/main.js"] } } },
  { name: "workspace with default HTML discovery", localDependency: "1.0.0", config: {} },
  { name: "workspace with build inputs", localDependency: "1.0.0", config: { build: { rolldownOptions: { input: { app: "src/main.js" } } } } },
  { name: "file dependency", localDependency: "file:packages/main", config: { optimizeDeps: { entries: ["src/main.js"] } } }
];

for (const scanCase of scanCases) {
  test(`cold scan discovers virtual client and local shared dependencies: ${scanCase.name}`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "jskit-client-dependency-scan-"));
    const previousCwd = process.cwd();
    const write = async (name, source) => {
      const target = path.join(root, name);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, typeof source === "string" ? source : JSON.stringify(source));
    };

    try {
      await write("package.json", {
        name: "client-scan-fixture", type: "module", private: true,
        workspaces: ["packages/*"],
        dependencies: {
          "@local/main": scanCase.localDependency,
          "@local/utility": "1.0.0",
          "@example/shell": "1.0.0"
        }
      });
      await write("index.html", '<script type="module" src="/src/main.js"></script>');
      await write("__tests__/ignored.html", '<script type="module">import "missing-test-only";</script>');
      await write("src/main.js", 'import "virtual:jskit-client-bootstrap";');
      await write("packages/main/package.json", {
        name: "@local/main", version: "1.0.0", type: "module",
        jskit: { kind: "runtime" },
        exports: { "./client": { browser: "./browser.js", default: "./server.js" } }
      });
      await write("packages/main/browser.js", 'import "client-helper"; import "@local/utility/shared"; import("./Page.vue");');
      await write("packages/main/server.js", 'import "server-only-missing";');
      await write("packages/main/Page.vue", '<script setup>import "page-helper";</script><template>Page</template>');
      await write("packages/utility/package.json", {
        name: "@local/utility", version: "1.0.0", type: "module",
        exports: { "./shared": "./shared.js" }
      });
      await write("packages/utility/shared.js", 'import "shared-helper";');
      await mkdir(path.join(root, "node_modules/@local"), { recursive: true });
      for (const name of ["main", "utility"]) {
        await symlink(path.join(root, "packages", name), path.join(root, "node_modules/@local", name));
      }
      await write("node_modules/@example/shell/package.json", {
        name: "@example/shell", version: "1.0.0", type: "module",
        exports: { "./client": "./client.js" },
        jskit: { metadata: { client: { optimizeDeps: { exclude: ["@example/shell/client"] } } } }
      });
      await write("node_modules/@example/shell/client.js", 'import "/src/shell-content.js";');
      await write("src/shell-content.js", 'import "shell-helper";');
      await write("node_modules/@jskit-ai/kernel/package.json", {
        name: "@jskit-ai/kernel", version: "1.0.0", type: "module",
        exports: { "./client/moduleBootstrap": "./bootstrap.js" }
      });
      await write("node_modules/@jskit-ai/kernel/bootstrap.js", "export const bootClientModules = () => {};");
      for (const name of ["client-helper", "shared-helper", "page-helper", "shell-helper"]) {
        await write(`node_modules/${name}/package.json`, {
          name, version: "1.0.0", type: "module", exports: "./index.js"
        });
        await write(`node_modules/${name}/index.js`, "export const value = 1;");
      }

      process.chdir(root);
      const config = await resolveConfig({
        configFile: false,
        logLevel: "silent",
        plugins: [createJskitClientBootstrapPlugin()],
        ...scanCase.config
      }, "serve");
      const metadata = await optimizeDeps(config, true);
      for (const name of ["client-helper", "shared-helper", "page-helper", "shell-helper"]) {
        assert.ok(metadata.optimized[name], `${name} must be ready before the browser loads a page`);
      }
      assert.equal(Object.keys(metadata.optimized).some((id) => id.startsWith("@local/")), false);
      assert.equal(metadata.optimized["@example/shell/client"], undefined);
    } finally {
      process.chdir(previousCwd);
      await rm(root, { recursive: true, force: true });
    }
  });
}
