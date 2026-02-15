const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.resolve(__dirname, ".env") });
dotenv.config({
  path: path.resolve(__dirname, ".env.local"),
  override: false
});

function toPositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }
  return fallback;
}

function toStringOrFallback(value, fallback) {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

const dbHost = toStringOrFallback(process.env.DB_HOST, "127.0.0.1");
const dbPort = toPositiveInteger(process.env.DB_PORT, 3306);
const dbUser = toStringOrFallback(process.env.DB_USER, "annuity_app");
const dbPassword = String(process.env.DB_PASSWORD ?? "");
const dbName = toStringOrFallback(process.env.DB_NAME, "material-app");
const dbTestName = toStringOrFallback(process.env.DB_TEST_NAME, `${dbName}_test`);
const dbPoolMax = toPositiveInteger(process.env.DB_POOL_MAX, 10);

const sharedConfig = {
  client: "mysql2",
  connection: {
    host: dbHost,
    port: dbPort,
    user: dbUser,
    password: dbPassword,
    database: dbName,
    timezone: "Z"
  },
  pool: {
    min: 0,
    max: dbPoolMax
  },
  migrations: {
    directory: path.join(__dirname, "migrations"),
    tableName: "knex_migrations",
    loadExtensions: [".cjs"]
  },
  seeds: {
    directory: path.join(__dirname, "seeds"),
    loadExtensions: [".cjs"]
  }
};

module.exports = {
  development: sharedConfig,
  test: {
    ...sharedConfig,
    connection: {
      ...sharedConfig.connection,
      database: dbTestName
    },
    pool: {
      min: 0,
      max: Math.min(dbPoolMax, 2)
    }
  },
  production: {
    ...sharedConfig,
    pool: {
      min: 2,
      max: Math.max(2, toPositiveInteger(process.env.DB_POOL_MAX, 20))
    }
  }
};
