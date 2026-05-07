const MOBILE_COMMAND_DEFINITIONS = Object.freeze({
  add: Object.freeze({
    name: "add",
    summary: "Install Capacitor mobile-shell support into the current app.",
    usage: "jskit mobile add capacitor [--dry-run]",
    options: Object.freeze([
      Object.freeze({
        label: "--dry-run",
        description: "Preview the package install and generated files without mutating package.json, lockfiles, or app files."
      })
    ]),
    defaults: Object.freeze([
      "Installs @jskit-ai/mobile-capacitor plus the required Capacitor packages.",
      "Renders capacitor.config.json and .jskit/mobile-capacitor.md from config.mobile.",
      "Runs npm install and then cap add android unless --dry-run is used.",
      "If android/ already exists, the Capacitor CLI add step is skipped."
    ])
  }),
  sync: Object.freeze({
    name: "sync",
    summary: "Build the JSKIT web client and sync the Android Capacitor shell.",
    usage: "jskit mobile sync android [--dry-run]",
    options: Object.freeze([
      Object.freeze({
        label: "--dry-run",
        description: "Preview the build and Capacitor sync commands without writing dist output or mutating the Android shell."
      })
    ]),
    defaults: Object.freeze([
      "Runs npm run build so dist/ matches the current JSKIT web client.",
      "Runs cap sync android after the frontend build succeeds.",
      "Requires capacitor.config.json and android/ from jskit mobile add capacitor."
    ])
  }),
  run: Object.freeze({
    name: "run",
    summary: "Launch the Android Capacitor shell for the current app.",
    usage: "jskit mobile run android [--dry-run]",
    options: Object.freeze([
      Object.freeze({
        label: "--dry-run",
        description: "Preview the sync/run commands without mutating dist output or launching the Android shell."
      })
    ]),
    defaults: Object.freeze([
      "Refreshes dist/ and syncs the Android shell before cap run android.",
      "Dev-server mode still uses the live server URL from config.mobile at runtime."
    ])
  }),
  build: Object.freeze({
    name: "build",
    summary: "Build a release Android App Bundle for the current app.",
    usage: "jskit mobile build android [--dry-run]",
    options: Object.freeze([
      Object.freeze({
        label: "--dry-run",
        description: "Preview the sync/build commands without writing dist output or running Gradle."
      })
    ]),
    defaults: Object.freeze([
      'Requires config.mobile.assetMode to stay on "bundled" for release builds.',
      "Runs the JSKIT web build, syncs Android, and then executes the Gradle bundleRelease task."
    ])
  }),
  doctor: Object.freeze({
    name: "doctor",
    summary: "Validate the Android Capacitor shell wiring for the current app.",
    usage: "jskit mobile doctor",
    options: Object.freeze([]),
    defaults: Object.freeze([
      "Checks config.mobile, capacitor.config.json, android/, and the managed AndroidManifest deep-link filter."
    ])
  })
});

function listMobileCommandDefinitions() {
  return Object.values(MOBILE_COMMAND_DEFINITIONS)
    .sort((left, right) => left.name.localeCompare(right.name));
}

function resolveMobileCommandDefinition(rawName = "") {
  const normalizedName = String(rawName || "").trim();
  if (!normalizedName) {
    return null;
  }
  return MOBILE_COMMAND_DEFINITIONS[normalizedName] || null;
}

function buildMobileCommandOptionMeta(subcommandName = "") {
  const definition = resolveMobileCommandDefinition(subcommandName);
  const optionMeta = {
    help: { inputType: "flag" }
  };

  if (!definition) {
    return optionMeta;
  }

  if (definition.name === "add" || definition.name === "sync" || definition.name === "run" || definition.name === "build") {
    optionMeta["dry-run"] = { inputType: "flag" };
  }

  return optionMeta;
}

export {
  MOBILE_COMMAND_DEFINITIONS,
  listMobileCommandDefinitions,
  resolveMobileCommandDefinition,
  buildMobileCommandOptionMeta
};
