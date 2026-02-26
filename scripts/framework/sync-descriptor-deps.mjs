#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import process from "node:process";
import path from "node:path";
import {
  collectPackageEntries,
  fileExists,
  loadDescriptor,
  normalizeDescriptorShape,
  parseArgs,
  renderDescriptor,
  toSortedObject,
  writeTextFile
} from "./_descriptor-utils.mjs";

function matchesPackageFilter(entry, packageJsonName, packageFilter) {
  if (!packageFilter) {
    return true;
  }
  return (
    entry.packageName === packageFilter ||
    entry.relativePackagePath === packageFilter ||
    packageJsonName === packageFilter
  );
}

const options = parseArgs(process.argv.slice(2));
const dryRun = options.dryRun || !options.write;
const packageEntries = await collectPackageEntries(options.root);

const updated = [];
const unchanged = [];
const skipped = [];

for (const entry of packageEntries) {
  if (!(await fileExists(entry.descriptorPath))) {
    skipped.push(entry.relativePackagePath);
    continue;
  }

  const packageJson = JSON.parse(await readFile(entry.packageJsonPath, "utf8"));
  const packageJsonName = String(packageJson.name || "").trim();
  if (!matchesPackageFilter(entry, packageJsonName, options.packageFilter)) {
    continue;
  }

  const existingDescriptor = await loadDescriptor(entry.descriptorPath);
  const normalizedDescriptor = normalizeDescriptorShape(
    existingDescriptor,
    packageJsonName || `@jskit-ai/${entry.packageName}`,
    packageJson.version
  );

  const nextDescriptor = {
    ...normalizedDescriptor,
    mutations: {
      ...normalizedDescriptor.mutations,
      dependencies: {
        runtime: toSortedObject(packageJson.dependencies || {}),
        dev: toSortedObject(packageJson.devDependencies || {})
      }
    }
  };

  const currentSerialized = JSON.stringify(normalizedDescriptor);
  const nextSerialized = JSON.stringify(nextDescriptor);
  if (currentSerialized === nextSerialized) {
    unchanged.push(entry.relativePackagePath);
    continue;
  }

  updated.push(entry.relativePackagePath);
  if (!dryRun) {
    await writeTextFile(entry.descriptorPath, renderDescriptor(nextDescriptor));
  }
}

const result = {
  root: path.resolve(options.root),
  packageFilter: options.packageFilter || null,
  dryRun,
  updatedCount: updated.length,
  unchangedCount: unchanged.length,
  skippedCount: skipped.length,
  updated,
  unchanged,
  skipped
};

if (options.json) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  process.stdout.write(
    `Synced descriptor dependencies: updated ${result.updatedCount}, unchanged ${result.unchangedCount}, skipped ${result.skippedCount}.\n`
  );
}
