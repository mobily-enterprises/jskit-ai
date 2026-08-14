import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { withTempDir } from "../../testUtils/tempDir.mjs";
import { resolveOptionEnvFallbacks } from "../src/server/cliRuntime/sensitiveOptions.js";
import { resolvePackageOptions } from "../src/server/cliRuntime/packageOptions.js";
import { readFileBufferIfExists } from "../src/server/cliRuntime/ioAndMigrations.js";
import { orderRuntimePackagesForConfiguration } from "../src/server/commandHandlers/packageCommands/add.js";

function runtimePackage(packageId, { dependencies = {}, options = {} } = {}) {
  return {
    packageId,
    packageJson: { name: packageId, version: "1.0.0", dependencies },
    packageMetadata: {
      packageId,
      version: "1.0.0",
      kind: "runtime",
      options,
      mutations: { text: [] }
    }
  };
}

test("configuration order follows npm dependencies and keeps the requested package last", () => {
  const dependency = runtimePackage("@acme/database", {
    options: { database: { required: true } }
  });
  const unrelated = runtimePackage("@acme/existing", {
    options: { existing: { required: true } }
  });
  const requested = runtimePackage("@acme/feature", {
    dependencies: { "@acme/database": "1.0.0" },
    options: { feature: { required: true } }
  });
  const registry = new Map([
    [requested.packageId, requested],
    [unrelated.packageId, unrelated],
    [dependency.packageId, dependency]
  ]);

  assert.deepEqual(
    orderRuntimePackagesForConfiguration(
      registry,
      [requested.packageId],
      (entry) => entry.packageMetadata.kind
    ),
    ["@acme/database", "@acme/existing", "@acme/feature"]
  );
});

test("installed env-backed options are recovered without prompting", async () => {
  await withTempDir(async (appRoot) => {
    await mkdir(appRoot, { recursive: true });
    await writeFile(path.join(appRoot, ".env"), "DATABASE_NAME=configured\n", "utf8");
    const packageEntry = runtimePackage("@acme/database", {
      options: {
        "database-name": { required: true }
      }
    });
    packageEntry.packageMetadata.mutations.text.push({
      op: "upsert-env",
      file: ".env",
      key: "DATABASE_NAME",
      value: "${option:database-name}"
    });
    const optionInput = await resolveOptionEnvFallbacks({
      packageEntry,
      appRoot,
      readFileBufferIfExists
    });
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    stdin.isTTY = true;
    stdout.isTTY = true;
    let prompted = false;

    assert.deepEqual(
      await resolvePackageOptions(packageEntry, optionInput, { stdin, stdout }, {
        appRoot,
        onPrompt: () => { prompted = true; }
      }),
      { "database-name": "configured" }
    );
    assert.equal(prompted, false);
  });
});
