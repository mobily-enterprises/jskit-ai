import path from "node:path";
import dotenv from "dotenv";
import {
  normalizeText,
  normalizeDatabaseClient,
  toKnexClientId
} from "@jskit-ai/database-runtime/shared/databaseClient";

function resolveRequiredEnvString(env, key) {
  const value = normalizeText(env[key]);
  if (!value) {
    throw new Error(`${key} is required.`);
  }
  return value;
}

function resolvePort(value, fallbackPort) {
  const parsed = Number.parseInt(normalizeText(value), 10);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }
  return fallbackPort;
}

const appRoot = process.cwd();
dotenv.config({
  path: path.join(appRoot, ".env"),
  quiet: true
});

const dialectId = normalizeDatabaseClient(process.env.DB_CLIENT);
const client = toKnexClientId(dialectId);
const defaultPort = dialectId === "pg" ? 5432 : 3306;
const migrationsDirectory = path.resolve(appRoot, normalizeText(process.env.DB_MIGRATIONS_DIR) || "migrations");

export default {
  client,
  connection: {
    host: normalizeText(process.env.DB_HOST) || "localhost",
    port: resolvePort(process.env.DB_PORT, defaultPort),
    database: resolveRequiredEnvString(process.env, "DB_NAME"),
    user: resolveRequiredEnvString(process.env, "DB_USER"),
    password: String(process.env.DB_PASSWORD ?? "")
  },
  migrations: {
    directory: migrationsDirectory,
    extension: "cjs"
  }
};
