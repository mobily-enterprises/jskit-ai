function normalizeDialect(value) {
  return String(value || "").trim().toLowerCase();
}

function detectDialectFromClient(client) {
  const candidate =
    client?.client?.config?.client ||
    client?.client?.dialect ||
    client?.client?.driverName ||
    client?.client?.constructor?.name ||
    "";

  const normalized = normalizeDialect(candidate);
  if (normalized.includes("postgres") || normalized === "pg") {
    return "postgres";
  }

  if (normalized.includes("mysql") || normalized.includes("maria")) {
    return "mysql";
  }

  return normalized;
}

export { normalizeDialect, detectDialectFromClient };
