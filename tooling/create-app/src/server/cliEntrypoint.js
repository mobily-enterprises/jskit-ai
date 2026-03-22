import process from "node:process";

function shellQuote(value) {
  const raw = String(value ?? "");
  if (!raw) {
    return "''";
  }
  if (/^[A-Za-z0-9_./:=+,-]+$/.test(raw)) {
    return raw;
  }
  return `'${raw.replace(/'/g, "'\\''")}'`;
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

export { shellQuote, runCliEntrypoint };
