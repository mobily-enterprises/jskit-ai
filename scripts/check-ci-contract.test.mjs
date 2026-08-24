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
          - 22
          - 24
          - 26
    steps:
      - run: npm run verify
      - run: node --test packages/example/test/example.test.js
`;

test("CI runtime parsing keeps the workflow matrix aligned with package engines", () => {
  assert.deepEqual(collectEngineMajors("^22.13.0 || ^24.0.0 || ^26.0.0"), [22, 24, 26]);
  assert.deepEqual(collectMatrixMajors(VALID_VERIFY_WORKFLOW), [22, 24, 26]);
});

test("CI contract verification accepts current scripts, test targets, and runtime coverage", async () => {
  const issues = await collectCiContractIssues({
    packageJson: {
      engines: { node: "^22.13.0 || ^24.0.0 || ^26.0.0" },
      scripts: { verify: "node verify.mjs" }
    },
    workflows: { "verify.yml": VALID_VERIFY_WORKFLOW },
    pathExists: async (targetPath) => targetPath.endsWith("packages/example/test/example.test.js")
  });

  assert.deepEqual(issues, []);
});

test("CI contract verification reports stale scripts, files, and runtime matrices", async () => {
  const issues = await collectCiContractIssues({
    packageJson: {
      engines: { node: "^22.13.0 || ^24.0.0 || ^26.0.0" },
      scripts: {}
    },
    workflows: {
      "verify.yml": VALID_VERIFY_WORKFLOW.replace("          - 24\n", "")
    },
    pathExists: async () => false
  });

  assert.deepEqual(issues, [
    "verify.yml runs missing root package script \"verify\".",
    "verify.yml runs missing test target \"packages/example/test/example.test.js\".",
    "verify workflow Node matrix (22, 26) must match engines.node (22, 24, 26)."
  ]);
});
