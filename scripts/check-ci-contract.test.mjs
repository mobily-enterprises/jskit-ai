import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  collectCiContractIssues,
  collectEngineMajors,
  collectMatrixMajors
} from "./check-ci-contract.mjs";

const VALID_VERIFY_WORKFLOW = `
concurrency:
  group: \${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: \${{ github.event_name == 'pull_request' }}
env:
  npm_config_engine_strict: "true"
jobs:
  verify:
    strategy:
      matrix:
        node:
          - 24
          - 26
    steps:
      - run: npm run verify
      - run: npx jskit test packages/example/test/example.test.js packages/example/test/other.test.js
      - run: npx jskit test packages/example/test/*.postgres.test.js
`;

test("CI runtime parsing keeps the workflow matrix aligned with package engines", () => {
  assert.deepEqual(collectEngineMajors("^24.0.0 || ^26.0.0"), [24, 26]);
  assert.deepEqual(collectMatrixMajors(VALID_VERIFY_WORKFLOW), [24, 26]);
});

test("CI contract verification accepts current scripts, test targets, and runtime coverage", async () => {
  const issues = await collectCiContractIssues({
    packageJson: {
      engines: { node: "^24.0.0 || ^26.0.0" },
      scripts: { verify: "node verify.mjs" }
    },
    workflows: { "verify.yml": VALID_VERIFY_WORKFLOW },
    pathExists: async (targetPath) => /packages\/example\/test\/(?:example|other)\.test\.js$/u.test(targetPath),
    listDirectory: async (directoryPath) => (directoryPath.endsWith("packages/example/test") ? ["example.test.js", "store.postgres.test.js"] : []),
    browserTests: []
  });

  assert.deepEqual(issues, []);
});

test("CI contract verification reports stale scripts, files, and runtime matrices", async () => {
  const issues = await collectCiContractIssues({
    packageJson: {
      engines: { node: "^24.0.0 || ^26.0.0" },
      scripts: {}
    },
    workflows: {
      "verify.yml": VALID_VERIFY_WORKFLOW.replace("          - 24\n", "")
        .replace("npx jskit test", "node --test --test-concurrency=1")
    },
    pathExists: async () => false,
    listDirectory: async () => ["example.test.js"],
    browserTests: []
  });

  assert.deepEqual(issues, [
    "verify.yml runs missing root package script \"verify\".",
    "verify.yml runs node --test directly; run `npx jskit test`, which keeps test files within the machine's test budget.",
    "verify.yml runs missing test target \"packages/example/test/example.test.js\".",
    "verify.yml runs missing test target \"packages/example/test/other.test.js\".",
    "verify.yml runs test target \"packages/example/test/*.postgres.test.js\", which matches no file.",
    "verify workflow Node matrix (26) must match engines.node (24, 26)."
  ]);
});

test("CI contract verification requires a newer commit on a pull request to cancel its running verification, and a run on main to finish", async () => {
  const check = (verifyWorkflow) => collectCiContractIssues({
    packageJson: { engines: { node: "^24.0.0 || ^26.0.0" }, scripts: { verify: "node verify.mjs" } },
    workflows: { "verify.yml": verifyWorkflow },
    pathExists: async () => true,
    listDirectory: async () => ["example.test.js", "store.postgres.test.js"],
    browserTests: []
  });
  const issue = "verify workflow must cancel only a pull request's superseded run, so a run on main always finishes: " +
    "a top-level concurrency group on github.ref with cancel-in-progress: ${{ github.event_name == 'pull_request' }}.";
  const cancelling = "cancel-in-progress: ${{ github.event_name == 'pull_request' }}";
  assert.deepEqual(await check(VALID_VERIFY_WORKFLOW), []);
  assert.deepEqual(await check(VALID_VERIFY_WORKFLOW.replace(/^concurrency:\n(?: {2}.*\n)+/mu, "")), [issue]);
  // A run on main is cancelled by the next push to main: refused, as is never cancelling a pull request's run.
  assert.deepEqual(await check(VALID_VERIFY_WORKFLOW.replace(cancelling, "cancel-in-progress: true")), [issue]);
  assert.deepEqual(await check(VALID_VERIFY_WORKFLOW.replace(cancelling, "cancel-in-progress: false")), [issue]);
  assert.deepEqual(await check(VALID_VERIFY_WORKFLOW.replace("-${{ github.ref }}", "")), [issue]);
});

test("CI contract verification reads a * in a test target's file name, and no other pattern", async () => {
  const workflow = (target) => ({ "x.yml": `steps:\n  - run: npx jskit test ${target}\n` });
  const check = (target) => collectCiContractIssues({
    packageJson: { engines: { node: "^24.0.0" }, scripts: {} },
    workflows: workflow(target),
    pathExists: async () => true,
    listDirectory: async () => ["a.postgres.test.js", "b.test.js"]
  }).then((issues) => issues.filter((issue) => issue.startsWith("x.yml")));

  assert.deepEqual(await check("packages/x/test/*.postgres.test.js"), []);
  assert.deepEqual(await check("packages/x/test/*.mysql.test.js"), ["x.yml runs test target \"packages/x/test/*.mysql.test.js\", which matches no file."]);
  for (const target of ["packages/*/test/a.test.js", "packages/x/test/?.test.js", "packages/x/test/{a,b}.test.js"]) {
    assert.deepEqual(await check(target), [
      `x.yml runs test target "${target}", a pattern the CI check cannot read; name the files, or use * in the file name only.`
    ]);
  }
});

test("CI contract verification refuses a data test file a workflow names by hand, by name or by a * pattern", async () => {
  const check = (target) => collectCiContractIssues({
    packageJson: { engines: { node: "^24.0.0" }, scripts: {} },
    workflows: { "x.yml": `steps:\n  - run: npx jskit test ${target}\n` },
    pathExists: async () => true,
    listDirectory: async () => ["store.postgres.test.js", "records.test.js", "page.browser.test.js", "store.mysql.test.js"],
    pickedDataTestFiles: new Set(["packages/example/test/store.postgres.test.js", "packages/example/test/records.test.js"])
  }).then((issues) => issues.filter((issue) => issue.startsWith("x.yml runs data test")));
  const refusal = (target) => `x.yml runs data test target "${target}" by hand; run \`npm run verify\`, ` +
    "`npm run test:sqlite` or `npm run test:postgres`, which pick every data test file themselves, so none is left out.";

  for (const target of [
    "packages/example/test/store.postgres.test.js",
    "./packages/example/test/records.test.js",
    "packages/example/test/*.postgres.test.js",
    "packages/example/test/*.test.js"
  ]) {
    assert.deepEqual(await check(target), [refusal(target)], target);
  }
  for (const target of ["packages/example/test/page.browser.test.js", "packages/example/test/*.browser.test.js", "packages/example/test/store.mysql.test.js"]) {
    assert.deepEqual(await check(target), [], target);
  }
});

test("CI contract verification refuses this repository's PostgreSQL files and data tests on the run's Knex named by hand", async () => {
  const targets = ["packages/resource-runtime/test/*.postgres.test.js", "packages/crud-core/test/crudOnHandles.test.js"];
  const issues = await collectCiContractIssues({
    packageJson: { engines: { node: "^24.0.0" }, scripts: {} },
    workflows: { "x.yml": `steps:\n  - run: npx jskit test ${targets.join(" ")} packages/database-runtime-mysql/test/testDatabases.mysql.test.js\n` }
  });
  assert.deepEqual(issues.filter((issue) => issue.startsWith("x.yml")).map((issue) => issue.match(/"([^"]+)"/u)[1]), targets);
});

test("CI contract verification refuses a browser test file a workflow names by hand, by name or by a * pattern", async () => {
  const check = (target) => collectCiContractIssues({
    packageJson: { engines: { node: "^24.0.0" }, scripts: {} },
    workflows: { "x.yml": `steps:\n  - run: npx jskit test ${target}\n` },
    pathExists: async () => true,
    listDirectory: async () => ["page.browser.test.js", "store.mysql.test.js"],
    pickedDataTestFiles: new Set(),
    browserTests: []
  }).then((issues) => issues.filter((issue) => issue.startsWith("x.yml")));
  const refusal = (target) => `x.yml runs browser test target "${target}" by hand; set its JSKIT_* switch to "1" on a step ` +
    "that runs `npm run test:browser`, which picks every browser test file whose switch the step sets, so none is left out.";

  for (const target of ["packages/example/test/page.browser.test.js", "packages/example/test/*.browser.test.js"]) {
    assert.deepEqual(await check(target), [refusal(target)], target);
  }
  assert.deepEqual(await check("packages/example/test/store.mysql.test.js"), []);
});

test("CI contract verification refuses a browser test file whose switches no step that runs test:browser sets", async () => {
  const workflow = [
    "jobs:",
    "  browser:",
    "    steps:",
    "      - name: Shell",
    "        env:",
    "          JSKIT_SHELL: \"1\"",
    "        run: npm run test:browser",
    "      - name: Not a browser run",
    "        env:",
    "          JSKIT_UNUSED: \"1\"",
    "        run: npm run lint",
    "  next:",
    "    env:",
    "      JSKIT_JOB_LEVEL: \"1\"",
    "    steps:",
    "      - run: npm run test:browser",
    ""
  ].join("\n");
  const browserTests = [
    { file: "packages/a/test/shell.browser.test.js", switches: ["JSKIT_SHELL"] },
    { file: "packages/a/test/both.browser.test.js", switches: ["JSKIT_SHELL", "JSKIT_OTHER"] },
    { file: "packages/a/test/unused.browser.test.js", switches: ["JSKIT_UNUSED"] },
    { file: "packages/a/test/job.browser.test.js", switches: ["JSKIT_JOB_LEVEL"] },
    { file: "packages/a/test/unswitched.browser.test.js", switches: [] }
  ];
  const issues = await collectCiContractIssues({
    packageJson: { engines: { node: "^24.0.0" }, scripts: { lint: "x", "test:browser": "x" } },
    workflows: { "x.yml": workflow },
    browserTests
  });

  assert.deepEqual(issues.filter((issue) => /browser test file/iu.test(issue)), [
    "No CI step runs browser test file \"packages/a/test/both.browser.test.js\": set JSKIT_SHELL: \"1\" and JSKIT_OTHER: \"1\" on a step that runs `npm run test:browser`.",
    "No CI step runs browser test file \"packages/a/test/unused.browser.test.js\": set JSKIT_UNUSED: \"1\" on a step that runs `npm run test:browser`.",
    "No CI step runs browser test file \"packages/a/test/job.browser.test.js\": set JSKIT_JOB_LEVEL: \"1\" on a step that runs `npm run test:browser`.",
    "Browser test file \"packages/a/test/unswitched.browser.test.js\" has no JSKIT_* switch (process.env.JSKIT_X === \"1\"), so `npm run test:browser` never picks it."
  ]);
});

test("CI contract verification finds every browser test file of this repository run by a CI step", async () => {
  const workflows = { "verify.yml": readFileSync(".github/workflows/verify.yml", "utf8") };
  const issues = await collectCiContractIssues({ packageJson: JSON.parse(readFileSync("package.json", "utf8")), workflows });
  assert.deepEqual(issues, []);
  // Without its step, a browser test file is refused by name.
  const withoutPayments = workflows["verify.yml"].replace(/ +- name: [^\n]+\n +env:\n +JSKIT_PAYMENTS_WEB_BROWSER_INTEGRATION: "1"\n +run: npm run test:browser\n/u, "");
  assert.notEqual(withoutPayments, workflows["verify.yml"]);
  assert.deepEqual(await collectCiContractIssues({ packageJson: JSON.parse(readFileSync("package.json", "utf8")), workflows: { "verify.yml": withoutPayments } }), [
    "No CI step runs browser test file \"packages/payments-web/test/paymentAccount.browser.test.js\": set JSKIT_PAYMENTS_WEB_BROWSER_INTEGRATION: \"1\" on a step that runs `npm run test:browser`."
  ]);
});
