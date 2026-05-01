import path from "node:path";
import process from "node:process";
import { access, readFile, readdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function fileExists(absolutePath) {
  try {
    await access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

function shouldValidateSourcePath(value = "") {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return false;
  }
  if (normalized.startsWith("mutations.")) {
    return false;
  }
  if (normalized.includes("://")) {
    return false;
  }
  return normalized.includes("/") || normalized.includes("\\");
}

function collectRelativePathReferences(node, location = "descriptor", references = []) {
  if (Array.isArray(node)) {
    for (let index = 0; index < node.length; index += 1) {
      collectRelativePathReferences(node[index], `${location}[${index}]`, references);
    }
    return references;
  }

  if (!isPlainObject(node)) {
    return references;
  }

  for (const [key, value] of Object.entries(node)) {
    const nextLocation = `${location}.${key}`;
    if ((key === "from" || key === "expectedExistingFrom") && typeof value === "string" && String(value).trim()) {
      references.push({
        location: nextLocation,
        relativePath: String(value).trim()
      });
      continue;
    }

    if (key === "source" && typeof value === "string" && shouldValidateSourcePath(value)) {
      references.push({
        location: nextLocation,
        relativePath: String(value).trim()
      });
      continue;
    }

    collectRelativePathReferences(value, nextLocation, references);
  }

  return references;
}

async function collectPackageDescriptorRecords(packagesRoot) {
  const records = [];
  const levelOne = await readdir(packagesRoot, { withFileTypes: true });

  for (const entry of levelOne) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name.endsWith(".LEGACY")) {
      continue;
    }

    const absolute = path.join(packagesRoot, entry.name);
    const descriptorPath = path.join(absolute, "package.descriptor.mjs");
    if (await fileExists(descriptorPath)) {
      records.push({
        packageRoot: absolute,
        descriptorPath
      });
      continue;
    }

    const nested = await readdir(absolute, { withFileTypes: true }).catch(() => []);
    for (const child of nested) {
      if (!child.isDirectory() || child.name.startsWith(".")) {
        continue;
      }

      const nestedAbsolute = path.join(absolute, child.name);
      const nestedDescriptorPath = path.join(nestedAbsolute, "package.descriptor.mjs");
      if (!(await fileExists(nestedDescriptorPath))) {
        continue;
      }

      records.push({
        packageRoot: nestedAbsolute,
        descriptorPath: nestedDescriptorPath
      });
    }
  }

  return records.sort((left, right) => left.packageRoot.localeCompare(right.packageRoot));
}

async function collectToolingDescriptorRecords(toolingRoot) {
  const records = [];
  const levelOne = await readdir(toolingRoot, { withFileTypes: true }).catch(() => []);

  for (const entry of levelOne) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) {
      continue;
    }

    const packageRoot = path.join(toolingRoot, entry.name);
    const descriptorPath = path.join(packageRoot, "package.descriptor.mjs");
    if (!(await fileExists(descriptorPath))) {
      continue;
    }

    records.push({
      packageRoot,
      descriptorPath
    });
  }

  return records.sort((left, right) => left.packageRoot.localeCompare(right.packageRoot));
}

async function importDescriptorModule(descriptorPath) {
  const descriptorModule = await import(`${pathToFileURL(descriptorPath).href}?t=${Date.now()}_${Math.random()}`);
  const descriptor = descriptorModule?.default;
  if (!isPlainObject(descriptor)) {
    throw new TypeError(`Invalid descriptor default export in ${descriptorPath}`);
  }
  return descriptor;
}

function toRepoRelative(repoRoot, absolutePath) {
  return path.relative(repoRoot, absolutePath).split(path.sep).join("/");
}

async function validatePathReferences({ repoRoot, ownerLabel, packageRoot, node, locationPrefix }) {
  const errors = [];
  const references = collectRelativePathReferences(node, locationPrefix);

  for (const reference of references) {
    const absolutePath = path.resolve(packageRoot, reference.relativePath);
    if (await fileExists(absolutePath)) {
      continue;
    }

    errors.push(
      `${ownerLabel}: ${reference.location} -> ${reference.relativePath} is missing (expected ${toRepoRelative(repoRoot, absolutePath)})`
    );
  }

  return errors;
}

async function validateDescriptorRecords({ repoRoot, records }) {
  const errors = [];
  const byPackageId = new Map();

  for (const record of records) {
    const descriptor = await importDescriptorModule(record.descriptorPath);
    const packageId = String(descriptor?.packageId || "").trim();
    if (packageId) {
      byPackageId.set(packageId, record.packageRoot);
    }

    const descriptorErrors = await validatePathReferences({
      repoRoot,
      ownerLabel: toRepoRelative(repoRoot, record.descriptorPath),
      packageRoot: record.packageRoot,
      node: descriptor,
      locationPrefix: "descriptor"
    });
    errors.push(...descriptorErrors);
  }

  return {
    errors,
    byPackageId
  };
}

async function validateCatalog({ repoRoot, packageRootsById }) {
  const catalogPath = path.join(repoRoot, "tooling", "jskit-catalog", "catalog", "packages.json");
  const rawCatalog = await readFile(catalogPath, "utf8");
  const catalog = JSON.parse(rawCatalog);
  const entries = Array.isArray(catalog?.packages) ? catalog.packages : [];
  const errors = [];

  for (const entry of entries) {
    const packageId = String(entry?.packageId || "").trim();
    const packageRoot = packageRootsById.get(packageId);
    if (!packageRoot) {
      errors.push(`tooling/jskit-catalog/catalog/packages.json: package ${packageId || "<empty>"} does not map to a live package root.`);
      continue;
    }

    const descriptorErrors = await validatePathReferences({
      repoRoot,
      ownerLabel: `tooling/jskit-catalog/catalog/packages.json (${packageId})`,
      packageRoot,
      node: entry?.descriptor || {},
      locationPrefix: "descriptor"
    });
    errors.push(...descriptorErrors);
  }

  return errors;
}

async function validateGeneratedReferencePaths({ repoRoot = process.cwd() } = {}) {
  const packagesRoot = path.join(repoRoot, "packages");
  const toolingRoot = path.join(repoRoot, "tooling");
  const packageRecords = await collectPackageDescriptorRecords(packagesRoot);
  const toolingRecords = await collectToolingDescriptorRecords(toolingRoot);
  const descriptorValidation = await validateDescriptorRecords({
    repoRoot,
    records: [
      ...packageRecords,
      ...toolingRecords
    ]
  });
  const catalogErrors = await validateCatalog({
    repoRoot,
    packageRootsById: descriptorValidation.byPackageId
  });
  const errors = [
    ...descriptorValidation.errors,
    ...catalogErrors
  ];

  if (errors.length > 0) {
    process.stderr.write("Generated descriptor/catalog path check failed:\n");
    for (const error of errors) {
      process.stderr.write(`- ${error}\n`);
    }
    throw new Error(`Found ${errors.length} generated descriptor/catalog path issue(s).`);
  }

  process.stdout.write("Generated descriptor/catalog paths are valid.\n");
}

if (path.resolve(process.argv[1] || "") === SCRIPT_PATH) {
  await validateGeneratedReferencePaths();
}

export {
  validateGeneratedReferencePaths
};
