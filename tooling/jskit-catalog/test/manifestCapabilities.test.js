import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { loadCapabilityProviders } from "../../../packages/kernel/server/platform/providerRuntime/capabilityProviderLoader.js";
import { assertManifestMatchesProviders } from "../../../packages/kernel/server/platform/providerRuntime/packageCatalog.js";
import { discoverFrameworkPackages } from "../scripts/framework-packages.mjs";
import { checkManifestCapabilities, formatManifestCapabilitiesReport } from "../scripts/manifest-capabilities.mjs";
import { discoverProjectManifests } from "../scripts/project-manifests.mjs";

const PACKAGES_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../packages");
const CLI_PATH = fileURLToPath(new URL("../scripts/jskit.mjs", import.meta.url));
const execFileAsync = promisify(execFile);

// Install-time requirements: the packages need them in the app, while no server provider of theirs requires them.
const INSTALL_TIME_REQUIREMENTS = Object.freeze([
  {
    packageId: "@jskit-ai/assistant-runtime",
    capabilityId: "runtime.http-web"
  },
  {
    packageId: "@jskit-ai/users-core",
    capabilityId: "runtime.database"
  },
  {
    packageId: "@jskit-ai/workspaces-core",
    capabilityId: "runtime.database"
  }
]);

test("every JSKIT package manifest names the capabilities its server providers require and provide", async () => {
  const warnings = [];
  const logger = {
    debug() {},
    info() {},
    warn(fields) {
      warnings.push(fields);
    },
    error() {}
  };
  let checkedPackages = 0;
  for (const { packageRoot, packageJson } of await discoverFrameworkPackages(PACKAGES_ROOT)) {
    const packageEntry = {
      packageId: packageJson.name,
      packageRoot,
      packageMetadata: packageJson.jskit
    };
    const packageProviders = await loadCapabilityProviders({ packageEntry });
    if (packageProviders.length === 0) {
      continue;
    }
    assertManifestMatchesProviders(packageEntry, packageProviders, { logger });
    checkedPackages += 1;
  }

  assert.ok(checkedPackages > 10, `expected the JSKIT packages with server providers, checked ${checkedPackages}`);
  assert.deepEqual(warnings, INSTALL_TIME_REQUIREMENTS);
});

const feature = (id, requires, provides) =>
  `export const Feature = ${JSON.stringify({ id, requires, provides })};\nFeature.setup = () => ({});\n`;
const runtimePackage = (name, capabilities, entrypoint = "src/server/Feature.js") => JSON.stringify({
  name,
  version: "0.1.0",
  type: "module",
  jskit: { capabilities, runtime: { server: { providers: [{ entrypoint, export: "Feature" }] } } }
}, null, 2);

// An app whose packages use the kernel of this repository: one manifest that drifted from its feature, one that
// matches, one whose feature does not load and a client-only package with no server providers to compare.
async function withManifestApp(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "jskit-manifest-capabilities-"));
  try {
    const files = {
      "package.json": JSON.stringify({ name: "manifest-app", private: true, type: "module", workspaces: ["packages/*"] }, null, 2),
      "package-lock.json": JSON.stringify({ name: "manifest-app", lockfileVersion: 3, packages: { "": { name: "manifest-app" } } }),
      "packages/books/package.json": runtimePackage("@local/books", {
        provides: ["app.authors", "client.books"],
        requires: ["app.catalog", "runtime.storage"]
      }),
      "packages/books/src/server/Feature.js": feature(
        "app.books",
        { catalog: "app.catalog", contracts: "crud.contracts", actions: "runtime.actions" },
        { books: "app.books" }
      ),
      "packages/notes/package.json": runtimePackage("@local/notes", { provides: ["app.notes"], requires: ["app.books"] }),
      "packages/notes/src/server/Feature.js": feature("app.notes", { books: "app.books" }, { notes: "app.notes" }),
      "packages/broken/package.json": runtimePackage("@local/broken", { provides: [] }, "src/server/Missing.js"),
      "packages/theme/package.json": JSON.stringify({ name: "@local/theme", version: "0.1.0", jskit: { capabilities: { provides: ["client.theme"] } } })
    };
    for (const [file, contents] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await writeFile(path.join(root, file), `${contents}\n`);
    }
    await mkdir(path.join(root, "node_modules", "@jskit-ai"), { recursive: true });
    await symlink(path.join(PACKAGES_ROOT, "kernel"), path.join(root, "node_modules", "@jskit-ai", "kernel"), "dir");
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("jskit check reports each capability an application package's manifest misses or names without a feature", async () => {
  await withManifestApp(async (root) => {
    const result = await checkManifestCapabilities({ projectRoot: root, manifests: await discoverProjectManifests(root) });

    assert.equal(result.ok, false);
    assert.equal(result.packages, 2);
    assert.deepEqual(result.findings.map(({ file, line, rule, message }) => `${file}:${line}  ${rule}  ${message}`), [
      "packages/books/package.json:6  manifest/capabilities  its features provide app.books, which jskit.capabilities.provides does not list; add it.",
      "packages/books/package.json:6  manifest/capabilities  its features require crud.contracts, which jskit.capabilities.requires does not list; add it.",
      "packages/books/package.json:8  manifest/capabilities  jskit.capabilities.provides lists app.authors, which none of its features provides; remove it.",
      "packages/broken/package.json:6  manifest/capabilities  declares server providers that do not load: " +
        "Package @local/broken provider entrypoint not found: src/server/Missing.js"
    ]);
    // runtime.storage may be an install-time requirement, so it is listed for review rather than refused.
    assert.deepEqual(result.installTime, [{ file: "packages/books/package.json", line: 13, capabilityId: "runtime.storage" }]);
    const report = formatManifestCapabilitiesReport(result);
    assert.match(report, /^Manifest requirements no feature has \(1\), each needed only at install time/mu);
    assert.match(report, /^ {2}packages\/books\/package\.json:13 {2}runtime\.storage$/mu);
    assert.match(report, /^JSKIT package manifests: 4 error\(s\)\./mu);
  });
});

test("plain jskit check fails on a drifted package manifest and passes once it names what its features do", async () => {
  await withManifestApp(async (root) => {
    const failure = await execFileAsync(process.execPath, [CLI_PATH, "check", "--root", root]).then(() => null, (error) => error);
    assert.equal(failure?.code, 1);
    assert.match(failure.stderr, /^packages\/books\/package\.json:8 {2}manifest\/capabilities {2}jskit\.capabilities\.provides lists app\.authors/mu);
    assert.match(failure.stderr, /typed-features#package-manifest/u);

    await writeFile(path.join(root, "packages/books/package.json"), `${runtimePackage("@local/books", {
      provides: ["app.books", "client.books"],
      requires: ["app.catalog", "crud.contracts"]
    })}\n`);
    await rm(path.join(root, "packages/broken"), { recursive: true });
    const { stdout } = await execFileAsync(process.execPath, [CLI_PATH, "check", "--root", root]);
    assert.match(stdout, /^JSKIT package manifests name what their features provide and require in 2 package\(s\)\.$/mu);
  });
});
