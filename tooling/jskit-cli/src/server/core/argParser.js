import { isKnownCommandName, resolveCommandAlias } from "./commandCatalog.js";

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
        runNpmInstall: false,
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

  if (!isKnownCommandName(command)) {
    throw createCliError(`Unknown command: ${rawCommand}`, { showUsage: true });
  }

  const options = {
    dryRun: false,
    runNpmInstall: false,
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
  const allowLooseInlineOptionParsing = command === "generate";

  while (args.length > 0) {
    const token = String(args.shift() || "");

    if (token === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (token === "--run-npm-install") {
      options.runNpmInstall = true;
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
    if (token === "--force") {
      options.inlineOptions.force = "true";
      continue;
    }

    if (token.startsWith("--")) {
      const withoutPrefix = token.slice(2);
      const hasInlineValue = withoutPrefix.includes("=");
      const optionName = hasInlineValue ? withoutPrefix.slice(0, withoutPrefix.indexOf("=")) : withoutPrefix;
      const optionNamePattern = allowLooseInlineOptionParsing
        ? /^[A-Za-z][A-Za-z0-9_-]*$/
        : /^[a-z][a-z0-9-]*$/;
      if (!optionNamePattern.test(optionName)) {
        throw createCliError(`Unknown option: ${token}`, { showUsage: true });
      }

      let optionValueRaw;
      if (hasInlineValue) {
        optionValueRaw = withoutPrefix.slice(withoutPrefix.indexOf("=") + 1);
      } else {
        const hasNextStringToken = typeof args[0] === "string";
        const nextToken = hasNextStringToken ? String(args[0]) : "";
        if (hasNextStringToken && !nextToken.startsWith("-")) {
          optionValueRaw = args.shift();
        }
      }

      if (!allowLooseInlineOptionParsing && typeof optionValueRaw !== "string") {
        throw createCliError(`--${optionName} requires a value.`, { showUsage: true });
      }
      if (typeof optionValueRaw === "string") {
        const optionValue = optionValueRaw.trim();
        if (!hasInlineValue && optionValue.startsWith("-")) {
          throw createCliError(`--${optionName} requires a value.`, { showUsage: true });
        }
        options.inlineOptions[optionName] = optionValue;
        continue;
      }

      options.inlineOptions[optionName] = undefined;
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

export { parseArgs };
