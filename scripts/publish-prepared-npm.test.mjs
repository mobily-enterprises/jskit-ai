import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertPublicationConfirmation,
  buildPlanFingerprint,
  buildPreparedReleaseGraph,
  hydrateWorkspaceRecords,
  parseExactPackageSpec,
  parsePreparedArgs,
  partitionPreparedRegistryArtifacts,
  previousPatchVersion,
  validatePreparedRegistryState
} from "./publish-prepared-npm.mjs";

test("prepared release package specs require exact stable versions", () => {
  assert.deepEqual(parseExactPackageSpec("@jskit-ai/auth-core@0.1.145"), {
    packageToken: "@jskit-ai/auth-core",
    version: "0.1.145"
  });
  assert.throws(() => parseExactPackageSpec("@jskit-ai/auth-core"), /include an exact version/u);
  assert.throws(() => parseExactPackageSpec("auth-core@next"), /stable x\.y\.z/u);
});

test("prepared release is non-publishing by default and forbids offline publication", () => {
  const options = parsePreparedArgs([
    "--offline",
    "--only",
    "@jskit-ai/auth-core@0.1.145"
  ]);
  assert.equal(options.publish, false);
  assert.equal(options.offline, true);
  assert.throws(
    () => parsePreparedArgs([
      "--publish",
      "--offline",
      "--only",
      "@jskit-ai/auth-core@0.1.145"
    ]),
    /registry validation is mandatory/u
  );
  assert.throws(
    () => parsePreparedArgs(["--publish", "--dry-run", "--only", "@jskit-ai/auth-core@0.1.145"]),
    /mutually exclusive/u
  );
  assert.throws(
    () => parsePreparedArgs(["--resume", "--offline", "--only", "@jskit-ai/auth-core@0.1.145"]),
    /existing registry artifacts must be verified/u
  );
});

test("prepared release order keeps dependencies and catalog closure before consumers", () => {
  const selected = new Map([
    ["@jskit-ai/auth-core", {
      name: "@jskit-ai/auth-core",
      version: "0.1.145",
      dependencies: []
    }],
    ["@jskit-ai/jskit-catalog", {
      name: "@jskit-ai/jskit-catalog",
      version: "0.1.168",
      dependencies: [{
        name: "@jskit-ai/auth-core",
        version: "0.1.145",
        ordersBefore: false
      }, {
        name: "@jskit-ai/jskit-cli",
        version: "0.2.174",
        ordersBefore: false
      }]
    }],
    ["@jskit-ai/jskit-cli", {
      name: "@jskit-ai/jskit-cli",
      version: "0.2.174",
      dependencies: [{
        name: "@jskit-ai/jskit-catalog",
        version: "0.1.168",
        ordersBefore: true
      }]
    }],
    ["@jskit-ai/create-app", {
      name: "@jskit-ai/create-app",
      version: "0.1.166",
      dependencies: [{
        name: "@jskit-ai/jskit-cli",
        version: "0.2.174",
        ordersBefore: true
      }]
    }]
  ]);

  assert.deepEqual(buildPreparedReleaseGraph(selected), [
    "@jskit-ai/auth-core",
    "@jskit-ai/jskit-catalog",
    "@jskit-ai/jskit-cli",
    "@jskit-ai/create-app"
  ]);
});

test("prepared release deterministically orders strongly connected package cycles", () => {
  const selected = new Map([
    ["@jskit-ai/consumer", {
      name: "@jskit-ai/consumer",
      version: "0.1.2",
      dependencies: [{ name: "@jskit-ai/b", version: "0.1.2", ordersBefore: true }]
    }],
    ["@jskit-ai/foundation", {
      name: "@jskit-ai/foundation",
      version: "0.1.2",
      dependencies: []
    }],
    ["@jskit-ai/a", {
      name: "@jskit-ai/a",
      version: "0.1.2",
      dependencies: [{ name: "@jskit-ai/b", version: "0.1.2", ordersBefore: true }]
    }],
    ["@jskit-ai/b", {
      name: "@jskit-ai/b",
      version: "0.1.2",
      dependencies: [{
        name: "@jskit-ai/a",
        version: "0.1.2",
        ordersBefore: true
      }, {
        name: "@jskit-ai/foundation",
        version: "0.1.2",
        ordersBefore: true
      }]
    }]
  ]);
  const expected = [
    "@jskit-ai/foundation",
    "@jskit-ai/a",
    "@jskit-ai/b",
    "@jskit-ai/consumer"
  ];
  assert.deepEqual(buildPreparedReleaseGraph(selected), expected);
  assert.deepEqual(buildPreparedReleaseGraph(new Map(Array.from(selected).reverse())), expected);
});

test("closure retains exact JSKIT dependencies that are not in this workspace", async () => {
  const record = {
    name: "@jskit-ai/consumer",
    version: "0.1.4",
    packageJson: {
      name: "@jskit-ai/consumer",
      version: "0.1.4",
      dependencies: { "@jskit-ai/external": "0.1.9" }
    },
    descriptorPath: "",
    descriptor: null,
    dependencies: []
  };
  await hydrateWorkspaceRecords([record], [record]);
  assert.deepEqual(record.dependencies, [{
    name: "@jskit-ai/external",
    version: "0.1.9",
    ordersBefore: true,
    sources: ["package.json#dependencies"]
  }]);
});

test("catalog closure includes exact dependencies embedded in catalog descriptors", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "jskit-catalog-closure-test-"));
  try {
    const catalogDir = path.join(tempRoot, "catalog");
    await mkdir(catalogDir, { recursive: true });
    await writeFile(path.join(catalogDir, "packages.json"), JSON.stringify({
      packages: [{
        packageId: "@jskit-ai/consumer",
        version: "0.1.4",
        descriptor: {
          mutations: {
            dependencies: {
              runtime: { "@jskit-ai/kernel": "0.1.146" }
            }
          }
        }
      }]
    }), "utf8");
    const catalog = {
      name: "@jskit-ai/jskit-catalog",
      version: "0.1.168",
      dir: tempRoot,
      packageJson: { name: "@jskit-ai/jskit-catalog", version: "0.1.168" },
      descriptorPath: "",
      descriptor: null,
      dependencies: [],
      registryRequirements: []
    };
    await hydrateWorkspaceRecords([catalog], [catalog]);
    assert.deepEqual(catalog.registryRequirements, [{
      name: "@jskit-ai/kernel",
      version: "0.1.146",
      sources: ["catalog#@jskit-ai/consumer.mutations.dependencies.runtime"]
    }]);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("registry validation requires the prior version, target absence, and complete closure", () => {
  const dependency = {
    name: "@jskit-ai/dependency",
    version: "0.1.9",
    dependencies: []
  };
  const consumer = {
    name: "@jskit-ai/consumer",
    version: "0.1.4",
    dependencies: [{ name: dependency.name, version: dependency.version, ordersBefore: true }]
  };
  const selected = new Map([[consumer.name, consumer]]);
  const metadata = new Map([
    [consumer.name, { versions: { "0.1.3": {} } }],
    [dependency.name, { versions: { "0.1.8": {} } }]
  ]);

  assert.throws(
    () => validatePreparedRegistryState(selected, metadata),
    /Incomplete prepared release closure/u
  );
  metadata.get(dependency.name).versions[dependency.version] = {};
  assert.doesNotThrow(() => validatePreparedRegistryState(selected, metadata));
  metadata.get(consumer.name).versions[consumer.version] = {};
  assert.throws(
    () => validatePreparedRegistryState(selected, metadata),
    /already exists and cannot be overwritten/u
  );
  assert.equal(previousPatchVersion("0.2.174"), "0.2.173");
});

test("resume accepts only byte-identical existing artifacts and identifies missing work", () => {
  const artifact = {
    name: "@jskit-ai/a",
    version: "0.1.2",
    integrity: "sha512-exact",
    shasum: "exact"
  };
  const artifacts = new Map([[artifact.name, artifact]]);
  const metadata = new Map([[artifact.name, {
    versions: {
      [artifact.version]: {
        name: artifact.name,
        version: artifact.version,
        dist: { integrity: artifact.integrity, shasum: artifact.shasum }
      }
    }
  }]]);
  assert.deepEqual(partitionPreparedRegistryArtifacts({
    artifacts,
    order: [artifact.name],
    registryMetadata: metadata
  }), { existing: [artifact.name], missing: [] });
  metadata.get(artifact.name).versions[artifact.version].dist.integrity = "sha512-different";
  assert.throws(
    () => partitionPreparedRegistryArtifacts({
      artifacts,
      order: [artifact.name],
      registryMetadata: metadata
    }),
    /cannot be resumed/u
  );
  metadata.get(artifact.name).versions = {};
  assert.deepEqual(partitionPreparedRegistryArtifacts({
    artifacts,
    order: [artifact.name],
    registryMetadata: metadata
  }), { existing: [], missing: [artifact.name] });
});

test("plan confirmation fingerprints bind registry, order, and artifact integrity", () => {
  const artifacts = new Map([["@jskit-ai/a", {
    name: "@jskit-ai/a",
    version: "0.1.2",
    integrity: "sha512-one",
    shasum: "one"
  }]]);
  const input = {
    artifacts,
    order: ["@jskit-ai/a"],
    registry: "https://registry.npmjs.org",
    tag: "latest",
    access: "public"
  };
  const first = buildPlanFingerprint(input);
  assert.equal(first, buildPlanFingerprint(input));
  assert.throws(
    () => assertPublicationConfirmation({ publish: true, confirm: "sha256:wrong", fingerprint: first }),
    /confirmation mismatch/u
  );
  assert.doesNotThrow(
    () => assertPublicationConfirmation({ publish: true, confirm: first, fingerprint: first })
  );
  artifacts.get("@jskit-ai/a").integrity = "sha512-two";
  assert.notEqual(first, buildPlanFingerprint(input));
});

function runOfflineCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      fileURLToPath(new URL("./publish-prepared-npm.mjs", import.meta.url)),
      ...args
    ], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: { ...process.env, NPM_TOKEN: "" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

test("offline dry-run packs exact current sources without registry access", { timeout: 30_000 }, async () => {
  const agentDocsPackage = JSON.parse(
    await readFile(new URL("../packages/agent-docs/package.json", import.meta.url), "utf8")
  );
  const result = await runOfflineCli([
    "--dry-run",
    "--offline",
    "--registry",
    "http://127.0.0.1:9",
    "--only",
    `${agentDocsPackage.name}@${agentDocsPackage.version}`
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Plan fingerprint: sha256:[a-f0-9]{64}/u);
  assert.match(result.stdout, /No registry request or publish was attempted/u);
});
