import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(".");
const GENERATE_SCRIPT = path.join(REPO_ROOT, "scripts", "framework", "generate-package-descriptor.mjs");
const SYNC_SCRIPT = path.join(REPO_ROOT, "scripts", "framework", "sync-descriptor-deps.mjs");
const DRIFT_SCRIPT = path.join(REPO_ROOT, "scripts", "framework", "check-descriptor-drift.mjs");

function runNodeScript(scriptPath, args = []) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8"
  });
}

async function writeJsonFile(absolutePath, value) {
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function withTempRepo(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "framework-stage3-"));
  try {
    await mkdir(path.join(root, "packages"), { recursive: true });
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function createFixturePackage({
  root,
  domain = "runtime",
  packageName = "fixture-package",
  npmName = "@test/fixture-package",
  version = "0.0.1",
  dependencies = {},
  devDependencies = {},
  descriptorSource = null,
  templateFiles = {}
}) {
  const packageRoot = path.join(root, "packages", domain, packageName);
  await mkdir(packageRoot, { recursive: true });

  await writeJsonFile(path.join(packageRoot, "package.json"), {
    name: npmName,
    version,
    private: true,
    dependencies,
    devDependencies
  });

  if (descriptorSource) {
    await writeFile(path.join(packageRoot, "package.descriptor.mjs"), descriptorSource, "utf8");
  }

  for (const [templatePath, source] of Object.entries(templateFiles)) {
    const absoluteTemplatePath = path.join(packageRoot, templatePath);
    await mkdir(path.dirname(absoluteTemplatePath), { recursive: true });
    await writeFile(absoluteTemplatePath, source, "utf8");
  }

  return packageRoot;
}

function createDescriptorSource(descriptor) {
  return `export default Object.freeze(${JSON.stringify(descriptor, null, 2)});\n`;
}

async function collectActualPackageCount(repoRoot) {
  const packagesRoot = path.join(repoRoot, "packages");
  const domains = await readdir(packagesRoot, { withFileTypes: true });
  let count = 0;

  async function exists(filePath) {
    try {
      await access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  for (const domainEntry of domains) {
    if (!domainEntry.isDirectory()) {
      continue;
    }

    const domainPath = path.join(packagesRoot, domainEntry.name);
    if (await exists(path.join(domainPath, "package.json"))) {
      count += 1;
      continue;
    }

    const children = await readdir(domainPath, { withFileTypes: true });
    for (const child of children) {
      if (!child.isDirectory()) {
        continue;
      }
      if (await exists(path.join(domainPath, child.name, "package.json"))) {
        count += 1;
      }
    }
  }

  return count;
}

test("generator dry-run covers the entire package inventory", async () => {
  const expectedCount = await collectActualPackageCount(REPO_ROOT);
  const result = runNodeScript(GENERATE_SCRIPT, ["--root", REPO_ROOT, "--dry-run", "--json"]);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.targetedCount, expectedCount);
});

test("generator snapshot includes detected template mappings", async () => {
  await withTempRepo(async (root) => {
    const packageRoot = await createFixturePackage({
      root,
      domain: "runtime",
      packageName: "alpha",
      npmName: "@test/alpha",
      version: "1.2.3",
      templateFiles: {
        "templates/config/defaults.json": "{\"ok\":true}\n"
      }
    });

    const result = runNodeScript(GENERATE_SCRIPT, ["--root", root, "--json"]);
    assert.equal(result.status, 0, result.stderr);

    const descriptorPath = path.join(packageRoot, "package.descriptor.mjs");
    const descriptorSource = await readFile(descriptorPath, "utf8");
    const expectedSnapshot = `export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@test/alpha",
  "version": "1.2.3",
  "dependsOn": [],
  "capabilities": {
    "provides": [],
    "requires": []
  },
  "mutations": {
    "dependencies": {
      "runtime": {},
      "dev": {}
    },
    "packageJson": {
      "scripts": {}
    },
    "procfile": {},
    "files": [
      {
        "from": "templates/config/defaults.json",
        "to": "config/defaults.json"
      }
    ]
  }
});
`;

    assert.equal(descriptorSource, expectedSnapshot);
  });
});

test("sync script aligns descriptor dependency maps to package.json", async () => {
  await withTempRepo(async (root) => {
    const descriptor = {
      packageVersion: 1,
      packageId: "@test/sync",
      version: "0.0.1",
      dependsOn: [],
      capabilities: { provides: [], requires: [] },
      mutations: {
        dependencies: {
          runtime: {},
          dev: {}
        },
        packageJson: { scripts: {} },
        procfile: {},
        files: []
      }
    };

    const packageRoot = await createFixturePackage({
      root,
      domain: "runtime",
      packageName: "sync",
      npmName: "@test/sync",
      dependencies: { knex: "^3.1.0" },
      devDependencies: { eslint: "^9.0.0" },
      descriptorSource: createDescriptorSource(descriptor)
    });

    const result = runNodeScript(SYNC_SCRIPT, ["--root", root, "--write", "--json"]);
    assert.equal(result.status, 0, result.stderr);

    const syncedDescriptor = await import(
      `${pathToFileURL(path.join(packageRoot, "package.descriptor.mjs")).href}?cacheBust=${Date.now()}`
    );
    assert.equal(syncedDescriptor.default.mutations.dependencies.runtime.knex, "^3.1.0");
    assert.equal(syncedDescriptor.default.mutations.dependencies.dev.eslint, "^9.0.0");
  });
});

test("drift checker passes positive fixture and fails negative fixture", async () => {
  await withTempRepo(async (root) => {
    const positiveDescriptor = {
      packageVersion: 1,
      packageId: "@test/positive",
      version: "0.0.1",
      dependsOn: [],
      capabilities: { provides: [], requires: [] },
      mutations: {
        dependencies: {
          runtime: { fastify: "^5.0.0" },
          dev: { vitest: "^4.0.0" }
        },
        packageJson: { scripts: {} },
        procfile: {},
        files: [{ from: "templates/schema.sql", to: "schema.sql" }]
      }
    };

    await createFixturePackage({
      root,
      domain: "runtime",
      packageName: "positive",
      npmName: "@test/positive",
      dependencies: { fastify: "^5.0.0" },
      devDependencies: { vitest: "^4.0.0" },
      descriptorSource: createDescriptorSource(positiveDescriptor),
      templateFiles: {
        "templates/schema.sql": "select 1;\n"
      }
    });

    const positive = runNodeScript(DRIFT_SCRIPT, ["--root", root, "--package", "@test/positive", "--json"]);
    assert.equal(positive.status, 0, positive.stderr);
    assert.equal(JSON.parse(positive.stdout).issueCount, 0);

    const negativeDescriptor = {
      packageVersion: 1,
      packageId: "@test/negative",
      version: "0.0.1",
      dependsOn: [],
      capabilities: { provides: [], requires: [] },
      mutations: {
        dependencies: {
          runtime: {},
          dev: {}
        },
        packageJson: { scripts: {} },
        procfile: {},
        files: []
      }
    };

    await createFixturePackage({
      root,
      domain: "runtime",
      packageName: "negative",
      npmName: "@test/negative",
      dependencies: { knex: "^3.0.0" },
      devDependencies: {},
      descriptorSource: createDescriptorSource(negativeDescriptor),
      templateFiles: {
        "templates/table.sql": "create table t();\n"
      }
    });

    const negative = runNodeScript(DRIFT_SCRIPT, ["--root", root, "--package", "@test/negative", "--json"]);
    assert.notEqual(negative.status, 0);
    const payload = JSON.parse(negative.stdout);
    assert.ok(payload.issueCount >= 2);
    assert.ok(
      payload.issues.some((issue) => issue.message.includes("runtime dependencies drift")),
      "Expected runtime dependency drift issue."
    );
    assert.ok(
      payload.issues.some((issue) => issue.message.includes("not declared in descriptor mutations.files")),
      "Expected template mapping drift issue."
    );
  });
});
