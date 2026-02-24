const DEFAULT_PROCESS_ENV_JS_EXTENSIONS = Object.freeze([".js", ".cjs", ".mjs"]);
const DEFAULT_PROCESS_ENV_EXCLUDED_DIR_NAMES = Object.freeze([
  ".git",
  "node_modules",
  "tests",
  "dist",
  "dist-internal",
  "dist-public",
  "coverage",
  ".vite"
]);
const DEFAULT_PROCESS_ENV_ALLOWED_FILES = Object.freeze([
  "server/lib/runtimeEnv.js",
  "knexfile.cjs",
  "vite.config.mjs",
  "playwright.config.mjs"
]);

const DEFAULT_API_CONTRACTS_README_PATH = "README.md";
const DEFAULT_API_CONTRACTS_MARKERS = Object.freeze({
  start: "<!-- API_CONTRACTS_START -->",
  end: "<!-- API_CONTRACTS_END -->"
});
const DEFAULT_API_CONTRACTS_ROUTE_PROVIDER = Object.freeze({
  modulePath: "server/modules/api/routes.js",
  exportName: "buildDefaultRoutes"
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toNonEmptyString(value, fallback = "") {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return fallback;
  }

  return normalized;
}

function toStringArray(value, fallback = []) {
  if (!Array.isArray(value)) {
    return [...fallback];
  }

  const output = value
    .map((entry) => String(entry || "").trim())
    .filter((entry) => entry.length > 0);

  if (output.length < 1) {
    return [...fallback];
  }

  return output;
}

function normalizeProcessEnvExtensions(value, fallback = DEFAULT_PROCESS_ENV_JS_EXTENSIONS) {
  return toStringArray(value, fallback)
    .map((entry) => {
      const normalized = entry.toLowerCase();
      return normalized.startsWith(".") ? normalized : `.${normalized}`;
    })
    .filter((entry, index, all) => all.indexOf(entry) === index);
}

function normalizeGuardrailsConfig(guardrails) {
  const source = isPlainObject(guardrails) ? guardrails : {};
  const processEnvSource = isPlainObject(source.processEnv) ? source.processEnv : {};
  const apiContractsSource = isPlainObject(source.apiContracts) ? source.apiContracts : {};
  const markersSource = isPlainObject(apiContractsSource.markers) ? apiContractsSource.markers : {};
  const routeProviderSource = isPlainObject(apiContractsSource.routeProvider) ? apiContractsSource.routeProvider : {};

  return {
    processEnv: {
      extensions: normalizeProcessEnvExtensions(processEnvSource.extensions),
      excludedDirNames: toStringArray(processEnvSource.excludedDirNames, DEFAULT_PROCESS_ENV_EXCLUDED_DIR_NAMES),
      allowFiles: toStringArray(processEnvSource.allowFiles, DEFAULT_PROCESS_ENV_ALLOWED_FILES)
    },
    apiContracts: {
      readmePath: toNonEmptyString(apiContractsSource.readmePath, DEFAULT_API_CONTRACTS_README_PATH),
      markers: {
        start: toNonEmptyString(markersSource.start, DEFAULT_API_CONTRACTS_MARKERS.start),
        end: toNonEmptyString(markersSource.end, DEFAULT_API_CONTRACTS_MARKERS.end)
      },
      routeProvider: {
        modulePath: toNonEmptyString(routeProviderSource.modulePath, DEFAULT_API_CONTRACTS_ROUTE_PROVIDER.modulePath),
        exportName: toNonEmptyString(routeProviderSource.exportName, DEFAULT_API_CONTRACTS_ROUTE_PROVIDER.exportName)
      }
    }
  };
}

function createNodeVueFastifyScriptsConfig(options = {}) {
  const config = {
    serverEntry: "bin/server.js",
    workerEntry: "bin/worker.js",
    retentionEnqueueEntry: "bin/enqueueRetentionSweep.js",
    retentionSweepEntry: "bin/retentionSweep.js",
    knexfile: "knexfile.cjs",
    mainClientEntry: "main.js",
    publicClientEntry: "main.public.js",
    internalDistDir: "dist-internal",
    publicDistDir: "dist-public",
    testCoverageConfig: ".c8rc.json",
    testCoverageAspirationalConfig: ".c8rc.aspirational.json",
    usersSeedFile: "01_user_profiles_seed.cjs",
    calculatorSeedFile: "02_calculation_logs_seed.cjs",
    ...options
  };
  config.guardrails = normalizeGuardrailsConfig(options.guardrails);

  return {
    guardrails: config.guardrails,
    tasks: {
      server: {
        command: "node",
        args: [config.serverEntry]
      },
      start: {
        command: "node",
        args: [config.serverEntry]
      },
      worker: {
        command: "node",
        args: [config.workerEntry]
      },
      "worker:retention:enqueue": {
        command: "node",
        args: [config.retentionEnqueueEntry]
      },
      "worker:retention:enqueue:dry-run": {
        command: "node",
        args: [config.retentionEnqueueEntry, "--dry-run"]
      },
      dev: {
        command: "vite",
        env: {
          VITE_CLIENT_ENTRY: config.mainClientEntry
        }
      },
      build: {
        command: "vite",
        args: ["build"],
        env: {
          VITE_CLIENT_ENTRY: config.mainClientEntry
        }
      },
      "build:client:internal": {
        command: "vite",
        args: ["build", "--outDir", config.internalDistDir],
        env: {
          VITE_CLIENT_ENTRY: config.mainClientEntry
        }
      },
      "build:client:public": {
        command: "vite",
        args: ["build", "--outDir", config.publicDistDir],
        env: {
          VITE_CLIENT_ENTRY: config.publicClientEntry
        }
      },
      preview: {
        command: "vite",
        args: ["preview"]
      },
      lint: "jskit-app-scripts lint:process-env && eslint .",
      "lint:process-env": {
        builtin: "guardrails:process-env"
      },
      "lint:fix": {
        command: "eslint",
        args: [".", "--fix"]
      },
      format: {
        command: "prettier",
        args: [".", "--write"]
      },
      "format:check": {
        command: "prettier",
        args: [".", "--check"]
      },
      "db:migrate": {
        command: "knex",
        args: ["--knexfile", config.knexfile, "migrate:latest"]
      },
      "db:rollback": {
        command: "knex",
        args: ["--knexfile", config.knexfile, "migrate:rollback"]
      },
      "db:seed": {
        command: "knex",
        args: ["--knexfile", config.knexfile, "seed:run"]
      },
      "db:seed:users": {
        command: "knex",
        args: ["--knexfile", config.knexfile, "seed:run", `--specific=${config.usersSeedFile}`]
      },
      "db:seed:calculator": {
        command: "knex",
        args: ["--knexfile", config.knexfile, "seed:run", `--specific=${config.calculatorSeedFile}`]
      },
      test: {
        command: "node",
        args: ["--test"],
        env: {
          NODE_ENV: "test"
        }
      },
      "test:client": {
        command: "vitest",
        args: ["run"]
      },
      "test:client:coverage": {
        command: "vitest",
        args: ["run", "--coverage"]
      },
      "test:client:views": {
        command: "vitest",
        args: ["run", "--config", "vitest.vue.config.mjs"]
      },
      "test:client:views:coverage": {
        command: "vitest",
        args: ["run", "--config", "vitest.vue.config.mjs", "--coverage"]
      },
      "test:coverage": {
        command: "c8",
        args: ["--config", config.testCoverageConfig, "node", "--test"],
        env: {
          NODE_ENV: "test"
        }
      },
      "test:coverage:all": {
        command: "c8",
        args: [
          "--config",
          config.testCoverageConfig,
          "--check-coverage",
          "false",
          "--per-file",
          "false",
          "--reporter",
          "text-summary",
          "node",
          "--test"
        ],
        env: {
          NODE_ENV: "test"
        }
      },
      "test:coverage:aspirational": {
        command: "c8",
        args: [
          "--config",
          config.testCoverageAspirationalConfig,
          "--check-coverage",
          "false",
          "--per-file",
          "false",
          "--reporter",
          "text-summary",
          "node",
          "--test"
        ],
        env: {
          NODE_ENV: "test"
        }
      },
      "test:coverage:full":
        "jskit-app-scripts docs:api-contracts:check && jskit-app-scripts test:coverage && jskit-app-scripts test:client:coverage && jskit-app-scripts test:client:views:coverage",
      "test:e2e": {
        command: "playwright",
        args: ["test"]
      },
      "test:e2e:install": {
        command: "playwright",
        args: ["install", "chromium"]
      },
      "docs:api-contracts": {
        builtin: "guardrails:api-contracts:sync"
      },
      "docs:api-contracts:check": {
        builtin: "guardrails:api-contracts:check"
      },
      "ops:retention": {
        command: "node",
        args: [config.retentionSweepEntry]
      },
      "ops:retention:dry-run": {
        command: "node",
        args: [config.retentionSweepEntry, "--dry-run"]
      }
    }
  };
}

export { createNodeVueFastifyScriptsConfig };
