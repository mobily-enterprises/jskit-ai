import assert from "node:assert/strict";
import test from "node:test";
import {
  collectCiContractIssues,
  collectEngineMajors,
  collectMatrixMajors
} from "./check-ci-contract.mjs";

const VALID_VERIFY_WORKFLOW = `
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
    listDirectory: async (directoryPath) => (directoryPath.endsWith("packages/example/test") ? ["example.test.js", "store.postgres.test.js"] : [])
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
    listDirectory: async () => ["example.test.js"]
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
