import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vue from "@vitejs/plugin-vue";
import { build } from "vite";
import { createJskitClientBootstrapPlugin } from "../../../packages/kernel/client/vite/clientBootstrapPlugin.js";
import { discoverFrameworkPackages } from "../scripts/framework-packages.mjs";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
// Every page of every JSKIT app loads its client bootstrap, the installed packages' client providers and what they
// import, before it shows anything. These are the libraries that needs. A screen's own library (an image editor, an
// uploader, a chart) loads with the routes that show the screen; one added here loads on every page of every app.
const BOOT_LIBRARIES = Object.freeze([
  "@capacitor/browser",
  "@tanstack/vue-query",
  "json-rest-schema",
  "pinia",
  "socket.io-client",
  "vue",
  "vue-router",
  "vuetify"
]);

function packageName(specifier) {
  const parts = String(specifier).split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

function isLibraryImport(id) {
  return /^[^./\0]/u.test(id) && !path.isAbsolute(id) && !id.startsWith("@jskit-ai/") && !id.startsWith("virtual:");
}

test("an app that installs every JSKIT client package loads only the bootstrap's own libraries on every page", async (t) => {
  const appRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-client-boot-graph-"));
  t.after(() => rm(appRoot, { recursive: true, force: true }));
  const clientPackages = (await discoverFrameworkPackages(path.join(REPO_ROOT, "packages")))
    .filter(({ packageJson }) => packageJson.exports?.["./client"]);
  await writeFile(path.join(appRoot, "package.json"), JSON.stringify({
    name: "client-boot-graph-app",
    private: true,
    type: "module",
    dependencies: Object.fromEntries(clientPackages.map(({ packageJson }) => [packageJson.name, packageJson.version]))
  }));
  await writeFile(path.join(appRoot, "index.html"), '<script type="module" src="/main.js"></script>');
  // The application modules shell-web's provider loads from every app's src/.
  await mkdir(path.join(appRoot, "src"));
  for (const name of ["placement.js", "placementTopology.js", "error.js"]) {
    await writeFile(path.join(appRoot, "src", name), "export default {};\n");
  }
  await writeFile(
    path.join(appRoot, "main.js"),
    'import { bootInstalledClientModules } from "virtual:jskit-client-bootstrap";\nglobalThis.bootJskit = bootInstalledClientModules;\n'
  );
  await symlink(path.join(REPO_ROOT, "node_modules"), path.join(appRoot, "node_modules"), "dir");

  const previousCwd = process.cwd();
  process.chdir(appRoot);
  let result;
  try {
    result = await build({
      root: appRoot,
      configFile: false,
      logLevel: "silent",
      build: {
        write: false,
        minify: false,
        modulePreload: { polyfill: false },
        rolldownOptions: { external: (id) => isLibraryImport(id) }
      },
      // realtime proxies its socket to the app's server, which a build never reaches.
      plugins: [createJskitClientBootstrapPlugin({ proxyTarget: "http://127.0.0.1:3000" }), vue()]
    });
  } finally {
    process.chdir(previousCwd);
  }

  const chunks = new Map((Array.isArray(result) ? result : [result])
    .flatMap(({ output }) => output)
    .filter(({ type }) => type === "chunk")
    .map((chunk) => [chunk.fileName, chunk]));
  // The chunks a page loads before the app starts: the entry and everything it imports statically.
  const bootChunks = new Set();
  const queue = [...chunks.values()].filter(({ isEntry }) => isEntry);
  while (queue.length > 0) {
    const chunk = queue.pop();
    if (bootChunks.has(chunk)) {
      continue;
    }
    bootChunks.add(chunk);
    queue.push(...chunk.imports.filter((name) => chunks.has(name)).map((name) => chunks.get(name)));
  }
  const libraries = new Set();
  for (const chunk of bootChunks) {
    // The chunk's own import and export statements, each at the start of a line: text that only mentions one is not.
    for (const [, specifier] of chunk.code.matchAll(/^(?:(?:import|export)\b[^;]*?\bfrom|import)\s*["']([^"']+)["']/gmu)) {
      if (isLibraryImport(specifier)) {
        libraries.add(packageName(specifier));
      }
    }
  }
  const bootModules = [...bootChunks].flatMap((chunk) => chunk.moduleIds ?? Object.keys(chunk.modules ?? {}));

  assert.ok(bootChunks.size > 0, "The build has an entry chunk.");
  assert.ok(bootModules.some((id) => id.includes("UsersWebClientProvider")), "users-web's client provider boots.");
  assert.deepEqual(bootModules.filter((id) => /AccountSettingsClientElement|account-settings/u.test(id)), []);
  assert.deepEqual(
    [...libraries].filter((name) => !BOOT_LIBRARIES.includes(name)).sort(),
    [],
    `Every page loads ${[...libraries].sort().join(", ")}.`
  );
});
