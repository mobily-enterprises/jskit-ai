const APP_SCRIPT_WRAPPERS = Object.freeze({
  verify: "jskit app verify && npm run --if-present verify:app",
  "jskit:update": "jskit app update-packages",
  devlinks: "jskit app link-local-packages",
  release: "jskit app release"
});

const LEGACY_APP_SCRIPT_VALUES = Object.freeze({
  verify: Object.freeze([
    "npm run lint && npm run test && npm run test:client && npm run build && npx jskit doctor"
  ]),
  "jskit:update": Object.freeze([
    "bash ./scripts/update-jskit-packages.sh"
  ]),
  devlinks: Object.freeze([
    "bash ./scripts/link-local-jskit-packages.sh"
  ]),
  release: Object.freeze([
    "bash ./scripts/release.sh"
  ])
});

const LEGACY_APP_SCRIPT_FILES = Object.freeze([
  "scripts/update-jskit-packages.sh",
  "scripts/link-local-jskit-packages.sh",
  "scripts/release.sh"
]);

const APP_COMMAND_DEFINITIONS = Object.freeze({
  verify: Object.freeze({
    name: "verify",
    summary: "Run the JSKIT baseline app verification flow.",
    usage: "jskit app verify",
    options: Object.freeze([]),
    defaults: Object.freeze([
      "Runs npm scripts lint, test, test:client, and build only when those scripts are present.",
      "Runs jskit doctor after the normal app checks.",
      "The scaffolded npm run verify wrapper can append npm run --if-present verify:app afterwards."
    ])
  }),
  "verify-ui": Object.freeze({
    name: "verify-ui",
    summary: "Run a targeted Playwright command and write a UI verification receipt for jskit doctor.",
    usage: "jskit app verify-ui --command <shell-command> --feature <label> --auth-mode <mode>",
    options: Object.freeze([
      Object.freeze({
        label: "--command <shell-command>",
        description: "Targeted Playwright command to run, for example: npx playwright test tests/e2e/contacts.spec.ts -g filters."
      }),
      Object.freeze({
        label: "--feature <label>",
        description: "Short human label for the UI feature or flow that was verified."
      }),
      Object.freeze({
        label: "--auth-mode <mode>",
        description: "Auth path used by the Playwright flow: none | dev-auth-login-as | session-bootstrap | custom-local."
      })
    ]),
    defaults: Object.freeze([
      "Requires a git working tree so the receipt can record the currently changed UI files.",
      "Writes .jskit/verification/ui.json after the command succeeds.",
      "Doctor expects the receipt to match the current dirty UI file set."
    ])
  }),
  "update-packages": Object.freeze({
    name: "update-packages",
    summary: "Update installed @jskit-ai dependencies and refresh managed migrations.",
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
      "Runtime and dev @jskit-ai dependencies are updated separately so package.json sections stay correct.",
      "Each package is moved to the latest available major.x range and npm saves the resolved exact version.",
      "Managed migrations are refreshed afterwards unless --dry-run is used."
    ])
  }),
  "link-local-packages": Object.freeze({
    name: "link-local-packages",
    summary: "Link local @jskit-ai workspace packages into the current app for live development.",
    usage: "jskit app link-local-packages [--repo-root <path>]",
    options: Object.freeze([
      Object.freeze({
        label: "--repo-root <path>",
        description: "Explicit jskit-ai monorepo checkout to link from. If omitted, JSKIT_REPO_ROOT or nearby jskit-ai directories are used."
      })
    ]),
    defaults: Object.freeze([
      "Links packages from both the monorepo packages/ and tooling/ directories.",
      "Refreshes node_modules/.bin entries for linked packages that publish binaries.",
      "Clears node_modules/.vite so Vite does not keep stale prebundled paths."
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
    summary: "Rewrite legacy scaffolded maintenance scripts to the modern jskit app wrappers.",
    usage: "jskit app adopt-managed-scripts [--dry-run] [--force]",
    options: Object.freeze([
      Object.freeze({
        label: "--dry-run",
        description: "Preview the script rewrites without writing package.json."
      }),
      Object.freeze({
        label: "--force",
        description: "Replace customized script values too, and remove the legacy copied maintenance scripts if they exist."
      })
    ]),
    defaults: Object.freeze([
      "Known scaffolded script values are rewritten automatically.",
      "Customized script values are reported and left alone unless --force is used.",
      "This command is the migration path for existing apps that still carry copied JSKIT maintenance scripts."
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
    definition.name === "release"
  ) {
    optionMeta["dry-run"] = { inputType: "flag" };
  }
  if (definition.name === "adopt-managed-scripts") {
    optionMeta.force = { inputType: "flag" };
  }
  if (definition.name === "update-packages" || definition.name === "release") {
    optionMeta.registry = { inputType: "text" };
  }
  if (definition.name === "verify-ui") {
    optionMeta.command = { inputType: "text" };
    optionMeta.feature = { inputType: "text" };
    optionMeta["auth-mode"] = { inputType: "text" };
  }
  if (definition.name === "link-local-packages") {
    optionMeta["repo-root"] = { inputType: "text" };
  }

  return optionMeta;
}

export {
  APP_SCRIPT_WRAPPERS,
  LEGACY_APP_SCRIPT_VALUES,
  LEGACY_APP_SCRIPT_FILES,
  APP_COMMAND_DEFINITIONS,
  listAppCommandDefinitions,
  resolveAppCommandDefinition,
  buildAppCommandOptionMeta
};
