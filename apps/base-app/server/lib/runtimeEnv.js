function toPort(value, fallback = 3000) {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }
  return fallback;
}

function resolveRuntimeEnv() {
  return {
    PORT: toPort(process.env.PORT, 3000),
    HOST: String(process.env.HOST || "").trim() || "0.0.0.0"
  };
}

export { resolveRuntimeEnv };
