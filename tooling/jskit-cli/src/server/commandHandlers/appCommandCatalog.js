const APP_SCRIPT_WRAPPERS = Object.freeze({
  verify: "jskit app verify && npm run --if-present verify:app",
  "jskit:update": "jskit app update-packages",
  release: "jskit app release"
});

const COPIED_APP_SCRIPT_VALUES = Object.freeze({
  verify: Object.freeze([
    "npm run lint && npm run test && npm run test:client && npm run build && npx jskit doctor"
  ]),
  "jskit:update": Object.freeze([
    "bash ./scripts/update-jskit-packages.sh"
  ]),
  release: Object.freeze([
    "bash ./scripts/release.sh"
  ])
});

const COPIED_APP_SCRIPT_FILES = Object.freeze([
  "scripts/update-jskit-packages.sh",
  "scripts/release.sh"
]);

const APP_COMMAND_DEFINITIONS = Object.freeze({
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
  "verify-ui": Object.freeze({
    name: "verify-ui",
    summary: "Run a targeted Playwright command and write a UI verification receipt for jskit doctor.",
    usage: "jskit app verify-ui --command <shell-command> --feature <label> --auth-mode <mode> [--against <base-ref>]",
    options: Object.freeze([
      Object.freeze({
        label: "--command <shell-command>",
        description: "Targeted UI verification command to run. If it uses Playwright against a local app, the command/environment must start or reuse a reachable app server first."
      }),
      Object.freeze({
        label: "--feature <label>",
        description: "Short human label for the UI feature or flow that was verified."
      }),
      Object.freeze({
        label: "--auth-mode <mode>",
        description: "Auth path used by the Playwright flow: none | dev-auth-login-as | session-bootstrap | custom-local."
      }),
      Object.freeze({
        label: "--against <base-ref>",
        description: "Record changed UI files against a branch, tag, or commit instead of only the current dirty worktree."
      })
    ]),
    defaults: Object.freeze([
      "Requires a git working tree so the receipt can record the currently changed UI files.",
      "Does not start the app server; make --command self-contained for UI tests that need one.",
      "Writes .jskit/verification/ui.json after the command succeeds.",
      "Doctor expects the receipt to match the current dirty UI file set, or the same --against <base-ref> delta when used."
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
      "JSKIT ranges in npm workspace manifests and package descriptors are aligned with the latest major release, then workspace resolutions are refreshed in the lockfile.",
      "Installed packages whose descriptor versions changed are reapplied with their saved options before managed migrations and the composed CI workflow are refreshed.",
      "App-owned files retain local edits through the normal package-update ownership rules."
    ])
  }),
  "sync-ci": Object.freeze({
    name: "sync-ci",
    summary: "Regenerate the JSKIT-managed GitHub verification workflow from installed package contracts.",
    usage: "jskit app sync-ci [--force]",
    options: Object.freeze([
      Object.freeze({
        label: "--force",
        description: "Replace a modified workflow that is already recorded as JSKIT-managed."
      })
    ]),
    defaults: Object.freeze([
      "Recomposes CI requirements from installed package descriptors and records the generated content hash in .jskit/lock.json.",
      "Refuses to replace a modified workflow unless --force is explicit; application-specific CI belongs in a separate workflow.",
      "Never claims an unrecorded jskit-verify.yml or removes a customized legacy verify.yml."
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
  }),
  "adopt-managed-scripts": Object.freeze({
    name: "adopt-managed-scripts",
    summary: "Rewrite copied scaffolded maintenance scripts to the managed jskit app wrappers.",
    usage: "jskit app adopt-managed-scripts [--dry-run] [--force]",
    options: Object.freeze([
      Object.freeze({
        label: "--dry-run",
        description: "Preview the script rewrites without writing package.json."
      }),
      Object.freeze({
        label: "--force",
        description: "Replace customized script values too, and remove copied maintenance scripts if they exist."
      })
    ]),
    defaults: Object.freeze([
      "Known scaffolded script values are rewritten automatically.",
      "Customized script values are reported and left alone unless --force is used.",
      "This command is for apps that still carry copied JSKIT maintenance scripts."
    ])
  }),
  "migrate-source-mutations": Object.freeze({
    name: "migrate-source-mutations",
    summary: "Rewrite legacy append-text source edits into the current source-mutation layout.",
    usage: "jskit app migrate-source-mutations [--dry-run]",
    options: Object.freeze([
      Object.freeze({
        label: "--dry-run",
        description: "Preview source rewrites without writing app files."
      })
    ]),
    defaults: Object.freeze([
      "Moves legacy MainClientProvider component registrations before the MainClientProvider class.",
      "Leaves apps unchanged when they already use the current source-mutation layout.",
      "Run this after updating JSKIT packages in older apps that were installed before source mutations."
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
    definition.name === "adopt-managed-scripts" ||
    definition.name === "migrate-source-mutations" ||
    definition.name === "release"
  ) {
    optionMeta["dry-run"] = { inputType: "flag" };
  }
  if (definition.name === "adopt-managed-scripts") {
    optionMeta.force = { inputType: "flag" };
  }
  if (definition.name === "sync-ci") {
    optionMeta.force = { inputType: "flag" };
  }
  if (definition.name === "update-packages" || definition.name === "release") {
    optionMeta.registry = { inputType: "text" };
  }
  if (definition.name === "verify" || definition.name === "verify-ui") {
    optionMeta.against = { inputType: "text" };
  }
  if (definition.name === "verify-ui") {
    optionMeta.command = { inputType: "text" };
    optionMeta.feature = { inputType: "text" };
    optionMeta["auth-mode"] = { inputType: "text" };
  }
  return optionMeta;
}

export {
  APP_SCRIPT_WRAPPERS,
  COPIED_APP_SCRIPT_VALUES,
  COPIED_APP_SCRIPT_FILES,
  APP_COMMAND_DEFINITIONS,
  listAppCommandDefinitions,
  resolveAppCommandDefinition,
  buildAppCommandOptionMeta
};
