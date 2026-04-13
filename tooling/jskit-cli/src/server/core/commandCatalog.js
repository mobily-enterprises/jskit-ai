const OPTION_FLAG_LABELS = Object.freeze({
  dryRun: "--dry-run",
  runNpmInstall: "--run-npm-install",
  full: "--full",
  expanded: "--expanded",
  details: "--details",
  debugExports: "--debug-exports",
  checkDiLabels: "--check-di-labels",
  verbose: "--verbose",
  json: "--json",
  all: "--all"
});

const PARSED_BOOLEAN_OPTION_KEYS = Object.freeze(Object.keys(OPTION_FLAG_LABELS));

function isHelpToken(value = "") {
  return String(value || "").trim().toLowerCase() === "help";
}

function canDelegateAddInlineOptions(positional = []) {
  const [first, second, third] = Array.isArray(positional) ? positional : [];
  const targetType = String(first || "").trim();
  const targetId = String(second || "").trim();
  if (!targetType || !targetId || isHelpToken(targetId) || isHelpToken(third)) {
    return false;
  }
  return targetType === "package" || targetType === "bundle";
}

function canDelegateGenerateInlineOptions(positional = []) {
  const normalizedPositionals = Array.isArray(positional) ? positional : [];
  const first = String(normalizedPositionals[0] || "").trim();
  const last = String(normalizedPositionals[normalizedPositionals.length - 1] || "").trim();
  if (!first || isHelpToken(first) || isHelpToken(last)) {
    return false;
  }
  return true;
}

function canDelegateMigrationsInlineOptions(positional = []) {
  const [first, second] = Array.isArray(positional) ? positional : [];
  return String(first || "").trim().toLowerCase() === "package" && Boolean(String(second || "").trim());
}

function canDelegatePackageTargetInlineOptions(positional = [], expectedTargetType = "") {
  const [first, second] = Array.isArray(positional) ? positional : [];
  const targetType = String(first || "").trim();
  const targetId = String(second || "").trim();
  if (!targetType || !targetId || isHelpToken(targetId)) {
    return false;
  }
  return targetType === String(expectedTargetType || "").trim();
}

const COMMAND_DESCRIPTORS = Object.freeze({
  help: Object.freeze({
    command: "help",
    aliases: Object.freeze([]),
    showInOverview: false,
    summary: "Show command-specific usage.",
    minimalUse: "jskit help [command]",
    parameters: Object.freeze([
      Object.freeze({
        name: "[command]",
        description: "Optional command name to inspect."
      })
    ]),
    defaults: Object.freeze([
      "Without a command, help prints the top-level overview.",
      "Use jskit help <command> for command-specific usage."
    ]),
    fullUse: "jskit help [command]",
    showHelpOnBareInvocation: false,
    handlerName: "",
    allowedFlagKeys: Object.freeze([]),
    inlineOptionMode: "none",
    allowedValueOptionNames: Object.freeze([])
  }),
  create: Object.freeze({
    command: "create",
    aliases: Object.freeze([]),
    showInOverview: true,
    summary: "Scaffold an app-local runtime package.",
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
    fullUse:
      "jskit create package <name> [--scope <scope>] [--package-id <id>] [--description <text>] [--dry-run] [--run-npm-install] [--json]",
    showHelpOnBareInvocation: true,
    handlerName: "commandCreate",
    allowedFlagKeys: Object.freeze(["dryRun", "runNpmInstall", "json"]),
    inlineOptionMode: "enumerated",
    allowedValueOptionNames: Object.freeze(["scope", "package-id", "description"])
  }),
  add: Object.freeze({
    command: "add",
    aliases: Object.freeze([]),
    showInOverview: true,
    summary: "Install a runtime bundle or package into the current app.",
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
    fullUse:
      "jskit add <package|bundle> <id> [--<option> <value>...] [--dry-run] [--run-npm-install] [--json] [--verbose]",
    showHelpOnBareInvocation: false,
    handlerName: "commandAdd",
    allowedFlagKeys: Object.freeze(["dryRun", "runNpmInstall", "json", "verbose"]),
    inlineOptionMode: "delegate",
    allowedValueOptionNames: Object.freeze([]),
    canDelegateInlineOptions: canDelegateAddInlineOptions
  }),
  generate: Object.freeze({
    command: "generate",
    aliases: Object.freeze(["gen"]),
    showInOverview: true,
    summary: "Run a generator package (or generator subcommand).",
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
      "Running with only <generatorId> shows generator help.",
      "Use jskit generate <generatorId> <subcommand> help for subcommand-specific usage."
    ]),
    examples: Object.freeze([
      Object.freeze({
        label: "Common usage",
        lines: Object.freeze([
          "npx jskit generate ui-generator page \\",
          "  admin/reports/index.vue"
        ])
      }),
      Object.freeze({
        label: "More advanced usage",
        lines: Object.freeze([
          "npx jskit generate crud-ui-generator crud \\",
          "  admin/catalog/index/products \\",
          "  --resource-file packages/products/src/shared/productResource.js"
        ])
      })
    ]),
    fullUse:
      "jskit generate <generatorId> [subcommand] [subcommand args...] [--<option> <value>...] [--dry-run] [--run-npm-install] [--json] [--verbose]",
    showHelpOnBareInvocation: false,
    handlerName: "commandGenerate",
    allowedFlagKeys: Object.freeze(["dryRun", "runNpmInstall", "json", "verbose"]),
    inlineOptionMode: "delegate",
    allowedValueOptionNames: Object.freeze([]),
    canDelegateInlineOptions: canDelegateGenerateInlineOptions
  }),
  list: Object.freeze({
    command: "list",
    aliases: Object.freeze(["ls"]),
    showInOverview: true,
    summary: "List bundles, runtime packages, or generator packages.",
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
    fullUse: "jskit list [bundles|packages|generators] [--full] [--expanded] [--json]",
    showHelpOnBareInvocation: false,
    handlerName: "commandList",
    allowedFlagKeys: Object.freeze(["full", "expanded", "json"]),
    inlineOptionMode: "none",
    allowedValueOptionNames: Object.freeze([])
  }),
  "list-placements": Object.freeze({
    command: "list-placements",
    aliases: Object.freeze(["lp"]),
    showInOverview: true,
    summary: "List discovered UI placement targets.",
    minimalUse: "jskit list-placements",
    parameters: Object.freeze([]),
    defaults: Object.freeze([
      "Discovers placement outlets from app Vue ShellOutlet tags and route meta.",
      "Includes placement outlets contributed by installed package metadata.",
      "Shows plain text by default; use --json for structured output."
    ]),
    fullUse: "jskit list-placements [--json]",
    showHelpOnBareInvocation: false,
    handlerName: "commandListPlacements",
    allowedFlagKeys: Object.freeze(["json"]),
    inlineOptionMode: "none",
    allowedValueOptionNames: Object.freeze([])
  }),
  "list-component-tokens": Object.freeze({
    command: "list-component-tokens",
    aliases: Object.freeze(["lct", "list-link-items", "lpct", "list-placement-component-tokens"]),
    showInOverview: true,
    summary: "List available placement component tokens.",
    minimalUse: "jskit list-component-tokens",
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
    fullUse: "jskit list-component-tokens [--prefix <value>] [--all] [--json]",
    showHelpOnBareInvocation: false,
    handlerName: "commandListLinkItems",
    allowedFlagKeys: Object.freeze(["json", "all"]),
    inlineOptionMode: "enumerated",
    allowedValueOptionNames: Object.freeze(["prefix"])
  }),
  show: Object.freeze({
    command: "show",
    aliases: Object.freeze(["view"]),
    showInOverview: true,
    summary: "Show detailed metadata for a bundle or package.",
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
    fullUse: "jskit show <id> [--details] [--debug-exports] [--json]",
    showHelpOnBareInvocation: true,
    handlerName: "commandShow",
    allowedFlagKeys: Object.freeze(["details", "debugExports", "json"]),
    inlineOptionMode: "none",
    allowedValueOptionNames: Object.freeze([])
  }),
  migrations: Object.freeze({
    command: "migrations",
    aliases: Object.freeze([]),
    showInOverview: true,
    summary: "Generate managed migration files only.",
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
      "Inline options are accepted only for 'migrations package <packageId>'.",
      "This command only materializes managed migration files; it does not run npm install.",
      "Without --json, output lists touched migration files."
    ]),
    fullUse: "jskit migrations <all|changed|package> [packageId] [--<option> <value>...] [--dry-run] [--json] [--verbose]",
    showHelpOnBareInvocation: true,
    handlerName: "commandMigrations",
    allowedFlagKeys: Object.freeze(["dryRun", "json", "verbose"]),
    inlineOptionMode: "delegate",
    allowedValueOptionNames: Object.freeze([]),
    canDelegateInlineOptions: canDelegateMigrationsInlineOptions
  }),
  position: Object.freeze({
    command: "position",
    aliases: Object.freeze([]),
    showInOverview: true,
    summary: "Re-apply positioning-only mutations for an installed package.",
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
      "This command does not run npm install.",
      "Reads current options from lock unless overridden inline."
    ]),
    fullUse: "jskit position element <packageId> [--<option> <value>...] [--dry-run] [--json]",
    showHelpOnBareInvocation: true,
    handlerName: "commandPosition",
    allowedFlagKeys: Object.freeze(["dryRun", "json"]),
    inlineOptionMode: "delegate",
    allowedValueOptionNames: Object.freeze([]),
    canDelegateInlineOptions: (positional = []) => canDelegatePackageTargetInlineOptions(positional, "element")
  }),
  update: Object.freeze({
    command: "update",
    aliases: Object.freeze([]),
    showInOverview: true,
    summary: "Re-apply one installed package.",
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
    fullUse: "jskit update package <packageId> [--<option> <value>...] [--dry-run] [--run-npm-install] [--json]",
    showHelpOnBareInvocation: true,
    handlerName: "commandUpdate",
    allowedFlagKeys: Object.freeze(["dryRun", "runNpmInstall", "json"]),
    inlineOptionMode: "delegate",
    allowedValueOptionNames: Object.freeze([]),
    canDelegateInlineOptions: (positional = []) => canDelegatePackageTargetInlineOptions(positional, "package")
  }),
  remove: Object.freeze({
    command: "remove",
    aliases: Object.freeze([]),
    showInOverview: true,
    summary: "Remove one installed package.",
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
    fullUse: "jskit remove package <packageId> [--dry-run] [--run-npm-install] [--json]",
    showHelpOnBareInvocation: true,
    handlerName: "commandRemove",
    allowedFlagKeys: Object.freeze(["dryRun", "runNpmInstall", "json"]),
    inlineOptionMode: "none",
    allowedValueOptionNames: Object.freeze([])
  }),
  doctor: Object.freeze({
    command: "doctor",
    aliases: Object.freeze([]),
    showInOverview: true,
    summary: "Validate lockfile and managed-file integrity.",
    minimalUse: "jskit doctor",
    parameters: Object.freeze([]),
    defaults: Object.freeze([
      "Validates lock entries, managed files, and registry visibility.",
      "Reports issues as plain text by default.",
      "Use --json for machine-readable diagnostics."
    ]),
    fullUse: "jskit doctor [--json]",
    showHelpOnBareInvocation: false,
    handlerName: "commandDoctor",
    allowedFlagKeys: Object.freeze(["json"]),
    inlineOptionMode: "none",
    allowedValueOptionNames: Object.freeze([])
  }),
  "lint-descriptors": Object.freeze({
    command: "lint-descriptors",
    aliases: Object.freeze([]),
    showInOverview: true,
    summary: "Validate bundle and package descriptor contracts.",
    minimalUse: "jskit lint-descriptors",
    parameters: Object.freeze([]),
    defaults: Object.freeze([
      "Runs descriptor consistency checks.",
      "check-di-labels is optional and adds stricter DI token label checks.",
      "Outputs plain text by default and supports --json."
    ]),
    fullUse: "jskit lint-descriptors [--check-di-labels] [--json]",
    showHelpOnBareInvocation: false,
    handlerName: "commandLintDescriptors",
    allowedFlagKeys: Object.freeze(["checkDiLabels", "json"]),
    inlineOptionMode: "none",
    allowedValueOptionNames: Object.freeze([])
  })
});

const COMMAND_ALIAS_TO_ID = Object.freeze(
  Object.fromEntries(
    Object.values(COMMAND_DESCRIPTORS)
      .flatMap((descriptor) =>
        Array.isArray(descriptor.aliases)
          ? descriptor.aliases.map((alias) => [alias, descriptor.command])
          : [])
      .sort((left, right) => String(left[0] || "").localeCompare(String(right[0] || "")))
  )
);

const COMMAND_IDS = Object.freeze(Object.keys(COMMAND_DESCRIPTORS));
const KNOWN_COMMANDS = new Set(COMMAND_IDS);

function resolveCommandAlias(rawCommand) {
  const command = String(rawCommand || "").trim();
  if (!command) {
    return "";
  }
  return COMMAND_ALIAS_TO_ID[command] || command;
}

function resolveCommandDescriptor(rawCommand) {
  const command = resolveCommandAlias(rawCommand);
  if (!command) {
    return null;
  }
  return COMMAND_DESCRIPTORS[command] || null;
}

function isKnownCommandName(rawCommand) {
  const descriptor = resolveCommandDescriptor(rawCommand);
  return Boolean(descriptor && KNOWN_COMMANDS.has(descriptor.command));
}

function listOverviewCommandDescriptors() {
  return Object.values(COMMAND_DESCRIPTORS)
    .filter((descriptor) => descriptor.showInOverview !== false)
    .sort((left, right) => left.command.localeCompare(right.command));
}

function shouldShowCommandHelpOnBareInvocation(command = "", positional = []) {
  const descriptor = resolveCommandDescriptor(command);
  if (!descriptor || descriptor.showHelpOnBareInvocation !== true) {
    return false;
  }
  const argumentList = Array.isArray(positional) ? positional : [];
  return argumentList.length < 1;
}

function sortOptionLabels(labels = []) {
  return [...new Set((Array.isArray(labels) ? labels : []).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function validateCommandOptions(
  { command = "", positional = [], options = {} } = {},
  { createCliError, renderUsage = null } = {}
) {
  if (typeof createCliError !== "function") {
    throw new TypeError("validateCommandOptions requires createCliError.");
  }

  const descriptor = resolveCommandDescriptor(command);
  if (!descriptor) {
    return;
  }

  const allowedFlagKeys = new Set(Array.isArray(descriptor.allowedFlagKeys) ? descriptor.allowedFlagKeys : []);
  const unsupportedOptionLabels = [];
  for (const flagKey of PARSED_BOOLEAN_OPTION_KEYS) {
    if (options?.[flagKey] !== true) {
      continue;
    }
    if (!allowedFlagKeys.has(flagKey)) {
      unsupportedOptionLabels.push(OPTION_FLAG_LABELS[flagKey]);
    }
  }

  const inlineOptions = options && typeof options === "object" ? options.inlineOptions : null;
  const inlineOptionNames = Object.keys(inlineOptions && typeof inlineOptions === "object" ? inlineOptions : {});
  const inlineOptionMode = String(descriptor.inlineOptionMode || "none").trim().toLowerCase() || "none";
  if (inlineOptionMode === "none") {
    for (const optionName of inlineOptionNames) {
      unsupportedOptionLabels.push(`--${optionName}`);
    }
  } else if (inlineOptionMode === "enumerated") {
    const allowedValueOptionNames = new Set(
      Array.isArray(descriptor.allowedValueOptionNames) ? descriptor.allowedValueOptionNames : []
    );
    for (const optionName of inlineOptionNames) {
      if (!allowedValueOptionNames.has(optionName)) {
        unsupportedOptionLabels.push(`--${optionName}`);
      }
    }
  } else if (
    inlineOptionMode === "delegate" &&
    inlineOptionNames.length > 0 &&
    typeof descriptor.canDelegateInlineOptions === "function" &&
    descriptor.canDelegateInlineOptions(positional) !== true
  ) {
    for (const optionName of inlineOptionNames) {
      unsupportedOptionLabels.push(`--${optionName}`);
    }
  }

  const normalizedUnsupportedLabels = sortOptionLabels(unsupportedOptionLabels);
  if (normalizedUnsupportedLabels.length < 1) {
    return;
  }

  throw createCliError(
    `Unknown option${normalizedUnsupportedLabels.length === 1 ? "" : "s"} for command ${descriptor.command}: ${normalizedUnsupportedLabels.join(", ")}.`,
    {
      renderUsage: typeof renderUsage === "function" ? renderUsage : null
    }
  );
}

export {
  COMMAND_IDS,
  OPTION_FLAG_LABELS,
  resolveCommandAlias,
  resolveCommandDescriptor,
  isKnownCommandName,
  listOverviewCommandDescriptors,
  shouldShowCommandHelpOnBareInvocation,
  validateCommandOptions
};
