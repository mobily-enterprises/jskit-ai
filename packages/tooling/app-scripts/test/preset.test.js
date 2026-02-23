import assert from "node:assert/strict";
import test from "node:test";
import { createNodeVueFastifyScriptsConfig } from "../src/index.js";

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
  assert.equal(config.tasks["test:coverage:full"], "jskit-app-scripts docs:api-contracts:check && jskit-app-scripts test:coverage && jskit-app-scripts test:client:coverage && jskit-app-scripts test:client:views:coverage");
  assert.deepEqual(config.tasks["db:migrate"], {
    command: "knex",
    args: ["--knexfile", "knexfile.cjs", "migrate:latest"]
  });
});

test("node/vue/fastify preset accepts per-app overrides", () => {
  const config = createNodeVueFastifyScriptsConfig({
    mainClientEntry: "main.alt.js",
    knexfile: "knexfile.alt.cjs",
    usersSeedFile: "users_seed.cjs"
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
});
