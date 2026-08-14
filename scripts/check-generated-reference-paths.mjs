import path from "node:path";
import process from "node:process";
import { access, readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

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

function collectRelativePathReferences(node, location = "package.json.jskit", references = []) {
  if (Array.isArray(node)) {
    for (let index = 0; index < node.length; index += 1) {
      collectRelativePathReferences(node[index], `${location}[${index}]`, references);
    }
    return references;
  }

  if (!isPlainObject(node)) {
    return references;
  }

  const isSourceImportMutation =
    location.includes(".mutations.source[") &&
    String(node.op || "").trim() === "ensure-import";

  for (const [key, value] of Object.entries(node)) {
    const nextLocation = `${location}.${key}`;
    if (
      (key === "from" || key === "expectedExistingFrom") &&
      !isSourceImportMutation &&
      typeof value === "string" &&
      String(value).trim()
    ) {
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

async function collectPackageManifestRecords(packagesRoot) {
  const records = [];
  const levelOne = await readdir(packagesRoot, { withFileTypes: true });

  for (const entry of levelOne) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) {
      continue;
    }

    const absolute = path.join(packagesRoot, entry.name);
    const packageJsonPath = path.join(absolute, "package.json");
    if (await fileExists(packageJsonPath)) {
      const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
      if (isPlainObject(packageJson.jskit)) {
        records.push({
          packageRoot: absolute,
          packageJsonPath,
          packageJson
        });
        continue;
      }
    }

    const nested = await readdir(absolute, { withFileTypes: true }).catch(() => []);
    for (const child of nested) {
      if (!child.isDirectory() || child.name.startsWith(".")) {
        continue;
      }

      const nestedAbsolute = path.join(absolute, child.name);
      const nestedPackageJsonPath = path.join(nestedAbsolute, "package.json");
      if (!(await fileExists(nestedPackageJsonPath))) {
        continue;
      }
      const packageJson = JSON.parse(await readFile(nestedPackageJsonPath, "utf8"));
      if (!isPlainObject(packageJson.jskit)) {
        continue;
      }

      records.push({
        packageRoot: nestedAbsolute,
        packageJsonPath: nestedPackageJsonPath,
        packageJson
      });
    }
  }

  return records.sort((left, right) => left.packageRoot.localeCompare(right.packageRoot));
}

async function collectToolingManifestRecords(toolingRoot) {
  const records = [];
  const levelOne = await readdir(toolingRoot, { withFileTypes: true }).catch(() => []);

  for (const entry of levelOne) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) {
      continue;
    }

    const packageRoot = path.join(toolingRoot, entry.name);
    const packageJsonPath = path.join(packageRoot, "package.json");
    if (!(await fileExists(packageJsonPath))) {
      continue;
    }
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
    if (!isPlainObject(packageJson.jskit)) {
      continue;
    }

    records.push({
      packageRoot,
      packageJsonPath,
      packageJson
    });
  }

  return records.sort((left, right) => left.packageRoot.localeCompare(right.packageRoot));
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

async function validateManifestRecords({ repoRoot, records }) {
  const errors = [];
  const byPackageId = new Map();

  for (const record of records) {
    const packageId = String(record.packageJson?.name || "").trim();
    if (packageId) {
      byPackageId.set(packageId, record.packageRoot);
    }

    const manifestErrors = await validatePathReferences({
      repoRoot,
      ownerLabel: toRepoRelative(repoRoot, record.packageJsonPath),
      packageRoot: record.packageRoot,
      node: record.packageJson.jskit,
      locationPrefix: "package.json.jskit"
    });
    errors.push(...manifestErrors);
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

    const metadataErrors = await validatePathReferences({
      repoRoot,
      ownerLabel: `tooling/jskit-catalog/catalog/packages.json (${packageId})`,
      packageRoot,
      node: entry?.jskit || {},
      locationPrefix: "package.json.jskit"
    });
    errors.push(...metadataErrors);
  }

  return errors;
}

async function validateGeneratedReferencePaths({ repoRoot = process.cwd() } = {}) {
  const packagesRoot = path.join(repoRoot, "packages");
  const toolingRoot = path.join(repoRoot, "tooling");
  const packageRecords = await collectPackageManifestRecords(packagesRoot);
  const toolingRecords = await collectToolingManifestRecords(toolingRoot);
  const manifestValidation = await validateManifestRecords({
    repoRoot,
    records: [
      ...packageRecords,
      ...toolingRecords
    ]
  });
  const catalogErrors = await validateCatalog({
    repoRoot,
    packageRootsById: manifestValidation.byPackageId
  });
  const errors = [
    ...manifestValidation.errors,
    ...catalogErrors
  ];

  if (errors.length > 0) {
    process.stderr.write("Generated package metadata/catalog path check failed:\n");
    for (const error of errors) {
      process.stderr.write(`- ${error}\n`);
    }
    throw new Error(`Found ${errors.length} generated package metadata/catalog path issue(s).`);
  }

  process.stdout.write("Generated package metadata/catalog paths are valid.\n");
}

if (path.resolve(process.argv[1] || "") === SCRIPT_PATH) {
  await validateGeneratedReferencePaths();
}

export {
  validateGeneratedReferencePaths
};
