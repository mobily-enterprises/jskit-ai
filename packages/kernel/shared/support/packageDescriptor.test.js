import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { loadInstalledPackageDescriptor, resolveDescriptorPathForInstalledPackage } from "./packageDescriptor.js";

async function createFixtureRoot(prefix) {
  return mkdtemp(path.join(tmpdir(), prefix));
}

async function writeDescriptorFile(filePath, descriptorSource) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, descriptorSource, "utf8");
}

test("resolveDescriptorPathForInstalledPackage returns empty string when descriptor is missing and required=false", async () => {
  const appRoot = await createFixtureRoot("kernel-package-descriptor-missing-");
  try {
    const descriptorPath = await resolveDescriptorPathForInstalledPackage({
      appRoot,
      packageId: "@example/missing",
      installedPackageState: {},
      required: false
    });
    assert.equal(descriptorPath, "");
  } finally {
    await rm(appRoot, { recursive: true, force: true });
  }
});

test("resolveDescriptorPathForInstalledPackage throws when descriptor is missing and required=true", async () => {
  const appRoot = await createFixtureRoot("kernel-package-descriptor-required-");
  try {
    await assert.rejects(
      () =>
        resolveDescriptorPathForInstalledPackage({
          appRoot,
          packageId: "@example/missing",
          installedPackageState: {},
          required: true
        }),
      /Unable to resolve package descriptor for @example\/missing\./
    );
  } finally {
    await rm(appRoot, { recursive: true, force: true });
  }
});

test("resolveDescriptorPathForInstalledPackage resolves descriptor using source.packagePath", async () => {
  const appRoot = await createFixtureRoot("kernel-package-descriptor-package-path-");
  try {
    const descriptorPath = path.join(appRoot, "packages", "local-example", "package.descriptor.mjs");
    await writeDescriptorFile(descriptorPath, "export default { packageId: \"@local/example\" };\n");

    const resolvedDescriptorPath = await resolveDescriptorPathForInstalledPackage({
      appRoot,
      packageId: "@local/example",
      installedPackageState: {
        source: {
          packagePath: "packages/local-example"
        }
      },
      required: true
    });
    assert.equal(resolvedDescriptorPath, descriptorPath);
  } finally {
    await rm(appRoot, { recursive: true, force: true });
  }
});

test("resolveDescriptorPathForInstalledPackage resolves descriptor using jskit-cli descriptorPath fallback", async () => {
  const appRoot = await createFixtureRoot("kernel-package-descriptor-jskit-root-");
  try {
    const descriptorPath = path.join(
      appRoot,
      "node_modules",
      "@jskit-ai",
      "jskit-cli",
      "descriptors",
      "example.descriptor.mjs"
    );
    await writeDescriptorFile(descriptorPath, "export default { packageId: \"@example/test\" };\n");

    const resolvedDescriptorPath = await resolveDescriptorPathForInstalledPackage({
      appRoot,
      packageId: "@example/test",
      installedPackageState: {
        source: {
          descriptorPath: "descriptors/example.descriptor.mjs"
        }
      },
      required: true
    });
    assert.equal(resolvedDescriptorPath, descriptorPath);
  } finally {
    await rm(appRoot, { recursive: true, force: true });
  }
});

test("loadInstalledPackageDescriptor loads descriptor payload once resolved", async () => {
  const appRoot = await createFixtureRoot("kernel-package-descriptor-load-");
  try {
    const descriptorPath = path.join(appRoot, "node_modules", "@example", "ready", "package.descriptor.mjs");
    await writeDescriptorFile(descriptorPath, "export default { packageId: \"@example/ready\", version: \"1.0.0\" };\n");

    const descriptorRecord = await loadInstalledPackageDescriptor({
      appRoot,
      packageId: "@example/ready",
      installedPackageState: {},
      required: true
    });

    assert.equal(descriptorRecord.descriptorPath, descriptorPath);
    assert.equal(descriptorRecord.descriptor.packageId, "@example/ready");
    assert.equal(descriptorRecord.descriptor.version, "1.0.0");
  } finally {
    await rm(appRoot, { recursive: true, force: true });
  }
});
