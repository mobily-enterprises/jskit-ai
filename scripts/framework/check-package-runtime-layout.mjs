#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, toPosix } from "./_utils.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PACKAGES_ROOT = path.join(REPO_ROOT, "packages");
const EXPECTED_RUNTIME_DIRS = Object.freeze(["shared", "client", "server"]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function fileExists(targetPath) {
  try {
    fs.accessSync(targetPath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function discoverPackageRoots(rootPath) {
  const roots = [];

  function walk(currentPath) {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });
    const hasPackageJson = entries.some((entry) => entry.isFile() && entry.name === "package.json");
    if (hasPackageJson) {
      roots.push(currentPath);
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      if (entry.name.startsWith(".") || entry.name === "node_modules") {
        continue;
      }
      walk(path.join(currentPath, entry.name));
    }
  }

  walk(rootPath);
  return roots.sort((left, right) => left.localeCompare(right));
}

function normalizeExportKeys(exportsField) {
  if (!exportsField || typeof exportsField !== "object" || Array.isArray(exportsField)) {
    return new Set();
  }
  return new Set(Object.keys(exportsField));
}

function getPackageRuntimeStatus(packageRoot) {
  const packageJsonPath = path.join(packageRoot, "package.json");
  const packageJson = readJson(packageJsonPath);
  const packageName = String(packageJson.name || "").trim();
  if (!packageName.startsWith("@jskit-ai/")) {
    return null;
  }

  const missingRuntimeDirs = [];
  for (const runtimeDir of EXPECTED_RUNTIME_DIRS) {
    const runtimeDirPath = path.join(packageRoot, "src", runtimeDir);
    if (!fileExists(runtimeDirPath)) {
      missingRuntimeDirs.push(`src/${runtimeDir}`);
    }
  }

  const exportKeys = normalizeExportKeys(packageJson.exports);
  const missingRuntimeExports = [];
  for (const runtimeDir of EXPECTED_RUNTIME_DIRS) {
    const wildcardKey = `./${runtimeDir}/*`;
    const flatKey = `./${runtimeDir}`;
    if (!exportKeys.has(wildcardKey) && !exportKeys.has(flatKey)) {
      missingRuntimeExports.push(wildcardKey);
    }
  }

  return {
    packageName,
    packageRoot: toPosix(path.relative(REPO_ROOT, packageRoot)),
    missingRuntimeDirs,
    missingRuntimeExports
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2), { json: true });
  const statuses = discoverPackageRoots(PACKAGES_ROOT)
    .map((packageRoot) => getPackageRuntimeStatus(packageRoot))
    .filter(Boolean);

  const failing = statuses.filter(
    (status) => status.missingRuntimeDirs.length > 0 || status.missingRuntimeExports.length > 0
  );

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          strict: options.strict,
          packages: statuses.length,
          failing: failing.length,
          statuses
        },
        null,
        2
      )}\n`
    );
  } else {
    process.stdout.write(`runtime-layout: scanned ${statuses.length} framework packages\n`);
    process.stdout.write(`runtime-layout: packages with gaps ${failing.length}\n`);
    for (const status of failing) {
      const details = [];
      if (status.missingRuntimeDirs.length > 0) {
        details.push(`missing dirs: ${status.missingRuntimeDirs.join(", ")}`);
      }
      if (status.missingRuntimeExports.length > 0) {
        details.push(`missing exports: ${status.missingRuntimeExports.join(", ")}`);
      }
      process.stdout.write(`- ${status.packageName} (${status.packageRoot}) -> ${details.join(" | ")}\n`);
    }
  }

  if (options.strict && failing.length > 0) {
    process.exitCode = 1;
  }
}

main();
