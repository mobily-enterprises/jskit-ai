import assert from "node:assert/strict";
import test from "node:test";
import {
  CiCompositionError,
  composeCiContributions
} from "../src/server/cliRuntime/ci/composer.js";
import { renderGithubWorkflow } from "../src/server/cliRuntime/ci/githubWorkflow.js";

function packageEntry(packageId, ci) {
  return {
    packageId,
    descriptor: { packageId, ci }
  };
}

const databaseService = {
  id: "mariadb",
  image: "mariadb:11.4",
  environment: {
    MARIADB_DATABASE: "jskit_ci"
  },
  ports: ["33060:3306"],
  healthCheck: {
    command: "healthcheck.sh --connect --innodb_initialized",
    interval: "10s",
    timeout: "5s",
    retries: 10
  }
};
const migrationStep = {
  id: "database-migrations",
  phase: "before-verify",
  label: "Apply database migrations",
  command: "npm run db:migrate"
};

test("CI contribution composition is deterministic across package input order", () => {
  const entries = [
    packageEntry("@jskit-ai/database-runtime-mysql", {
      environment: { DB_CLIENT: "mysql2" },
      services: [databaseService]
    }),
    packageEntry("@jskit-ai/database-runtime", {
      steps: [migrationStep]
    })
  ];

  assert.deepEqual(
    composeCiContributions(entries),
    composeCiContributions([...entries].reverse())
  );
});

test("CI contribution composition deduplicates identical stable IDs", () => {
  const model = composeCiContributions([
    packageEntry("@jskit-ai/a", {
      environment: { DB_CLIENT: "mysql2" },
      services: [databaseService],
      steps: [migrationStep]
    }),
    packageEntry("@jskit-ai/b", {
      environment: { DB_CLIENT: "mysql2" },
      services: [databaseService],
      steps: [migrationStep]
    })
  ]);

  assert.equal(model.services.length, 1);
  assert.equal(model.steps.length, 1);
  assert.deepEqual(model.sources.environment.DB_CLIENT, ["@jskit-ai/a", "@jskit-ai/b"]);
  assert.deepEqual(model.sources.services.mariadb, ["@jskit-ai/a", "@jskit-ai/b"]);
  assert.deepEqual(model.sources.steps["database-migrations"], ["@jskit-ai/a", "@jskit-ai/b"]);
});

test("CI contribution composition reports environment, service, and step conflicts", () => {
  assert.throws(
    () => composeCiContributions([
      packageEntry("@jskit-ai/mysql", { environment: { DB_CLIENT: "mysql2" } }),
      packageEntry("@jskit-ai/postgres", { environment: { DB_CLIENT: "pg" } })
    ]),
    (error) =>
      error instanceof CiCompositionError &&
      error.code === "ci:environment-conflict" &&
      /@jskit-ai\/mysql/u.test(error.message) &&
      /@jskit-ai\/postgres/u.test(error.message) &&
      /mysql2/u.test(error.message) &&
      /pg/u.test(error.message)
  );
  assert.throws(
    () => composeCiContributions([
      packageEntry("@jskit-ai/a", { services: [databaseService] }),
      packageEntry("@jskit-ai/b", { services: [{ ...databaseService, image: "mariadb:12" }] })
    ]),
    /\[ci:service-conflict\].*mariadb/u
  );
  assert.throws(
    () => composeCiContributions([
      packageEntry("@jskit-ai/a", { steps: [migrationStep] }),
      packageEntry("@jskit-ai/b", { steps: [{ ...migrationStep, command: "npm run other" }] })
    ]),
    /\[ci:step-conflict\].*database-migrations/u
  );
});

test("GitHub workflow rendering is stable and preserves verification order", () => {
  const model = composeCiContributions([
    packageEntry("@jskit-ai/database-runtime-mysql", {
      environment: { DB_CLIENT: "mysql2" },
      services: [databaseService]
    }),
    packageEntry("@jskit-ai/database-runtime", {
      steps: [migrationStep]
    })
  ]);
  const rendered = renderGithubWorkflow(model);

  assert.equal(rendered, `# Generated and managed by JSKIT. Run \`npx jskit app sync-ci\` to regenerate.
# Put application-specific CI in a separate workflow; edits to this file are not merged.
name: JSKIT Verify
on:
  pull_request: null
  push:
    branches:
      - main
permissions:
  contents: read
jobs:
  verify:
    runs-on: ubuntu-latest
    env:
      DB_CLIENT: mysql2
    services:
      mariadb:
        image: mariadb:11.4
        env:
          MARIADB_DATABASE: jskit_ci
        ports:
          - 33060:3306
        options: --health-cmd="healthcheck.sh --connect --innodb_initialized" --health-interval=10s --health-timeout=5s --health-retries=10
    steps:
      - id: checkout
        name: Checkout
        uses: actions/checkout@v4
      - id: setup-node
        name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - id: install-dependencies
        name: Install dependencies
        run: npm ci
      - id: database-migrations
        name: Apply database migrations
        run: npm run db:migrate
      - id: verify
        name: Run verification
        run: npm run verify
`);
});
