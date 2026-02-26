const KNEX_CLIENT = "pg";

function readEnv(name, fallback = "") {
  const value = String(process.env[name] || "").trim();
  return value || fallback;
}

module.exports = {
  client: KNEX_CLIENT,
  connection: {
    host: readEnv("DB_HOST", "127.0.0.1"),
    port: Number.parseInt(readEnv("DB_PORT", "5432"), 10),
    user: readEnv("DB_USER", "postgres"),
    password: readEnv("DB_PASSWORD", ""),
    database: readEnv("DB_NAME", "app")
  },
  migrations: {
    directory: "./migrations"
  },
  seeds: {
    directory: "./seeds"
  }
};
