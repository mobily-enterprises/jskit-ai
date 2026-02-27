import assert from "node:assert/strict";
import test from "node:test";
import { createNodeVueFastifyScriptsConfig } from "../src/shared/index.js";

test("node/vue/fastify preset exposes expected canonical tasks", () => {
  const config = createNodeVueFastifyScriptsConfig();
  assert.ok(config && typeof config === "object");
  assert.ok(config.tasks && typeof config.tasks === "object");

  assert.deepEqual(config.tasks.dev, {
    command: "vite",
    env: {
      VITE_CLIENT_ENTRY: "main.js"
    }
  });
  assert.equal(config.tasks.lint, "jskit-app-scripts lint:process-env && eslint .");
  assert.deepEqual(config.tasks["lint:process-env"], {
    builtin: "guardrails:process-env"
  });
  assert.deepEqual(config.tasks["docs:api-contracts"], {
    builtin: "guardrails:api-contracts:sync"
  });
  assert.deepEqual(config.tasks["docs:api-contracts:check"], {
    builtin: "guardrails:api-contracts:check"
  });
  assert.deepEqual(config.tasks["element:eject"], {
    builtin: "elements:eject"
  });
  assert.deepEqual(config.tasks["element:diff"], {
    builtin: "elements:diff"
  });
  assert.equal(
    config.tasks["test:coverage:full"],
    "jskit-app-scripts docs:api-contracts:check && jskit-app-scripts test:coverage && jskit-app-scripts test:client:coverage && jskit-app-scripts test:client:views:coverage"
  );
  assert.deepEqual(config.tasks["db:migrate"], {
    command: "knex",
    args: ["--knexfile", "knexfile.cjs", "migrate:latest"]
  });

  assert.deepEqual(config.guardrails.processEnv.allowFiles, [
    "server/lib/runtimeEnv.js",
    "knexfile.cjs",
    "vite.config.mjs",
    "playwright.config.mjs"
  ]);
  assert.deepEqual(config.guardrails.apiContracts.routeProvider, {
    modulePath: "server/modules/api/routes.js",
    exportName: "buildDefaultRoutes"
  });
});

test("node/vue/fastify preset accepts per-app overrides", () => {
  const config = createNodeVueFastifyScriptsConfig({
    mainClientEntry: "main.alt.js",
    knexfile: "knexfile.alt.cjs",
    usersSeedFile: "users_seed.cjs",
    guardrails: {
      processEnv: {
        allowFiles: ["config/runtimeEnv.js"]
      },
      apiContracts: {
        readmePath: "docs/API.md",
        routeProvider: {
          modulePath: "server/routes.js",
          exportName: "buildRoutes"
        }
      }
    }
  });

  assert.equal(config.tasks.dev.env.VITE_CLIENT_ENTRY, "main.alt.js");
  assert.deepEqual(config.tasks["db:migrate"], {
    command: "knex",
    args: ["--knexfile", "knexfile.alt.cjs", "migrate:latest"]
  });
  assert.deepEqual(config.tasks["db:seed:users"], {
    command: "knex",
    args: ["--knexfile", "knexfile.alt.cjs", "seed:run", "--specific=users_seed.cjs"]
  });

  assert.deepEqual(config.guardrails.processEnv.allowFiles, ["config/runtimeEnv.js"]);
  assert.equal(config.guardrails.apiContracts.readmePath, "docs/API.md");
  assert.deepEqual(config.guardrails.apiContracts.routeProvider, {
    modulePath: "server/routes.js",
    exportName: "buildRoutes"
  });
});
