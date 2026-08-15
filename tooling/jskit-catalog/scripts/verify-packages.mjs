#!/usr/bin/env node
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertUniquePatternIds,
  discoverPackagePatterns
} from "./pattern-assets.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "../../..");
const PACKAGES_ROOT = path.join(REPO_ROOT, "packages");
const ALLOWED_JSKIT_FIELDS = new Set([
  "capabilities",
  "kind",
  "metadata",
  "migrations",
  "runtime",
  "vite"
]);
const FORBIDDEN_AUTHORING_FIELDS = new Set([
  "ci",
  "lifecycle",
  "mutations",
  "optionPolicies",
  "options"
]);

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function discoverFrameworkPackages() {
  const packages = [];
  for (const entry of await readdir(PACKAGES_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const packageRoot = path.join(PACKAGES_ROOT, entry.name);
    const manifestPath = path.join(packageRoot, "package.json");
    if (!(await fileExists(manifestPath))) {
      continue;
    }
    const packageJson = JSON.parse(await readFile(manifestPath, "utf8"));
    if (!packageJson.jskit) {
      continue;
    }
    packages.push({ packageRoot, manifestPath, packageJson });
  }
  return packages.sort((left, right) => left.packageJson.name.localeCompare(right.packageJson.name));
}

function requireStringArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => !String(item || "").trim())) {
    throw new Error(`${label} must be an array of non-empty strings.`);
  }
  const normalized = value.map((item) => String(item).trim());
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${label} contains duplicates.`);
  }
  return normalized;
}

function validateProviderList(packageRecord, side) {
  const { packageJson, packageRoot } = packageRecord;
  const label = `${packageJson.name}#jskit.runtime.${side}.providers`;
  const providers = packageJson.jskit?.runtime?.[side]?.providers || [];
  if (!Array.isArray(providers)) {
    throw new Error(`${label} must be an array.`);
  }
  return Promise.all(providers.map(async (provider, index) => {
    const entrypoint = String(provider?.entrypoint || "").trim();
    const exportName = String(provider?.export || "").trim();
    if (!entrypoint || !exportName) {
      throw new Error(`${label}[${index}] requires entrypoint and export.`);
    }
    if (path.isAbsolute(entrypoint) || entrypoint.startsWith("../")) {
      throw new Error(`${label}[${index}].entrypoint must stay inside its package.`);
    }
    if (!(await fileExists(path.resolve(packageRoot, entrypoint)))) {
      throw new Error(`${label}[${index}] points at missing ${entrypoint}.`);
    }
  }));
}

async function validateMigrations(packageRecord, migrationOwners) {
  const { packageJson, packageRoot } = packageRecord;
  const directories = packageJson.jskit?.migrations?.directories;
  if (typeof directories === "undefined") {
    return;
  }
  for (const relativeDirectory of requireStringArray(
    directories,
    `${packageJson.name}#jskit.migrations.directories`
  )) {
    if (path.isAbsolute(relativeDirectory) || relativeDirectory === ".." || relativeDirectory.startsWith("../")) {
      throw new Error(`${packageJson.name} migration directory must stay inside its package.`);
    }
    const absoluteDirectory = path.resolve(packageRoot, relativeDirectory);
    const entries = await readdir(absoluteDirectory, { withFileTypes: true }).catch(() => null);
    if (!entries) {
      throw new Error(`${packageJson.name} migration directory is missing: ${relativeDirectory}.`);
    }
    const migrations = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".cjs"));
    if (migrations.length < 1) {
      throw new Error(`${packageJson.name} migration directory contains no .cjs migrations.`);
    }
    for (const migration of migrations) {
      const previous = migrationOwners.get(migration.name);
      if (previous) {
        throw new Error(`Migration filename ${migration.name} is owned by both ${previous} and ${packageJson.name}.`);
      }
      migrationOwners.set(migration.name, packageJson.name);
    }
  }
}

async function validatePackage(packageRecord, localVersions, migrationOwners) {
  const { packageJson, packageRoot, manifestPath } = packageRecord;
  const packageId = String(packageJson.name || "").trim();
  const version = String(packageJson.version || "").trim();
  if (!packageId.startsWith("@jskit-ai/") || !/^0\.\d+\.\d+$/u.test(version)) {
    throw new Error(`${manifestPath} requires an @jskit-ai name and exact version-0 semver.`);
  }
  if (packageJson.jskit.kind !== "runtime") {
    throw new Error(`${packageId}#jskit.kind must be runtime; generator packages do not exist.`);
  }
  for (const field of Object.keys(packageJson.jskit)) {
    if (!ALLOWED_JSKIT_FIELDS.has(field)) {
      throw new Error(`${packageId}#jskit contains unsupported field ${field}.`);
    }
  }
  for (const field of FORBIDDEN_AUTHORING_FIELDS) {
    if (Object.hasOwn(packageJson.jskit, field)) {
      throw new Error(`${packageId} must not declare authoring field jskit.${field}.`);
    }
  }

  const provides = requireStringArray(
    packageJson.jskit.capabilities?.provides || [],
    `${packageId}#jskit.capabilities.provides`
  );
  const requires = requireStringArray(
    packageJson.jskit.capabilities?.requires || [],
    `${packageId}#jskit.capabilities.requires`
  );
  if (provides.some((capability) => requires.includes(capability))) {
    throw new Error(`${packageId} cannot both provide and require the same capability.`);
  }

  await validateProviderList(packageRecord, "server");
  await validateProviderList(packageRecord, "client");
  await validateMigrations(packageRecord, migrationOwners);

  for (const section of ["dependencies", "optionalDependencies", "peerDependencies"]) {
    for (const [dependencyId, declaredVersion] of Object.entries(packageJson[section] || {})) {
      if (localVersions.has(dependencyId) && declaredVersion !== localVersions.get(dependencyId)) {
        throw new Error(
          `${packageId}#${section}.${dependencyId} is ${declaredVersion}; expected ${localVersions.get(dependencyId)}.`
        );
      }
    }
  }

  const patterns = await discoverPackagePatterns({ packageRoot, packageJson });
  return patterns;
}

async function main() {
  const packages = await discoverFrameworkPackages();
  const localVersions = new Map(packages.map(({ packageJson }) => [packageJson.name, packageJson.version]));
  const migrationOwners = new Map();
  const patterns = [];
  for (const packageRecord of packages) {
    patterns.push(...await validatePackage(packageRecord, localVersions, migrationOwners));
  }
  assertUniquePatternIds(patterns);
  process.stdout.write(
    `Verified ${packages.length} JSKIT runtime packages, ${patterns.length} patterns, and ${migrationOwners.size} package migrations.\n`
  );
}

await main();
