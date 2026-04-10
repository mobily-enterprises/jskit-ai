function createRunCli({
  parseArgs,
  printUsage,
  shouldShowCommandHelpOnBareInvocation,
  validateCommandOptions,
  resolveCommandDescriptor,
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
  if (typeof shouldShowCommandHelpOnBareInvocation !== "function") {
    throw new TypeError("createRunCli requires shouldShowCommandHelpOnBareInvocation.");
  }
  if (typeof validateCommandOptions !== "function") {
    throw new TypeError("createRunCli requires validateCommandOptions.");
  }
  if (typeof resolveCommandDescriptor !== "function") {
    throw new TypeError("createRunCli requires resolveCommandDescriptor.");
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
      validateCommandOptions(
        { command, positional, options },
        {
          createCliError,
          renderUsage: () => {
            const helpCommand = command === "help" ? String(positional[0] || "").trim() : command;
            printUsage(stderr, { command: helpCommand });
          }
        }
      );
      if (options.help || command === "help") {
        const helpCommand = command === "help" ? String(positional[0] || "").trim() : command;
        printUsage(stdout, { command: helpCommand });
        return 0;
      }

      if (shouldShowCommandHelpOnBareInvocation(command, positional)) {
        printUsage(stdout, { command });
        return 0;
      }

      const commandDescriptor = resolveCommandDescriptor(command);
      const handlerName = String(commandDescriptor?.handlerName || "").trim();
      if (handlerName) {
        const commandHandler = commandHandlers[handlerName];
        if (typeof commandHandler !== "function") {
          throw createCliError(`Unhandled command: ${command}`, { showUsage: true });
        }
        return await commandHandler({
          positional,
          options,
          cwd,
          stdout,
          stderr,
          io: { stdin, stdout, stderr }
        });
      }

      throw createCliError(`Unhandled command: ${command}`, { showUsage: true });
    } catch (error) {
      stderr.write(`jskit: ${error?.message || String(error)}\n`);
      if (typeof error?.renderUsage === "function") {
        error.renderUsage();
      } else if (error?.showUsage) {
        printUsage(stderr);
      }
      return 1;
    } finally {
      await cleanupMaterializedPackageRoots();
    }
  };
}

export { createRunCli };
