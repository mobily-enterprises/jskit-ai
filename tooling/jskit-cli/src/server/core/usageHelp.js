import { resolveCommandAlias } from "./commandCatalog.js";

const COMMAND_OVERVIEW = Object.freeze([
  Object.freeze({
    command: "create",
    summary: "Scaffold an app-local runtime package."
  }),
  Object.freeze({
    command: "add",
    summary: "Install a runtime bundle or package into the current app."
  }),
  Object.freeze({
    command: "generate",
    summary: "Run a generator package (or generator subcommand)."
  }),
  Object.freeze({
    command: "list",
    summary: "List bundles, runtime packages, or generator packages."
  }),
  Object.freeze({
    command: "list-placements",
    summary: "List discovered UI placement targets."
  }),
  Object.freeze({
    command: "list-link-items",
    summary: "List available placement link-item component tokens."
  }),
  Object.freeze({
    command: "show",
    summary: "Show detailed metadata for a bundle or package."
  }),
  Object.freeze({
    command: "migrations",
    summary: "Generate managed migration files only."
  }),
  Object.freeze({
    command: "position",
    summary: "Re-apply positioning-only mutations for an installed package."
  }),
  Object.freeze({
    command: "update",
    summary: "Re-apply one installed package."
  }),
  Object.freeze({
    command: "remove",
    summary: "Remove one installed package."
  }),
  Object.freeze({
    command: "doctor",
    summary: "Validate lockfile and managed-file integrity."
  }),
  Object.freeze({
    command: "lint-descriptors",
    summary: "Validate bundle and package descriptor contracts."
  })
]);

const COMMAND_HELP = Object.freeze({
  create: Object.freeze({
    title: "create",
    minimalUse: "jskit create package <name>",
    parameters: Object.freeze([
      Object.freeze({
        name: "<name>",
        description: "Local package slug used to scaffold packages/<name>."
      })
    ]),
    defaults: Object.freeze([
      "No npm install runs unless --run-npm-install is passed.",
      "If --scope is omitted, scope is inferred from app name.",
      "If --package-id is omitted, it is derived from scope + name."
    ]),
    fullUse: "jskit create package <name> [--scope <scope>] [--package-id <id>] [--description <text>] [--dry-run] [--run-npm-install] [--json]"
  }),
  add: Object.freeze({
    title: "add",
    minimalUse: "jskit add package <packageId>",
    parameters: Object.freeze([
      Object.freeze({
        name: "package | bundle",
        description: "Target type. Use package for one runtime package, bundle for a bundle id."
      }),
      Object.freeze({
        name: "<packageId|bundleId>",
        description: "Catalog id or installed node_modules package id."
      })
    ]),
    defaults: Object.freeze([
      "No npm install runs unless --run-npm-install is passed.",
      "Short ids resolve to @jskit-ai/<id> when available.",
      "Running without args lists bundles and runtime packages.",
      "Existing matching version is skipped unless options force reapply."
    ]),
    fullUse: "jskit add <package|bundle> <id> [--<option> <value>...] [--dry-run] [--run-npm-install] [--json] [--verbose]"
  }),
  generate: Object.freeze({
    title: "generate",
    minimalUse: "jskit generate <generatorId>",
    parameters: Object.freeze([
      Object.freeze({
        name: "<generatorId>",
        description: "Generator package id (for example: crud-ui-generator)."
      }),
      Object.freeze({
        name: "[subcommand]",
        description: "Optional generator subcommand (for example: scaffold or scaffold-field)."
      }),
      Object.freeze({
        name: "[subcommand args...]",
        description: "Optional positional args consumed by the chosen subcommand."
      })
    ]),
    defaults: Object.freeze([
      "No npm install runs unless --run-npm-install is passed.",
      "Short ids resolve to @jskit-ai/<id> when available.",
      "Running without args lists available generators.",
      "If no subcommand is provided, the generator primary command runs.",
      "Use jskit generate <generatorId> <subcommand> help for subcommand-specific usage."
    ]),
    fullUse: "jskit generate <generatorId> [subcommand] [subcommand args...] [--<option> <value>...] [--dry-run] [--run-npm-install] [--json] [--verbose]"
  }),
  list: Object.freeze({
    title: "list",
    minimalUse: "jskit list",
    parameters: Object.freeze([
      Object.freeze({
        name: "[mode]",
        description: "Optional mode: bundles, packages, or generators."
      })
    ]),
    defaults: Object.freeze([
      "Without mode, list prints bundles + runtime packages + generators.",
      "placements are listed by the dedicated list-placements command.",
      "--full and --expanded only affect bundle/package listing views."
    ]),
    fullUse: "jskit list [bundles|packages|generators] [--full] [--expanded] [--json]"
  }),
  "list-placements": Object.freeze({
    title: "list-placements",
    minimalUse: "jskit list-placements",
    parameters: Object.freeze([]),
    defaults: Object.freeze([
      "Discovers placement outlets from app Vue ShellOutlet tags and route meta.",
      "Includes placement outlets contributed by installed package metadata.",
      "Shows plain text by default; use --json for structured output."
    ]),
    fullUse: "jskit list-placements [--json]"
  }),
  "list-link-items": Object.freeze({
    title: "list-link-items",
    minimalUse: "jskit list-link-items",
    parameters: Object.freeze([
      Object.freeze({
        name: "[--prefix <value>]",
        description: "Optional token prefix filter (example: local.main. or users.web.shell.)."
      }),
      Object.freeze({
        name: "[--all]",
        description: "Include all discovered tokens (including non-link-item and client container/runtime tokens)."
      })
    ]),
    defaults: Object.freeze([
      "Default output shows link-item tokens only (token names ending with link-item).",
      "Default includes app and installed-package placement-linked token sources.",
      "Use --prefix to narrow quickly (recommended: --prefix local.main.).",
      "Use --all when you want the full discovered token set.",
      "Shows plain text by default; use --json for structured output."
    ]),
    fullUse: "jskit list-link-items [--prefix <value>] [--all] [--json]"
  }),
  show: Object.freeze({
    title: "show",
    minimalUse: "jskit show <id>",
    parameters: Object.freeze([
      Object.freeze({
        name: "<id>",
        description: "Bundle id or package id to inspect."
      })
    ]),
    defaults: Object.freeze([
      "view is an alias of show.",
      "Basic output is compact; --details expands capability and runtime sections.",
      "--debug-exports implies --details."
    ]),
    fullUse: "jskit show <id> [--details] [--debug-exports] [--json]"
  }),
  migrations: Object.freeze({
    title: "migrations",
    minimalUse: "jskit migrations changed",
    parameters: Object.freeze([
      Object.freeze({
        name: "<scope>",
        description: "all | changed | package."
      }),
      Object.freeze({
        name: "[packageId]",
        description: "Required only when scope is package."
      })
    ]),
    defaults: Object.freeze([
      "No npm install runs unless --run-npm-install is passed.",
      "Inline options are accepted only for 'migrations package <packageId>'.",
      "Without --json, output lists touched migration files."
    ]),
    fullUse: "jskit migrations <all|changed|package> [packageId] [--<option> <value>...] [--dry-run] [--json] [--verbose]"
  }),
  position: Object.freeze({
    title: "position",
    minimalUse: "jskit position element <packageId>",
    parameters: Object.freeze([
      Object.freeze({
        name: "element",
        description: "Target type for positioning command."
      }),
      Object.freeze({
        name: "<packageId>",
        description: "Installed package id to re-position."
      })
    ]),
    defaults: Object.freeze([
      "Only positioning mutations are applied.",
      "No npm install runs unless --run-npm-install is passed.",
      "Reads current options from lock unless overridden inline."
    ]),
    fullUse: "jskit position element <packageId> [--<option> <value>...] [--dry-run] [--json]"
  }),
  update: Object.freeze({
    title: "update",
    minimalUse: "jskit update package <packageId>",
    parameters: Object.freeze([
      Object.freeze({
        name: "package",
        description: "Target type for update command."
      }),
      Object.freeze({
        name: "<packageId>",
        description: "Installed package id to re-apply."
      })
    ]),
    defaults: Object.freeze([
      "No npm install runs unless --run-npm-install is passed.",
      "Existing lock options are reused unless overridden inline.",
      "update reuses add package flow with forced reapply."
    ]),
    fullUse: "jskit update package <packageId> [--<option> <value>...] [--dry-run] [--run-npm-install] [--json]"
  }),
  remove: Object.freeze({
    title: "remove",
    minimalUse: "jskit remove package <packageId>",
    parameters: Object.freeze([
      Object.freeze({
        name: "package",
        description: "Target type for remove command."
      }),
      Object.freeze({
        name: "<packageId>",
        description: "Installed package id to remove."
      })
    ]),
    defaults: Object.freeze([
      "No npm install runs unless --run-npm-install is passed.",
      "Managed files and lock entries are removed for the package.",
      "Local package source directories are not deleted."
    ]),
    fullUse: "jskit remove package <packageId> [--dry-run] [--run-npm-install] [--json]"
  }),
  doctor: Object.freeze({
    title: "doctor",
    minimalUse: "jskit doctor",
    parameters: Object.freeze([]),
    defaults: Object.freeze([
      "Validates lock entries, managed files, and registry visibility.",
      "Reports issues as plain text by default.",
      "Use --json for machine-readable diagnostics."
    ]),
    fullUse: "jskit doctor [--json]"
  }),
  "lint-descriptors": Object.freeze({
    title: "lint-descriptors",
    minimalUse: "jskit lint-descriptors",
    parameters: Object.freeze([]),
    defaults: Object.freeze([
      "Runs descriptor consistency checks.",
      "check-di-labels is optional and adds stricter DI token label checks.",
      "Outputs plain text by default and supports --json."
    ]),
    fullUse: "jskit lint-descriptors [--check-di-labels] [--json]"
  })
});

const BARE_COMMAND_HELP = new Set([
  "create",
  "show",
  "migrations",
  "position",
  "update",
  "remove"
]);

function writeLine(stream, line = "") {
  stream.write(`${line}\n`);
}

function printTopLevelHelp(stream = process.stderr) {
  writeLine(stream, "JSKit CLI");
  writeLine(stream, "");
  writeLine(stream, "Use: jskit help <command> for command-specific usage.");
  writeLine(stream, "");
  writeLine(stream, "Available commands:");
  for (const entry of COMMAND_OVERVIEW) {
    writeLine(stream, `  ${entry.command.padEnd(16, " ")} ${entry.summary}`);
  }
  writeLine(stream, "");
  writeLine(stream, "Global flags:");
  writeLine(stream, "  --dry-run --run-npm-install --json --verbose --help");
}

function printCommandHelp(stream = process.stderr, command = "") {
  const resolvedCommand = resolveCommandAlias(command);
  const entry = COMMAND_HELP[resolvedCommand];
  if (!entry) {
    printTopLevelHelp(stream);
    return;
  }

  writeLine(stream, `Command: ${entry.title}`);
  writeLine(stream, "");

  writeLine(stream, "1) Minimal use");
  writeLine(stream, `   ${entry.minimalUse}`);
  if (entry.parameters.length > 0) {
    writeLine(stream, "   Parameters:");
    for (const parameter of entry.parameters) {
      writeLine(stream, `   - ${parameter.name}: ${parameter.description}`);
    }
  }
  writeLine(stream, "");

  writeLine(stream, "2) Defaults");
  for (const defaultLine of entry.defaults) {
    writeLine(stream, `   - ${defaultLine}`);
  }
  writeLine(stream, "");

  writeLine(stream, "3) Full use");
  writeLine(stream, `   ${entry.fullUse}`);
}

function printUsage(stream = process.stderr, { command = "" } = {}) {
  const normalizedCommand = String(command || "").trim();
  if (!normalizedCommand) {
    printTopLevelHelp(stream);
    return;
  }

  printCommandHelp(stream, normalizedCommand);
}

function shouldShowCommandHelpOnBareInvocation(command = "", positional = []) {
  const resolvedCommand = resolveCommandAlias(command);
  const argumentList = Array.isArray(positional) ? positional : [];
  if (!BARE_COMMAND_HELP.has(resolvedCommand)) {
    return false;
  }
  return argumentList.length < 1;
}

export {
  printUsage,
  shouldShowCommandHelpOnBareInvocation
};
