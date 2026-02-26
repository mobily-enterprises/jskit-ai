import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const MIGRATION_PATH = path.resolve("docs/framework/MIGRATION_TRACKER.md");

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function collectPackages() {
  const root = path.resolve("packages");
  const domains = await readdir(root, { withFileTypes: true });
  const packages = [];

  for (const domainEntry of domains) {
    if (!domainEntry.isDirectory()) {
      continue;
    }

    const domainPath = path.join(root, domainEntry.name);
    if (await fileExists(path.join(domainPath, "package.json"))) {
      packages.push({ domain: domainEntry.name, name: domainEntry.name });
      continue;
    }

    const children = await readdir(domainPath, { withFileTypes: true });
    for (const child of children) {
      if (!child.isDirectory()) {
        continue;
      }

      if (await fileExists(path.join(domainPath, child.name, "package.json"))) {
        packages.push({ domain: domainEntry.name, name: child.name });
      }
    }
  }

  packages.sort((left, right) => {
    const domainCompare = left.domain.localeCompare(right.domain);
    return domainCompare === 0
      ? left.name.localeCompare(right.name)
      : domainCompare;
  });

  return packages;
}

test("migration tracker covers every package", async () => {
  const content = await readFile(MIGRATION_PATH, "utf8");
  const rows = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && !line.startsWith("| ---") && !line.startsWith("| Domain"));

  const packageIdsInTable = rows.map((row) => {
    const segments = row.split("|").map((segment) => segment.trim());
    return segments[2];
  });

  const packages = await collectPackages();
  assert.strictEqual(
    rows.length,
    packages.length,
    `MIGRATION tracker rows (${rows.length}) must equal package count (${packages.length}).`
  );

  const packagesMissing = packages.filter((pkg) => {
    const expected = `@jskit-ai/${pkg.name}`;
    return !packageIdsInTable.includes(expected);
  });

  assert.deepStrictEqual(
    packagesMissing,
    [],
    `Missing packages from tracker: ${packagesMissing.map((pkg) => pkg.name).join(", ")}`
  );
});
