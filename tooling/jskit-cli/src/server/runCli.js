function createRunCli({
  parseArgs,
  printUsage,
  commandHandlers,
  cleanupMaterializedPackageRoots,
  createCliError
} = {}) {
  if (typeof parseArgs !== "function") {
    throw new TypeError("createRunCli requires parseArgs.");
  }
  if (typeof printUsage !== "function") {
    throw new TypeError("createRunCli requires printUsage.");
  }
  if (!commandHandlers || typeof commandHandlers !== "object") {
    throw new TypeError("createRunCli requires commandHandlers.");
  }
  if (typeof cleanupMaterializedPackageRoots !== "function") {
    throw new TypeError("createRunCli requires cleanupMaterializedPackageRoots.");
  }
  if (typeof createCliError !== "function") {
    throw new TypeError("createRunCli requires createCliError.");
  }

  return async function runCli(argv = process.argv.slice(2), io = {}) {
    const cwd = io.cwd || process.cwd();
    const stdin = io.stdin || process.stdin;
    const stdout = io.stdout || process.stdout;
    const stderr = io.stderr || process.stderr;

    try {
      const { command, options, positional } = parseArgs(argv, { createCliError });
      if (options.help || command === "help") {
        printUsage(stdout);
        return 0;
      }

      if (command === "create") {
        return await commandHandlers.commandCreate({
          positional,
          options,
          cwd,
          io: { stdin, stdout, stderr }
        });
      }
      if (command === "list") {
        return await commandHandlers.commandList({ positional, options, cwd, stdout });
      }
      if (command === "show") {
        return await commandHandlers.commandShow({ positional, options, stdout });
      }
      if (command === "migrations") {
        return await commandHandlers.commandMigrations({
          positional,
          options,
          cwd,
          io: { stdin, stdout, stderr }
        });
      }
      if (command === "add") {
        return await commandHandlers.commandAdd({
          positional,
          options,
          cwd,
          io: { stdin, stdout, stderr }
        });
      }
      if (command === "generate") {
        return await commandHandlers.commandGenerate({
          positional,
          options,
          cwd,
          io: { stdin, stdout, stderr }
        });
      }
      if (command === "position") {
        return await commandHandlers.commandPosition({
          positional,
          options,
          cwd,
          io: { stdin, stdout, stderr }
        });
      }
      if (command === "update") {
        return await commandHandlers.commandUpdate({
          positional,
          options,
          cwd,
          io: { stdin, stdout, stderr }
        });
      }
      if (command === "remove") {
        return await commandHandlers.commandRemove({
          positional,
          options,
          cwd,
          io: { stdin, stdout, stderr }
        });
      }
      if (command === "doctor") {
        return await commandHandlers.commandDoctor({ cwd, options, stdout });
      }
      if (command === "lint-descriptors") {
        return await commandHandlers.commandLintDescriptors({ options, stdout });
      }

      throw createCliError(`Unhandled command: ${command}`, { showUsage: true });
    } catch (error) {
      stderr.write(`jskit: ${error?.message || String(error)}\n`);
      if (error?.showUsage) {
        printUsage(stderr);
      }
      return 1;
    } finally {
      await cleanupMaterializedPackageRoots();
    }
  };
}

export { createRunCli };
