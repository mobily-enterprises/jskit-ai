import assert from "node:assert/strict";
import path from "node:path";
import { readdir } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  CAPABILITY_CONTRACTS,
  CAPABILITY_CONTRACT_IDS,
  getCapabilityContractApiEntries,
  getCapabilityContract,
  getCapabilityContractRequiredSymbols,
  getCapabilityContractTestRelativePath
} from "../contracts/capabilities/index.mjs";
import { normalizePackageDescriptor } from "../src/shared/schemas/packageDescriptor.mjs";
import { validateCapabilityContracts } from "../src/shared/capabilityContracts.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PACKAGES_ROOT = path.join(REPO_ROOT, "packages");

function toSortedUniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

async function listPackageDescriptorPaths() {
  const paths = [];

  async function walk(currentDir) {
    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) {
          continue;
        }
        await walk(absolutePath);
        continue;
      }

      if (entry.isFile() && entry.name === "package.descriptor.mjs") {
        paths.push(absolutePath);
      }
    }
  }

  await walk(PACKAGES_ROOT);
  return paths.sort((left, right) => left.localeCompare(right));
}

async function loadAvailablePackages() {
  const descriptorPaths = await listPackageDescriptorPaths();
  const availablePackages = new Map();

  for (const descriptorPath of descriptorPaths) {
    const descriptorModule = await import(pathToFileURL(descriptorPath).href + `?t=${Date.now()}_${Math.random()}`);
    const descriptor = normalizePackageDescriptor(descriptorModule?.default || {}, descriptorPath);
    availablePackages.set(descriptor.packageId, {
      descriptor,
      descriptorPath,
      packageRoot: path.dirname(descriptorPath)
    });
  }

  return availablePackages;
}

function buildDescriptorRequiredCapabilityIds(availablePackages) {
  const capabilityIds = [];
  for (const packageEntry of availablePackages.values()) {
    const requires = Array.isArray(packageEntry?.descriptor?.capabilities?.requires)
      ? packageEntry.descriptor.capabilities.requires
      : [];
    capabilityIds.push(...requires);
  }
  return toSortedUniqueStrings(capabilityIds);
}

test("central capability contracts cover descriptor required capability IDs", async () => {
  const availablePackages = await loadAvailablePackages();
  const descriptorCapabilityIds = buildDescriptorRequiredCapabilityIds(availablePackages);

  assert.deepEqual(CAPABILITY_CONTRACT_IDS, descriptorCapabilityIds);
  assert.equal(getCapabilityContractTestRelativePath("billing.provider"), "test/contracts/billing.provider.contract.test.js");
  assert.equal(getCapabilityContractTestRelativePath(""), "");

  for (const capabilityId of CAPABILITY_CONTRACT_IDS) {
    const entry = getCapabilityContract(capabilityId);
    assert.ok(entry);
    assert.equal(entry.capabilityId, capabilityId);
    assert.equal(typeof entry.kind, "string");
    assert.equal(entry.kind.trim().length > 0, true);
    assert.equal(typeof entry.summary, "string");
    assert.equal(entry.summary.trim().length > 0, true);
    const apiEntries = getCapabilityContractApiEntries(capabilityId);
    assert.equal(Array.isArray(apiEntries), true);
    assert.equal(apiEntries.length > 0, true);
    for (const apiEntry of apiEntries) {
      assert.equal(typeof apiEntry.entrypoint, "string");
      assert.equal(apiEntry.entrypoint.trim().length > 0, true);
      assert.equal(Array.isArray(apiEntry.functions), true);
      assert.equal(Array.isArray(apiEntry.constants), true);
      assert.equal(getCapabilityContractRequiredSymbols(apiEntry).length > 0, true);
      assert.equal(apiEntry.requireContractTest === 0 || apiEntry.requireContractTest === 1, true);
    }
    assert.equal(entry.providers, undefined);
    assert.equal(entry.consumers, undefined);
  }
});

test("capability contracts validate against package descriptors", async () => {
  const availablePackages = await loadAvailablePackages();
  const validation = await validateCapabilityContracts(availablePackages);

  assert.equal(validation.ok, true, validation.issues.join("\n"));
  assert.equal(validation.contractCount, CAPABILITY_CONTRACT_IDS.length);
  assert.equal(validation.usedCapabilityCount, CAPABILITY_CONTRACT_IDS.length);
  assert.deepEqual(Object.keys(CAPABILITY_CONTRACTS).sort((left, right) => left.localeCompare(right)), CAPABILITY_CONTRACT_IDS);
});
