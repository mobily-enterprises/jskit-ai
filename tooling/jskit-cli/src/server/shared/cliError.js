function createCliError(message, { showUsage = false, exitCode = 1, renderUsage = null } = {}) {
  const error = new Error(String(message || "Unknown CLI error"));
  error.name = "CliError";
  error.showUsage = Boolean(showUsage);
  error.exitCode = Number.isInteger(exitCode) ? exitCode : 1;
  error.renderUsage = typeof renderUsage === "function" ? renderUsage : null;
  return error;
}

export { createCliError };
