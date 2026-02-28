import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ensureUniqueDescriptor } from "../src/shared/schemas/descriptorRegistry.mjs";
import { normalizeBundleDescriptor } from "../src/shared/schemas/bundleDescriptor.mjs";
import { normalizePackageDescriptor } from "../src/shared/schemas/packageDescriptor.mjs";

const CLI_PATH = fileURLToPath(new URL("../bin/jskit.js", import.meta.url));
const SNAPSHOT_PATH = fileURLToPath(new URL("./fixtures/descriptor-error-snapshots.json", import.meta.url));
const ERROR_SNAPSHOTS = JSON.parse(await readFile(SNAPSHOT_PATH, "utf8"));

function runCli({ cwd, args = [] }) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd,
    encoding: "utf8"
  });
}

function captureErrorMessage(action) {
  try {
    action();
  } catch (error) {
    return String(error?.message || error);
  }
  assert.fail("Expected action to throw.");
}

async function withTempWorkspace(run) {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-lint-"));
  try {
    await writeFile(
      path.join(workspaceRoot, "package.json"),
      `${JSON.stringify({ name: "lint-workspace", private: true, version: "0.0.1" }, null, 2)}\n`,
      "utf8"
    );
    await run(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

async function writePackageDescriptor(workspaceRoot, relativeDir, descriptorSource) {
  const descriptorPath = path.join(workspaceRoot, "packages", relativeDir, "package.descriptor.mjs");
  await mkdir(path.dirname(descriptorPath), { recursive: true });
  await writeFile(descriptorPath, descriptorSource, "utf8");
}

test("normalizePackageDescriptor accepts valid descriptor shape", () => {
  const normalized = normalizePackageDescriptor(
    {
      packageVersion: 1,
      packageId: "@test/valid-package",
      version: "1.2.3",
      dependsOn: ["@test/shared"],
      capabilities: {
        provides: ["feature-a"],
        requires: ["feature-b"]
      },
      contracts: {
        contributes: ["contracts/capabilities.mjs", "./contracts/capabilities.mjs"]
      },
      mutations: {
        dependencies: {
          runtime: { knex: "^3.0.0" },
          dev: { eslint: "^9.0.0" }
        },
        packageJson: {
          scripts: {
            build: "npm run build"
          }
        },
        procfile: {
          worker: "npm run worker"
        },
        files: [
          {
            from: "templates/source.txt",
            to: "config/source.txt"
          }
        ]
      }
    },
    "/fixtures/valid-package/package.descriptor.mjs"
  );

  assert.equal(normalized.packageVersion, 1);
  assert.equal(normalized.packageId, "@test/valid-package");
  assert.deepEqual(normalized.dependsOn, ["@test/shared"]);
  assert.deepEqual(normalized.capabilities.provides, ["feature-a"]);
  assert.deepEqual(normalized.capabilities.requires, ["feature-b"]);
  assert.deepEqual(normalized.contracts.contributes, ["contracts/capabilities.mjs"]);
  assert.equal(normalized.mutations.dependencies.runtime.knex, "^3.0.0");
  assert.equal(normalized.mutations.files[0].from, "templates/source.txt");
  assert.equal(normalized.mutations.files[0].to, "config/source.txt");
});

test("normalizeBundleDescriptor accepts valid descriptor shape", () => {
  const normalized = normalizeBundleDescriptor(
    {
      bundleVersion: 1,
      bundleId: "db-mysql",
      version: "0.2.0",
      packages: ["@jskit-ai/db-mysql"]
    },
    "/fixtures/valid-bundle/bundle.descriptor.mjs"
  );

  assert.equal(normalized.bundleVersion, 1);
  assert.equal(normalized.bundleId, "db-mysql");
  assert.deepEqual(normalized.packages, ["@jskit-ai/db-mysql"]);
});

test("bad package ID returns stable snapshot message", () => {
  const message = captureErrorMessage(() => {
    normalizePackageDescriptor(
      {
        packageVersion: 1,
        packageId: "Not A Valid ID",
        version: "0.1.0",
        dependsOn: [],
        capabilities: { provides: [], requires: [] },
        mutations: {
          dependencies: { runtime: {}, dev: {} },
          packageJson: { scripts: {} },
          procfile: {},
          files: []
        }
      },
      "/fixtures/bad-package-id/package.descriptor.mjs"
    );
  });

  assert.equal(message, ERROR_SNAPSHOTS.badPackageId);
});

test("bundle conditional package entries are rejected", () => {
  const message = captureErrorMessage(() => {
    normalizeBundleDescriptor(
      {
        bundleVersion: 1,
        bundleId: "db",
        version: "0.2.0",
        packages: [
          {
            packageId: "@jskit-ai/db-mysql",
            when: {
              option: "provider",
              equals: "mysql"
            }
          }
        ]
      },
      "/fixtures/no-conditional-support/bundle.descriptor.mjs"
    );
  });

  assert.equal(message, ERROR_SNAPSHOTS.conditionalPackagesNotSupported);
});

test("invalid relative file path returns stable snapshot message", () => {
  const message = captureErrorMessage(() => {
    normalizePackageDescriptor(
      {
        packageVersion: 1,
        packageId: "@test/invalid-path",
        version: "0.1.0",
        dependsOn: [],
        capabilities: { provides: [], requires: [] },
        mutations: {
          dependencies: { runtime: {}, dev: {} },
          packageJson: { scripts: {} },
          procfile: {},
          files: [
            {
              from: "../escape-template.cjs",
              to: "knexfile.cjs"
            }
          ]
        }
      },
      "/fixtures/invalid-path/package.descriptor.mjs"
    );
  });

  assert.equal(message, ERROR_SNAPSHOTS.invalidRelativePath);
});

test("duplicate descriptor IDs return stable snapshot message", () => {
  const message = captureErrorMessage(() => {
    ensureUniqueDescriptor(
      {
        descriptorPath: "/fixtures/duplicate-a/package.descriptor.mjs"
      },
      "@test/duplicate",
      "/fixtures/duplicate-b/package.descriptor.mjs",
      "package"
    );
  });

  assert.equal(message, ERROR_SNAPSHOTS.duplicatePackageId);
});

test("descriptor version mismatch returns stable snapshot message", () => {
  const message = captureErrorMessage(() => {
    normalizeBundleDescriptor(
      {
        bundleVersion: 99,
        bundleId: "db-mysql",
        version: "0.2.0",
        packages: ["@jskit-ai/db-mysql"]
      },
      "/fixtures/version-mismatch/bundle.descriptor.mjs"
    );
  });

  assert.equal(message, ERROR_SNAPSHOTS.descriptorVersionMismatch);
});

test("jskit lint-descriptors succeeds on valid descriptor inventory", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const result = runCli({
      cwd: workspaceRoot,
      args: ["lint-descriptors"]
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Descriptor lint passed \(\d+ bundle descriptors, \d+ package descriptors\)\./);
  });
});

test("jskit lint-descriptors reports duplicate package IDs", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const duplicateDescriptorSource = `export default Object.freeze({
  packageVersion: 1,
  packageId: "@test/duplicate",
  version: "0.0.1",
  dependsOn: [],
  capabilities: {
    provides: [],
    requires: []
  },
  mutations: {
    dependencies: {
      runtime: {},
      dev: {}
    },
    packageJson: {
      scripts: {}
    },
    procfile: {},
    files: []
  }
});
`;

    await writePackageDescriptor(workspaceRoot, "package-a", duplicateDescriptorSource);
    await writePackageDescriptor(workspaceRoot, "package-b", duplicateDescriptorSource);

    const result = runCli({
      cwd: workspaceRoot,
      args: ["lint-descriptors"]
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Duplicate package discovered: @test\/duplicate/);
    assert.match(result.stderr, /package-a\/package\.descriptor\.mjs/);
    assert.match(result.stderr, /package-b\/package\.descriptor\.mjs/);
  });
});
