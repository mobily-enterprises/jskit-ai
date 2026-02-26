#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import process from "node:process";
import path from "node:path";
import {
  collectPackageEntries,
  detectTemplateMappings,
  fileExists,
  parseArgs,
  renderDescriptor,
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
const packageEntries = await collectPackageEntries(options.root);

const created = [];
const overwritten = [];
const skipped = [];
const targetedEntries = [];

for (const entry of packageEntries) {
  const packageJson = JSON.parse(await readFile(entry.packageJsonPath, "utf8"));
  const packageJsonName = String(packageJson.name || "").trim();
  if (!matchesPackageFilter(entry, packageJsonName, options.packageFilter)) {
    continue;
  }

  targetedEntries.push(entry);
  const descriptorExists = await fileExists(entry.descriptorPath);
  if (descriptorExists && !options.force) {
    skipped.push(entry.relativePackagePath);
    continue;
  }

  const packageId = packageJsonName || `@jskit-ai/${entry.packageName}`;
  const templateMappings = await detectTemplateMappings(entry.packageRoot);
  const descriptor = {
    packageVersion: 1,
    packageId,
    version: String(packageJson.version || "0.0.0"),
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
      files: templateMappings
    }
  };

  if (!options.dryRun) {
    await writeTextFile(entry.descriptorPath, renderDescriptor(descriptor));
  }

  if (descriptorExists) {
    overwritten.push(entry.relativePackagePath);
  } else {
    created.push(entry.relativePackagePath);
  }
}

const result = {
  root: path.resolve(options.root),
  packageFilter: options.packageFilter || null,
  dryRun: options.dryRun,
  force: options.force,
  targetedCount: targetedEntries.length,
  createdCount: created.length,
  overwrittenCount: overwritten.length,
  skippedCount: skipped.length,
  created,
  overwritten,
  skipped
};

if (options.json) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  process.stdout.write(
    `Generated descriptors for ${result.targetedCount} package(s): created ${result.createdCount}, overwritten ${result.overwrittenCount}, skipped ${result.skippedCount}.\n`
  );
}
