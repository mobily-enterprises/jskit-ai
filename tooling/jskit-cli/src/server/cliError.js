function createCliError(message, { showUsage = false } = {}) {
  const error = new Error(String(message || "Unknown CLI error"));
  error.name = "CliError";
  error.showUsage = Boolean(showUsage);
  return error;
}

export { createCliError };
