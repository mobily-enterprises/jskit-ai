import path from "node:path";
import { access } from "node:fs/promises";
import { discoverInstalledPackages } from "@jskit-ai/kernel/server/support";
import {
  normalizeDatabaseClient,
  toKnexClientId
} from "../shared/databaseClient.js";
import { resolveKnexConnectionFromEnvironment } from "../shared/databaseConnection.js";

function createKnexMigrationConfig({
  client,
  environment = process.env,
  appRoot = process.cwd(),
  migrationsDirectory = "migrations",
  packageMigrationDirectories = []
} = {}) {
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
      directory: [
        resolvedMigrationsDirectory,
        ...packageMigrationDirectories.map((directory) => path.resolve(directory)),
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

async function discoverPackageMigrationDirectories({ appRoot = process.cwd() } = {}) {
  const normalizedAppRoot = path.resolve(appRoot);
  const directories = [];

  for (const installedPackage of await discoverInstalledPackages({ appRoot: normalizedAppRoot })) {
    const declaredDirectories = installedPackage.packageMetadata?.migrations?.directories;
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
      directories.push(absoluteDirectory);
    }
  }

  return Object.freeze([...new Set(directories)].sort((left, right) => left.localeCompare(right)));
}

async function createKnexMigrationConfigFromApp(options = {}) {
  const appRoot = path.resolve(options.appRoot || process.cwd());
  const packageMigrationDirectories = await discoverPackageMigrationDirectories({ appRoot });
  return createKnexMigrationConfig({
    ...options,
    appRoot,
    packageMigrationDirectories
  });
}

export {
  createKnexMigrationConfig,
  createKnexMigrationConfigFromApp,
  discoverPackageMigrationDirectories
};
