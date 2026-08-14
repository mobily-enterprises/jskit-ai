const APP_SCRIPT_WRAPPERS = Object.freeze({
  verify: "jskit app verify && npm run --if-present verify:app",
  "jskit:update": "jskit app update-packages",
  release: "jskit app release"
});

const APP_COMMAND_DEFINITIONS = Object.freeze({
  "preview-identity": Object.freeze({
    name: "preview-identity",
    summary: "Run the app-owned Vibe64 preview-identity command protocol.",
    usage: "jskit app preview-identity",
    options: Object.freeze([]),
    defaults: Object.freeze([
      "Reads one versioned preview-identity request from stdin and writes one JSON response to stdout.",
      "Uses the running local JSKIT app to create a native session for an existing user only.",
      "This machine command is enabled only by the managed development-preview environment."
    ])
  }),
  verify: Object.freeze({
    name: "verify",
    summary: "Run the JSKIT baseline app verification flow.",
    usage: "jskit app verify [--against <base-ref>]",
    options: Object.freeze([
      Object.freeze({
        label: "--against <base-ref>",
        description: "Resolve changed-file checks against a branch, tag, or commit in addition to any local dirty UI files."
      })
    ]),
    defaults: Object.freeze([
      "Runs npm scripts lint, test, test:client, and build only when those scripts are present.",
      "Runs jskit doctor after the normal app checks.",
      "Use --against <base-ref> in CI or PR validation so doctor evaluates changed-file checks against the branch delta too.",
      "The scaffolded npm run verify wrapper can append npm run --if-present verify:app afterwards."
    ])
  }),
  "update-packages": Object.freeze({
    name: "update-packages",
    summary: "Update @jskit-ai dependencies across the app and its npm workspaces.",
    usage: "jskit app update-packages [--registry <url>] [--dry-run]",
    options: Object.freeze([
      Object.freeze({
        label: "--registry <url>",
        description: "Use a custom npm registry when resolving and installing @jskit-ai packages."
      }),
      Object.freeze({
        label: "--dry-run",
        description: "Show the npm install plan without mutating package.json, lockfiles, or migrations."
      })
    ]),
    defaults: Object.freeze([
      "Root runtime, development, optional, and peer dependencies are installed at their exact latest registry versions.",
      "JSKIT dependencies in npm workspace manifests are aligned to exact versions, then package-lock.json is refreshed.",
      "Updates change package versions and deterministic projections only; app-owned scaffolds remain untouched.",
      "The final migration and CI synchronization steps are explicit in command output."
    ])
  }),
  release: Object.freeze({
    name: "release",
    summary: "Run the JSKIT release helper for an app repository.",
    usage: "jskit app release [--registry <url>] [--dry-run]",
    options: Object.freeze([
      Object.freeze({
        label: "--registry <url>",
        description: "Use a custom npm registry for the internal package-refresh step before opening a release PR."
      }),
      Object.freeze({
        label: "--dry-run",
        description: "Preview the release flow without syncing main, updating packages, or opening a PR."
      })
    ]),
    defaults: Object.freeze([
      "Requires a clean worktree, the main branch, git, npm, and gh auth.",
      "Syncs local main, runs jskit app update-packages, commits resulting changes, opens a PR, merges it, then re-syncs local main.",
      "If update-packages produces no changes, release exits without opening a PR."
    ])
  })
});

function listAppCommandDefinitions() {
  return Object.values(APP_COMMAND_DEFINITIONS)
    .sort((left, right) => left.name.localeCompare(right.name));
}

function resolveAppCommandDefinition(rawName = "") {
  const normalizedName = String(rawName || "").trim();
  if (!normalizedName) {
    return null;
  }
  return APP_COMMAND_DEFINITIONS[normalizedName] || null;
}

function buildAppCommandOptionMeta(subcommandName = "") {
  const definition = resolveAppCommandDefinition(subcommandName);
  const optionMeta = {
    help: { inputType: "flag" }
  };

  if (!definition) {
    return optionMeta;
  }

  if (
    definition.name === "update-packages" ||
    definition.name === "release"
  ) {
    optionMeta["dry-run"] = { inputType: "flag" };
  }
  if (definition.name === "update-packages" || definition.name === "release") {
    optionMeta.registry = { inputType: "text" };
  }
  if (definition.name === "verify") {
    optionMeta.against = { inputType: "text" };
  }
  return optionMeta;
}

export {
  APP_SCRIPT_WRAPPERS,
  APP_COMMAND_DEFINITIONS,
  listAppCommandDefinitions,
  resolveAppCommandDefinition,
  buildAppCommandOptionMeta
};
