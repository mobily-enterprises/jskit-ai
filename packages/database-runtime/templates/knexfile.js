import path from "node:path";
import dotenv from "dotenv";
import {
  normalizeText,
  toKnexClientId,
  resolveDatabaseClientFromEnvironment,
  resolveKnexConnectionFromEnvironment
} from "@jskit-ai/database-runtime/shared";

const appRoot = process.cwd();
dotenv.config({
  path: path.join(appRoot, ".env"),
  quiet: true
});

const dialectId = resolveDatabaseClientFromEnvironment(process.env);
const client = toKnexClientId(dialectId);
const defaultPort = dialectId === "pg" ? 5432 : 3306;
const migrationsDirectory = path.resolve(appRoot, normalizeText(process.env.DB_MIGRATIONS_DIR) || "migrations");
const deferredConstraintsDirectory = path.join(migrationsDirectory, "constraints");

export default {
  client,
  connection: resolveKnexConnectionFromEnvironment(process.env, {
    client: dialectId,
    defaultPort,
    context: "knex migrations"
  }),
  migrations: {
    // Run every table-creation migration before deferred constraints. This keeps
    // valid mutual foreign keys rebuildable without disabling database checks.
    directory: [migrationsDirectory, deferredConstraintsDirectory],
    extension: "cjs",
    sortDirsSeparately: true
  }
};
