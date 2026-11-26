import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileExists, toPosixPath } from "./files.mjs";
import { readJsonRecord } from "./project-manifests.mjs";

// The package migrations a JSKIT update installs, which the app must run before the new packages serve requests.

const JSKIT_SCOPE_PREFIX = "@jskit-ai/";

// The @jskit-ai packages installed in node_modules, each with its version and the migration files it ships
// (jskit.migrations.directories and their constraints/), each by its path in the package, as the app's migrations
// read them from node_modules.
async function installedPackageMigrations(root) {
  const scope = path.join(root, "node_modules", JSKIT_SCOPE_PREFIX);
  const names = await readdir(scope).catch((error) => {
    if (error?.code === "ENOENT") return [];
    throw error;
  });
  const installed = new Map();
  for (const name of names) {
    const packageRoot = path.join(scope, name);
    const manifestPath = path.join(packageRoot, "package.json");
    if (!(await fileExists(manifestPath))) continue;
    const manifest = (await readJsonRecord(manifestPath)).value;
    const directories = manifest.jskit?.migrations?.directories;
    const migrations = new Set();
    for (const directory of Array.isArray(directories) ? directories : []) {
      for (const folder of [directory, path.join(directory, "constraints")]) {
        const files = await readdir(path.join(packageRoot, folder)).catch(() => []);
        for (const file of files.filter((entry) => entry.endsWith(".cjs"))) {
          migrations.add(toPosixPath(path.join(folder, file)));
        }
      }
    }
    installed.set(`${JSKIT_SCOPE_PREFIX}${name}`, { version: String(manifest.version || ""), migrations });
  }
  return installed;
}

// The package migrations an update added: the files its installed packages ship that the app's previous packages did
// not. A package node_modules held before is compared file by file. One it did not hold (a fresh checkout or worktree,
// never installed) is compared through its version in the previous package-lock.json (previousVersions, by package
// id): at the same version it ships the same files, and one the lock lacks is new to the app, with all its migrations.
// One whose version moved has earlier files that are nowhere on disk, so it is uncompared: none of its migrations are
// counted as new.
function packageMigrationChanges(before, after, previousVersions) {
  const addedMigrations = [];
  const uncomparedPackages = [];
  for (const [packageId, { version, migrations }] of after) {
    const previous = before.get(packageId);
    const previousVersion = previousVersions.get(packageId);
    if (previous) {
      addedMigrations.push(...[...migrations].filter((file) => !previous.migrations.has(file))
        .map((file) => `${packageId}: ${file}`));
    } else if (previousVersion === undefined) {
      addedMigrations.push(...[...migrations].map((file) => `${packageId}: ${file}`));
    } else if (previousVersion !== version && migrations.size > 0) {
      uncomparedPackages.push(Object.freeze({ packageId, previousVersion, version }));
    }
  }
  return {
    addedMigrations: addedMigrations.sort(),
    uncomparedPackages: uncomparedPackages.sort((left, right) => left.packageId.localeCompare(right.packageId))
  };
}

export { installedPackageMigrations, packageMigrationChanges };
