const MOBILE_COMMAND_DEFINITIONS = Object.freeze({
  add: Object.freeze({
    name: "add",
    summary: "Install Capacitor mobile-shell support into the current app.",
    usage: "jskit mobile add capacitor [--dry-run] [--devlinks]",
    options: Object.freeze([
      Object.freeze({
        label: "--devlinks",
        description: "Run npm run --if-present devlinks after install for local development relinking."
      }),
      Object.freeze({
        label: "--dry-run",
        description: "Preview the package install and generated files without mutating package.json, lockfiles, or app files."
      })
    ]),
    defaults: Object.freeze([
      "Installs @jskit-ai/mobile-capacitor plus the required Capacitor packages.",
      "Renders capacitor.config.json and .jskit/mobile-capacitor.md from config.mobile.",
      "Runs npm install and then cap add android unless --dry-run is used.",
      "Use --devlinks only when you want npm run devlinks to relink the app after install.",
      "If android/ already exists, the Capacitor CLI add step is skipped."
    ])
  }),
  sync: Object.freeze({
    name: "sync",
    summary: "Build the JSKIT web client and sync the Android Capacitor shell.",
    usage: "jskit mobile sync android [--dry-run] [--devlinks]",
    options: Object.freeze([
      Object.freeze({
        label: "--devlinks",
        description: "If sync needs to run npm install first, also run npm run --if-present devlinks afterward."
      }),
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
    usage: "jskit mobile run android [--target <device-id>] [--dry-run]",
    options: Object.freeze([
      Object.freeze({
        label: "--target <device-id>",
        description: "Optional adb device serial forwarded to cap run android --target."
      }),
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
  dev: Object.freeze({
    name: "dev",
    summary: "Run the local Android phone workflow: sync, install/run, then create the adb reverse tunnel.",
    usage: "jskit mobile dev android [--target <device-id>]",
    options: Object.freeze([
      Object.freeze({
        label: "--target <device-id>",
        description: "Optional adb device serial. If omitted, uses the first device from adb devices -l."
      })
    ]),
    defaults: Object.freeze([
      "Runs jskit mobile sync android first.",
      "Runs jskit mobile run android --target <device-id> without re-syncing a second time.",
      "Runs jskit mobile tunnel android --target <device-id> last so local backend traffic reaches your laptop."
    ])
  }),
  devices: Object.freeze({
    name: "devices",
    summary: "List Android devices currently visible to adb.",
    usage: "jskit mobile devices android",
    options: Object.freeze([]),
    defaults: Object.freeze([
      "Runs adb devices -l and prints the currently connected Android targets."
    ])
  }),
  tunnel: Object.freeze({
    name: "tunnel",
    summary: "Create and verify an adb reverse tunnel for local Android testing.",
    usage: "jskit mobile tunnel android [--target <device-id>] [--port <port>]",
    options: Object.freeze([
      Object.freeze({
        label: "--target <device-id>",
        description: "Optional adb device serial. If omitted, uses the first device from adb devices -l."
      }),
      Object.freeze({
        label: "--port <port>",
        description: "Optional local/backend port. Defaults to the loopback port from config.mobile.apiBaseUrl."
      })
    ]),
    defaults: Object.freeze([
      "Runs adb -s <target> reverse tcp:<port> tcp:<port>.",
      "Runs adb -s <target> reverse --list after setup so the active tunnel is visible."
    ])
  }),
  restart: Object.freeze({
    name: "restart",
    summary: "Clear app data and cold-start the Android shell on a chosen device.",
    usage: "jskit mobile restart android [--target <device-id>]",
    options: Object.freeze([
      Object.freeze({
        label: "--target <device-id>",
        description: "Optional adb device serial. If omitted, uses the first device from adb devices -l."
      })
    ]),
    defaults: Object.freeze([
      "Runs adb shell pm clear for the configured Android package name.",
      "Force-stops the app, then cold-starts MainActivity."
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
  if (definition.name === "run") {
    optionMeta.target = { inputType: "text" };
  }
  if (definition.name === "dev") {
    optionMeta.target = { inputType: "text" };
  }
  if (definition.name === "tunnel") {
    optionMeta.target = { inputType: "text" };
    optionMeta.port = { inputType: "text" };
  }
  if (definition.name === "restart") {
    optionMeta.target = { inputType: "text" };
  }

  return optionMeta;
}

export {
  MOBILE_COMMAND_DEFINITIONS,
  listMobileCommandDefinitions,
  resolveMobileCommandDefinition,
  buildMobileCommandOptionMeta
};
