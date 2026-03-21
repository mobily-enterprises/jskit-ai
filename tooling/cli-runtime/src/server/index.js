import process from "node:process";

function createCliError(message, { showUsage = false, exitCode = 1 } = {}) {
  const error = new Error(String(message || "Unknown CLI error"));
  error.name = "CliError";
  error.showUsage = Boolean(showUsage);
  error.exitCode = Number.isInteger(exitCode) ? exitCode : 1;
  return error;
}

async function runCliEntrypoint(runCli, argv = process.argv.slice(2)) {
  if (typeof runCli !== "function") {
    throw new TypeError("runCliEntrypoint requires a runCli function");
  }

  const exitCode = await runCli(argv);
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

export { createCliError, runCliEntrypoint };
