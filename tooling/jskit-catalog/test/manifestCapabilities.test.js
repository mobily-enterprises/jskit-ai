import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadCapabilityProviders } from "../../../packages/kernel/server/platform/providerRuntime/capabilityProviderLoader.js";
import { assertManifestMatchesProviders } from "../../../packages/kernel/server/platform/providerRuntime/packageCatalog.js";
import { discoverFrameworkPackages } from "../scripts/framework-packages.mjs";

const PACKAGES_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../packages");

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
