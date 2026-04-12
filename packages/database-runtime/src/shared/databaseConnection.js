import { normalizeDatabaseClient, normalizeText } from "./databaseClient.js";

const DATABASE_URL_PROTOCOL_TO_CLIENT = Object.freeze({
  "mysql:": "mysql2",
  "mysql2:": "mysql2",
  "mariadb:": "mysql2",
  "postgres:": "pg",
  "postgresql:": "pg",
  "pg:": "pg"
});

function toPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(normalizeText(value), 10);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }
  return fallback;
}

function parseDatabaseUrl(databaseUrl, { context = "DATABASE_URL", allowEmpty = false } = {}) {
  const normalized = normalizeText(databaseUrl);
  if (!normalized) {
    if (allowEmpty) {
      return null;
    }
    throw new Error(`${context} is required.`);
  }

  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error(`${context} must be a valid absolute URL.`);
  }

  const databaseName = normalizeText(decodeURIComponent(String(parsed.pathname || "").replace(/^\/+/, "")));
  const user = normalizeText(decodeURIComponent(parsed.username || ""));
  const password = decodeURIComponent(parsed.password || "");

  return Object.freeze({
    protocol: normalizeText(parsed.protocol).toLowerCase(),
    host: normalizeText(parsed.hostname),
    port: toPositiveInteger(parsed.port, 0),
    database: databaseName,
    user,
    password
  });
}

function resolveDatabaseClientFromEnvironment(env = {}, { allowEmpty = false } = {}) {
  const source = env && typeof env === "object" ? env : {};
  const explicitClient = normalizeText(source.DB_CLIENT);
  if (explicitClient) {
    return normalizeDatabaseClient(explicitClient, { allowEmpty });
  }

  const parsedUrl = parseDatabaseUrl(source.DATABASE_URL, { allowEmpty: true });
  const inferredClient = parsedUrl ? DATABASE_URL_PROTOCOL_TO_CLIENT[parsedUrl.protocol] || "" : "";
  if (inferredClient) {
    return normalizeDatabaseClient(inferredClient, { allowEmpty });
  }

  if (allowEmpty) {
    return "";
  }

  if (parsedUrl) {
    throw new Error(
      `Unsupported DATABASE_URL protocol "${parsedUrl.protocol}". Use one of: mysql, mysql2, mariadb, postgres, postgresql, pg.`
    );
  }

  throw new Error("DB_CLIENT is required. Set DB_CLIENT or DATABASE_URL.");
}

function resolveDatabaseConnectionFromEnvironment(
  env = {},
  {
    defaultHost = "localhost",
    defaultPort = 3306,
    context = "database runtime"
  } = {}
) {
  const source = env && typeof env === "object" ? env : {};
  const parsedUrl = parseDatabaseUrl(source.DATABASE_URL, { allowEmpty: true });

  const host = normalizeText(source.DB_HOST) || normalizeText(parsedUrl?.host) || defaultHost;
  const port = toPositiveInteger(source.DB_PORT, parsedUrl?.port || defaultPort);

  const database = normalizeText(source.DB_NAME) || normalizeText(parsedUrl?.database);
  if (!database) {
    throw new Error(`DB_NAME is required for ${context}. Set DB_NAME or DATABASE_URL.`);
  }

  const user = normalizeText(source.DB_USER) || normalizeText(parsedUrl?.user);
  if (!user) {
    throw new Error(`DB_USER is required for ${context}. Set DB_USER or DATABASE_URL.`);
  }

  const hasDbPassword = Object.prototype.hasOwnProperty.call(source, "DB_PASSWORD");
  const password = hasDbPassword ? String(source.DB_PASSWORD ?? "") : String(parsedUrl?.password || "");

  return {
    host,
    port,
    database,
    user,
    password
  };
}

function resolveKnexConnectionFromEnvironment(
  env = {},
  {
    client = "",
    defaultHost = "localhost",
    defaultPort = 3306,
    context = "database runtime"
  } = {}
) {
  const resolvedClient = client
    ? normalizeDatabaseClient(client, { allowEmpty: true })
    : resolveDatabaseClientFromEnvironment(env, { allowEmpty: true });
  const connection = resolveDatabaseConnectionFromEnvironment(env, {
    defaultHost,
    defaultPort,
    context
  });

  if (resolvedClient === "mysql2") {
    return {
      ...connection,
      supportBigNumbers: true,
      bigNumberStrings: true
    };
  }

  return connection;
}

export {
  parseDatabaseUrl,
  resolveDatabaseClientFromEnvironment,
  resolveDatabaseConnectionFromEnvironment,
  resolveKnexConnectionFromEnvironment
};
