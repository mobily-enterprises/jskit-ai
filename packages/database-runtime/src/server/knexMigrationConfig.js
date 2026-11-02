import path from "node:path";
import { access } from "node:fs/promises";
import { discoverInstalledPackages } from "@jskit-ai/kernel/server/support";
import {
  normalizeDatabaseClient,
  toKnexClientId
} from "../shared/databaseClient.js";
import { resolveKnexConnectionFromEnvironment } from "../shared/databaseConnection.js";

/**
 * The Knex configuration for migrating the database the application's environment names.
 * @param {object} options
 * @param {string} options.client The dialect id: "mysql2" or "pg".
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} options.environment The application's environment, such as `process.env`.
 * @param {string} [options.appRoot]
 * @param {string} [options.migrationsDirectory]
 * @param {readonly string[]} [options.packageMigrationDirectories]
 * @param {readonly string[]} [options.packageConstraintDirectories]
 */
function createKnexMigrationConfig({
  client,
  environment,
  appRoot = process.cwd(),
  migrationsDirectory = "migrations",
  // readable-check: allow dependency-default - data: a list of directory paths, not a collaborator
  packageMigrationDirectories = [],
  // readable-check: allow dependency-default - data: a list of directory paths, not a collaborator
  packageConstraintDirectories = []
}) {
  if (!environment) {
    throw new TypeError("createKnexMigrationConfig requires the application's environment, such as process.env.");
  }
  const dialectId = normalizeDatabaseClient(client);
  const resolvedMigrationsDirectory = path.resolve(appRoot, migrationsDirectory);

  return {
    client: toKnexClientId(dialectId),
    connection: resolveKnexConnectionFromEnvironment(environment, {
      client: dialectId,
      defaultPort: dialectId === "pg" ? 5432 : 3306,
      context: "knex migrations"
    }),
    migrations: {
      // Packages create the tables application migrations build on; package constraints
      // can then reference application tables such as users.
      directory: [
        ...packageMigrationDirectories.map((directory) => path.resolve(directory)),
        resolvedMigrationsDirectory,
        ...packageConstraintDirectories.map((directory) => path.resolve(directory)),
        path.join(resolvedMigrationsDirectory, "constraints")
      ],
      extension: "cjs",
      sortDirsSeparately: true
    }
  };
}

async function directoryExists(directory) {
  try {
    await access(directory);
    return true;
  } catch {
    return false;
  }
}

/**
 * A package's `jskit.migrations.after`: the installed JSKIT packages whose
 * migrations its own follow, or none.
 * @param {{ packageId: string, packageMetadata: Record<string, any> }} installedPackage
 * @param {ReadonlySet<string>} installedPackageIds
 */
function migrationsAfterOf({ packageId, packageMetadata }, installedPackageIds) {
  const { directories, after: declared } = packageMetadata.migrations ?? {};
  if (declared === undefined) {
    return [];
  }
  if (directories === undefined) {
    throw new TypeError(`${packageId} package.json#jskit.migrations.after needs jskit.migrations.directories.`);
  }
  if (!Array.isArray(declared) || declared.some((entry) => typeof entry !== "string" || !entry.trim())) {
    throw new TypeError(`${packageId} package.json#jskit.migrations.after must be an array of package names.`);
  }
  const after = declared.map((entry) => entry.trim());
  for (const prerequisite of after) {
    if (prerequisite === packageId) {
      throw new TypeError(`${packageId} package.json#jskit.migrations.after names the package itself.`);
    }
    if (!installedPackageIds.has(prerequisite)) {
      throw new Error(
        `${packageId} package.json#jskit.migrations.after names ${prerequisite}, which is not an installed JSKIT package.`
      );
    }
  }
  return after;
}

/**
 * Package migration directories in path order, except that a directory of a
 * package whose `jskit.migrations.after` names other packages runs after all of
 * their directories. With no `after` the path order is unchanged.
 * @param {readonly string[]} directories
 * @param {ReadonlyMap<string, string>} packageIdOf the package that declares each directory
 * @param {ReadonlyMap<string, readonly string[]>} afterOf each package's `after`
 */
function orderPackageMigrationDirectories(directories, packageIdOf, afterOf) {
  const directoriesOf = new Map();
  for (const directory of directories) {
    const packageId = packageIdOf.get(directory);
    directoriesOf.set(packageId, [...(directoriesOf.get(packageId) || []), directory]);
  }
  const ordered = [];
  const states = new Map();

  function visit(directory, ancestry) {
    const packageId = packageIdOf.get(directory);
    if (states.get(directory) === "ordered") {
      return;
    }
    if (states.get(directory) === "visiting") {
      throw new Error(`Package migrations cannot each run after the other: ${[...ancestry, packageId].join(" -> ")}.`);
    }
    states.set(directory, "visiting");
    for (const prerequisite of afterOf.get(packageId) || []) {
      for (const prerequisiteDirectory of directoriesOf.get(prerequisite) || []) {
        visit(prerequisiteDirectory, [...ancestry, packageId]);
      }
    }
    states.set(directory, "ordered");
    ordered.push(directory);
  }

  for (const directory of directories) {
    visit(directory, []);
  }
  return ordered;
}

async function discoverPackageMigrationDirectories({ appRoot = process.cwd() } = {}) {
  const normalizedAppRoot = path.resolve(appRoot);
  const installedPackages = await discoverInstalledPackages({ appRoot: normalizedAppRoot });
  const installedPackageIds = new Set(installedPackages.map(({ packageId }) => packageId));
  const packageIdOf = new Map();
  const afterOf = new Map();

  for (const installedPackage of installedPackages) {
    const declaredDirectories = installedPackage.packageMetadata?.migrations?.directories;
    afterOf.set(installedPackage.packageId, migrationsAfterOf(installedPackage, installedPackageIds));
    if (typeof declaredDirectories === "undefined") {
      continue;
    }
    if (!Array.isArray(declaredDirectories) || declaredDirectories.length < 1) {
      throw new TypeError(
        `${installedPackage.packageId} package.json#jskit.migrations.directories must be a non-empty array.`
      );
    }

    for (const declaredDirectory of declaredDirectories) {
      const relativeDirectory = String(declaredDirectory || "").trim();
      if (
        !relativeDirectory ||
        path.isAbsolute(relativeDirectory) ||
        relativeDirectory === ".." ||
        relativeDirectory.startsWith(`..${path.sep}`)
      ) {
        throw new TypeError(
          `${installedPackage.packageId} declares an invalid package migration directory: ${relativeDirectory || "<empty>"}.`
        );
      }
      const absoluteDirectory = path.resolve(installedPackage.packageRoot, relativeDirectory);
      const relativeToPackage = path.relative(installedPackage.packageRoot, absoluteDirectory);
      if (relativeToPackage.startsWith(`..${path.sep}`) || path.isAbsolute(relativeToPackage)) {
        throw new TypeError(
          `${installedPackage.packageId} package migration directory escapes its package root: ${relativeDirectory}.`
        );
      }
      if (!(await directoryExists(absoluteDirectory))) {
        throw new Error(
          `${installedPackage.packageId} declares a missing package migration directory: ${relativeDirectory}.`
        );
      }
      if (!packageIdOf.has(absoluteDirectory)) {
        packageIdOf.set(absoluteDirectory, installedPackage.packageId);
      }
    }
  }

  const pathOrder = [...packageIdOf.keys()].sort((left, right) => left.localeCompare(right));
  return Object.freeze(orderPackageMigrationDirectories(pathOrder, packageIdOf, afterOf));
}

/**
 * A package's migration directory may hold a constraints/ subdirectory; it runs after the
 * application's migrations/, like the application's own migrations/constraints/.
 * @param {readonly string[]} packageMigrationDirectories
 */
async function packageConstraintDirectoriesOf(packageMigrationDirectories) {
  const directories = [];
  for (const directory of packageMigrationDirectories) {
    const constraintsDirectory = path.join(directory, "constraints");
    if (await directoryExists(constraintsDirectory)) {
      directories.push(constraintsDirectory);
    }
  }
  return Object.freeze(directories);
}

/**
 * The Knex migration configuration of an application: its own migrations and those of every
 * installed JSKIT package that declares some.
 * @param {Omit<Parameters<typeof createKnexMigrationConfig>[0],
 *   "packageMigrationDirectories" | "packageConstraintDirectories">} options
 */
async function createKnexMigrationConfigFromApp(options) {
  const appRoot = path.resolve(options.appRoot || process.cwd());
  const packageMigrationDirectories = await discoverPackageMigrationDirectories({ appRoot });
  return createKnexMigrationConfig({
    ...options,
    appRoot,
    packageMigrationDirectories,
    packageConstraintDirectories: await packageConstraintDirectoriesOf(packageMigrationDirectories)
  });
}

export {
  createKnexMigrationConfig,
  createKnexMigrationConfigFromApp,
  discoverPackageMigrationDirectories
};
