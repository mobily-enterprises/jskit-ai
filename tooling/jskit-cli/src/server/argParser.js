const KNOWN_COMMANDS = new Set([
  "help",
  "create",
  "generate",
  "list",
  "show",
  "view",
  "migrations",
  "add",
  "position",
  "update",
  "remove",
  "doctor",
  "lint-descriptors"
]);

const COMMAND_ALIASES = Object.freeze({
  view: "show",
  ls: "list",
  gen: "generate"
});

function resolveCommandAlias(rawCommand) {
  const command = String(rawCommand || "").trim();
  if (!command) {
    return "";
  }
  return COMMAND_ALIASES[command] || command;
}

function parseArgs(argv, { createCliError } = {}) {
  if (typeof createCliError !== "function") {
    throw new TypeError("parseArgs requires createCliError.");
  }

  const args = Array.isArray(argv) ? [...argv] : [];
  const firstToken = String(args[0] || "").trim();
  if (firstToken === "--help" || firstToken === "-h") {
    args.shift();
    return {
      command: "help",
      options: {
        dryRun: false,
        noInstall: false,
        full: false,
        expanded: false,
        details: false,
        debugExports: false,
        checkDiLabels: false,
        verbose: false,
        json: false,
        all: false,
        help: true,
        inlineOptions: {}
      },
      positional: []
    };
  }

  const rawCommand = String(args.shift() || "help").trim() || "help";
  const command = resolveCommandAlias(rawCommand);

  if (!KNOWN_COMMANDS.has(command)) {
    throw createCliError(`Unknown command: ${rawCommand}`, { showUsage: true });
  }

  const options = {
    dryRun: false,
    noInstall: false,
    full: false,
    expanded: false,
    details: false,
    debugExports: false,
    checkDiLabels: false,
    verbose: false,
    json: false,
    all: false,
    help: false,
    inlineOptions: {}
  };
  const positional = [];

  while (args.length > 0) {
    const token = String(args.shift() || "");

    if (token === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (token === "--no-install") {
      options.noInstall = true;
      continue;
    }
    if (token === "--full") {
      options.full = true;
      continue;
    }
    if (token === "--expanded") {
      options.expanded = true;
      continue;
    }
    if (token === "--details") {
      options.details = true;
      continue;
    }
    if (token === "--debug-exports") {
      options.debugExports = true;
      continue;
    }
    if (token === "--check-di-labels") {
      options.checkDiLabels = true;
      continue;
    }
    if (token === "--verbose") {
      options.verbose = true;
      continue;
    }
    if (token === "--json") {
      options.json = true;
      continue;
    }
    if (token === "--all") {
      options.all = true;
      continue;
    }
    if (token === "--help" || token === "-h") {
      options.help = true;
      continue;
    }

    if (token.startsWith("--")) {
      const withoutPrefix = token.slice(2);
      const hasInlineValue = withoutPrefix.includes("=");
      const optionName = hasInlineValue ? withoutPrefix.slice(0, withoutPrefix.indexOf("=")) : withoutPrefix;
      const optionValueRaw = hasInlineValue
        ? withoutPrefix.slice(withoutPrefix.indexOf("=") + 1)
        : args.shift();

      if (!/^[a-z][a-z0-9-]*$/.test(optionName)) {
        throw createCliError(`Unknown option: ${token}`, { showUsage: true });
      }
      if (typeof optionValueRaw !== "string") {
        throw createCliError(`--${optionName} requires a value.`, { showUsage: true });
      }
      const optionValue = optionValueRaw.trim();
      if (!hasInlineValue && optionValue.startsWith("-")) {
        throw createCliError(`--${optionName} requires a value.`, { showUsage: true });
      }

      options.inlineOptions[optionName] = optionValue;
      continue;
    }

    if (token.startsWith("-")) {
      throw createCliError(`Unknown option: ${token}`, { showUsage: true });
    }

    positional.push(token);
  }

  if (options.debugExports) {
    options.details = true;
  }

  return {
    command,
    options,
    positional
  };
}

function printUsage(stream = process.stderr) {
  stream.write("Usage: jskit <command> [options]\n\n");
  stream.write("Commands:\n");
  stream.write("  create package <name>        Scaffold app-local package under packages/ and install it\n");
  stream.write("  list [bundles [all]|packages|generators|placements] List bundles/packages/generators or app placement targets\n");
  stream.write("  lint-descriptors             Validate bundle/package descriptor files\n");
  stream.write("  add bundle <bundleId>        Add one bundle (bundle is a package shortcut)\n");
  stream.write("  add package <packageId>      Add one runtime package to current app (catalog/app-local/installed external)\n");
  stream.write("  generate <packageId> [subcommand ...] Run one generator package or generator subcommand\n");
  stream.write("  position element <packageId> Re-apply positioning mutations for one installed package\n");
  stream.write("  show <id>                    Show details for bundle id or package id\n");
  stream.write("  view <id>                    Alias of show <id>\n");
  stream.write("  migrations <scope>           Generate managed migrations only (scope: all | changed | package <packageId>)\n");
  stream.write("  update package <packageId>   Re-apply one installed package\n");
  stream.write("  remove package <packageId>   Remove one installed package\n");
  stream.write("  doctor                       Validate lockfile + managed files\n");
  stream.write("\n");
  stream.write("Options:\n");
  stream.write("  --dry-run                    Print planned changes only\n");
  stream.write("  --no-install                 Skip npm install during create/add/generate/update/remove\n");
  stream.write("  --scope <scope>              (create package) override generated package scope\n");
  stream.write("  --package-id <id>            (create package) explicit @scope/name package id\n");
  stream.write("  --description <text>         (create package) descriptor description text\n");
  stream.write("  --full                       Show bundle package ids (declared packages)\n");
  stream.write("  --expanded                   Show expanded/transitive package ids\n");
  stream.write("  --details                    Show extra capability detail in show output\n");
  stream.write("  --debug-exports              Show export provenance/re-export source details in show output\n");
  stream.write("  --check-di-labels            (lint-descriptors) verify DI labels used by providers match descriptor container tokens\n");
  stream.write("  --verbose                    Show verbose informational diagnostics\n");
  stream.write("  --<option> <value>           Package option (for packages requiring input)\n");
  stream.write("  --json                       Print structured output\n");
  stream.write("  -h, --help                   Show help\n");
}

export { parseArgs, printUsage };
