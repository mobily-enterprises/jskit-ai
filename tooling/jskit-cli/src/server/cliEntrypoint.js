import process from "node:process";

async function runCliEntrypoint(runCli, argv = process.argv.slice(2)) {
  if (typeof runCli !== "function") {
    throw new TypeError("runCliEntrypoint requires a runCli function");
  }

  const exitCode = await runCli(argv);
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

export { runCliEntrypoint };
