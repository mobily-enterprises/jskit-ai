function createCliError(message, { showUsage = false, exitCode = 1 } = {}) {
  const error = new Error(String(message || "Unknown CLI error"));
  error.name = "CliError";
  error.showUsage = Boolean(showUsage);
  error.exitCode = Number.isInteger(exitCode) ? exitCode : 1;
  return error;
}

export { createCliError };
