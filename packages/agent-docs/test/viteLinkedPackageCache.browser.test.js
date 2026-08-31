import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
import {
  createChromiumLaunchOptions,
  reservePort,
  startViteFixture,
  stopProcess
} from "../../../tooling/testUtils/browserFixture.mjs";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.."
);
const CLIENT_BOOTSTRAP_PLUGIN_URL = pathToFileURL(
  path.join(REPOSITORY_ROOT, "packages", "kernel", "client", "vite", "index.js")
).href;
const RUN_BROWSER_TEST = process.env.JSKIT_VITE_LINKED_PACKAGE_CACHE_INTEGRATION === "1";
const NEW_EXPORT = "PLANT_ASSET_EQUIPMENT_CATALOGUES";

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function createLinkedPackageFixture() {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-vite-linked-cache-"));
  const sourcePackageRoot = path.join(fixtureRoot, "packages", "plant-assets");
  const sourceModulePath = path.join(sourcePackageRoot, "src", "shared", "index.js");
  const localScopeRoot = path.join(fixtureRoot, "node_modules", "@local");

  await mkdir(path.dirname(sourceModulePath), { recursive: true });
  await mkdir(path.join(fixtureRoot, "src"), { recursive: true });
  await mkdir(localScopeRoot, { recursive: true });
  await writeJson(path.join(fixtureRoot, "package.json"), {
    name: "linked-package-cache-fixture",
    private: true,
    type: "module",
    dependencies: {
      "@local/plant-assets": "0.1.0"
    }
  });
  await writeJson(path.join(sourcePackageRoot, "package.json"), {
    name: "@local/plant-assets",
    version: "0.1.0",
    type: "module",
    exports: {
      "./shared": "./src/shared/index.js"
    },
    jskit: {
      kind: "runtime"
    }
  });
  await symlink(
    "../../packages/plant-assets",
    path.join(localScopeRoot, "plant-assets"),
    "dir"
  );
  await writeFile(
    path.join(fixtureRoot, "index.html"),
    '<!doctype html><html><body><main id="app"></main><script type="module" src="/src/main.js"></script></body></html>\n',
    "utf8"
  );
  // Keep the former template setting in this compatibility fixture. The bootstrap plugin must
  // correct existing applications even though current foundations no longer emit the setting.
  await writeFile(
    path.join(fixtureRoot, "vite.config.mjs"),
    `import { createJskitClientBootstrapPlugin } from ${JSON.stringify(CLIENT_BOOTSTRAP_PLUGIN_URL)};\n\n` +
      "export default {\n" +
      "  plugins: [createJskitClientBootstrapPlugin()],\n" +
      "  resolve: { preserveSymlinks: true },\n" +
      '  server: { host: "127.0.0.1", strictPort: true }\n' +
      "};\n",
    "utf8"
  );
  await writeFile(
    sourceModulePath,
    'export const EXISTING_CATALOGUE = "initial";\n',
    "utf8"
  );
  await writeFile(
    path.join(fixtureRoot, "src", "main.js"),
    'import * as plantAssets from "@local/plant-assets/shared";\n' +
      "globalThis.__PLANT_ASSET_MODULE__ = {\n" +
      "  exports: Object.keys(plantAssets).sort(),\n" +
      "  value: plantAssets.EXISTING_CATALOGUE\n" +
      "};\n",
    "utf8"
  );

  return {
    fixtureRoot,
    mainModulePath: path.join(fixtureRoot, "src", "main.js"),
    sourceModulePath
  };
}

async function readLinkedModuleResponse(page) {
  const resourceNames = await page.evaluate(() =>
    performance.getEntriesByType("resource").map((entry) => entry.name)
  );
  const moduleUrl = resourceNames.find((resourceUrl) =>
    resourceUrl.includes("/plant-assets/src/shared/index.js")
  );

  assert.ok(
    moduleUrl,
    `Linked plant-assets module was not requested.\n${resourceNames.join("\n")}`
  );
  const parsedUrl = new URL(moduleUrl);
  assert.equal(parsedUrl.pathname, "/packages/plant-assets/src/shared/index.js");
  assert.equal(parsedUrl.searchParams.has("v"), false, moduleUrl);
  assert.equal(
    resourceNames.some((resourceUrl) => resourceUrl.includes("/node_modules/@local/")),
    false
  );

  const response = await fetch(moduleUrl);
  assert.equal(response.headers.get("cache-control"), "no-cache", moduleUrl);
  return response.text();
}

async function assertInitialModule(page, baseURL) {
  await page.goto(baseURL, { waitUntil: "networkidle" });
  await page.waitForFunction(() => globalThis.__PLANT_ASSET_MODULE__?.value === "initial");
  assert.deepEqual(await page.evaluate(() => globalThis.__PLANT_ASSET_MODULE__), {
    exports: ["EXISTING_CATALOGUE"],
    value: "initial"
  });
  assert.doesNotMatch(await readLinkedModuleResponse(page), new RegExp(NEW_EXPORT, "u"));
}

async function assertCurrentModule(page, baseURL) {
  const pageErrors = [];
  page.on("pageerror", (error) => {
    pageErrors.push(String(error?.message || error));
  });

  await page.goto(baseURL, { waitUntil: "networkidle" });
  await page.waitForFunction(
    (exportName) => globalThis.__PLANT_ASSET_MODULE__?.exports?.includes(exportName),
    NEW_EXPORT
  );
  assert.deepEqual(await page.evaluate(() => globalThis.__PLANT_ASSET_MODULE__), {
    exports: ["EXISTING_CATALOGUE", NEW_EXPORT],
    value: "current"
  });
  assert.deepEqual(pageErrors, []);
  assert.match(await readLinkedModuleResponse(page), new RegExp(NEW_EXPORT, "u"));
}

test("two browser profiles receive changed exports from a linked application package", {
  skip: RUN_BROWSER_TEST
    ? false
    : "set JSKIT_VITE_LINKED_PACKAGE_CACHE_INTEGRATION=1 to run the linked-package browser-cache regression",
  timeout: 180_000
}, async () => {
  const fixture = await createLinkedPackageFixture();
  const port = await reservePort();
  let viteRuntime = null;
  let browser = null;

  try {
    viteRuntime = await startViteFixture({
      fixtureRoot: fixture.fixtureRoot,
      port
    });
    browser = await chromium.launch(createChromiumLaunchOptions());
    const profiles = await Promise.all([
      browser.newContext(),
      browser.newContext()
    ]);
    const pages = await Promise.all(profiles.map((profile) => profile.newPage()));

    await Promise.all(pages.map((page) => assertInitialModule(page, viteRuntime.baseURL)));
    await Promise.all(pages.map((page) => page.goto("about:blank")));
    await stopProcess(viteRuntime);
    viteRuntime = null;

    await writeFile(
      fixture.sourceModulePath,
      'export const EXISTING_CATALOGUE = "current";\n' +
        `export const ${NEW_EXPORT} = "current";\n`,
      "utf8"
    );
    await writeFile(
      fixture.mainModulePath,
      'import * as plantAssets from "@local/plant-assets/shared";\n' +
        `import { ${NEW_EXPORT} } from "@local/plant-assets/shared";\n` +
        "globalThis.__PLANT_ASSET_MODULE__ = {\n" +
        "  exports: Object.keys(plantAssets).sort(),\n" +
        `  value: ${NEW_EXPORT}\n` +
        "};\n",
      "utf8"
    );

    viteRuntime = await startViteFixture({
      fixtureRoot: fixture.fixtureRoot,
      port
    });
    await Promise.all(pages.map((page) => assertCurrentModule(page, viteRuntime.baseURL)));
    await Promise.all(profiles.map((profile) => profile.close()));
  } finally {
    await browser?.close();
    await stopProcess(viteRuntime);
    await rm(fixture.fixtureRoot, { recursive: true, force: true });
  }
});
