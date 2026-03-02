#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import process from "node:process";
import path from "node:path";
import {
  collectPackageEntries,
  detectTemplateMappings,
  fileExists,
  loadDescriptor,
  normalizeDescriptorShape,
  parseArgs,
  toSortedObject
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

function compareObjectMaps(left, right) {
  return JSON.stringify(toSortedObject(left || {})) === JSON.stringify(toSortedObject(right || {}));
}

function createIssue(entry, message) {
  return {
    packagePath: entry.relativePackagePath,
    message
  };
}

const options = parseArgs(process.argv.slice(2));
const packageEntries = await collectPackageEntries(options.root);
const issues = [];
const checked = [];
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

  checked.push(entry.relativePackagePath);
  const descriptor = normalizeDescriptorShape(
    await loadDescriptor(entry.descriptorPath),
    packageJsonName || `@jskit-ai/${entry.packageName}`,
    packageJson.version
  );

  if (!compareObjectMaps(descriptor.mutations.dependencies.runtime, packageJson.dependencies || {})) {
    issues.push(createIssue(entry, "Descriptor runtime dependencies drift from package.json dependencies."));
  }
  if (!compareObjectMaps(descriptor.mutations.dependencies.dev, packageJson.devDependencies || {})) {
    issues.push(createIssue(entry, "Descriptor dev dependencies drift from package.json devDependencies."));
  }

  const requiredAppScripts = packageJson?.jskit?.requiredAppScripts || {};
  const descriptorScripts = descriptor.mutations.packageJson.scripts || {};
  if (requiredAppScripts && typeof requiredAppScripts === "object" && !Array.isArray(requiredAppScripts)) {
    for (const [scriptName, scriptCommand] of Object.entries(requiredAppScripts)) {
      if (String(descriptorScripts[scriptName] || "") !== String(scriptCommand)) {
        issues.push(
          createIssue(
            entry,
            `Descriptor script ${scriptName} must match package.json jskit.requiredAppScripts entry.`
          )
        );
      }
    }

    for (const scriptName of Object.keys(descriptorScripts)) {
      if (!Object.prototype.hasOwnProperty.call(requiredAppScripts, scriptName)) {
        issues.push(
          createIssue(
            entry,
            `Descriptor script ${scriptName} is declared but not listed in package.json jskit.requiredAppScripts.`
          )
        );
      }
    }
  }

  const declaredFiles = Array.isArray(descriptor.mutations.files) ? descriptor.mutations.files : [];
  const declaredFromPaths = new Set();

  for (const fileEntry of declaredFiles) {
    const fromPath = String(fileEntry?.from || "");
    if (!fromPath) {
      issues.push(createIssue(entry, "Descriptor file entry has an empty from path."));
      continue;
    }
    declaredFromPaths.add(fromPath);

    const absoluteFromPath = path.join(entry.packageRoot, fromPath);
    if (!(await fileExists(absoluteFromPath))) {
      issues.push(createIssue(entry, `Descriptor file source does not exist: ${fromPath}`));
    }
  }

  const detectedTemplateMappings = await detectTemplateMappings(entry.packageRoot);
  for (const mapping of detectedTemplateMappings) {
    if (!declaredFromPaths.has(mapping.from)) {
      issues.push(
        createIssue(
          entry,
          `Template file ${mapping.from} exists but is not declared in descriptor mutations.files.`
        )
      );
    }
  }
}

const result = {
  root: path.resolve(options.root),
  packageFilter: options.packageFilter || null,
  checkedCount: checked.length,
  skippedCount: skipped.length,
  issueCount: issues.length,
  checked,
  skipped,
  issues
};

if (options.json) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else if (issues.length === 0) {
  process.stdout.write(
    `Descriptor drift check passed for ${result.checkedCount} descriptor package(s). Skipped ${result.skippedCount} package(s) without descriptors.\n`
  );
} else {
  process.stdout.write(
    `Descriptor drift check failed with ${result.issueCount} issue(s) across ${result.checkedCount} descriptor package(s).\n`
  );
  for (const issue of issues) {
    process.stdout.write(`- ${issue.packagePath}: ${issue.message}\n`);
  }
}

process.exit(issues.length === 0 ? 0 : 1);
