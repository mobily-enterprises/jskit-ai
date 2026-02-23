function createNodeVueFastifyScriptsConfig(options = {}) {
  const config = {
    serverEntry: "bin/server.js",
    workerEntry: "bin/worker.js",
    retentionEnqueueEntry: "bin/enqueueRetentionSweep.js",
    retentionSweepEntry: "bin/retentionSweep.js",
    processEnvLintEntry: "bin/checkProcessEnvUsage.js",
    docsApiContractsEntry: "bin/syncApiContractsReadme.js",
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

  return {
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
        command: "node",
        args: [config.processEnvLintEntry]
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
        command: "node",
        args: [config.docsApiContractsEntry]
      },
      "docs:api-contracts:check": {
        command: "node",
        args: [config.docsApiContractsEntry, "--check"]
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
