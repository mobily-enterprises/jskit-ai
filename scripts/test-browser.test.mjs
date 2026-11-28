import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { browserTestFiles, switchedBrowserTestFiles, switchedOtherTestFiles } from "./test-browser.mjs";

test("test:browser reads each browser test file's JSKIT_* switch, the variable it compares with \"1\"", () => {
  const switches = Object.fromEntries(browserTestFiles().map(({ file, switches: names }) => [file, names]));
  // Browser test files CI's hand-kept steps left out, each with the switch that now turns it on there.
  assert.deepEqual(switches["packages/payments-web/test/paymentAccount.browser.test.js"], ["JSKIT_PAYMENTS_WEB_BROWSER_INTEGRATION"]);
  assert.deepEqual(switches["packages/workspaces-web/test/roleLabels.browser.test.js"], ["JSKIT_WORKSPACE_ROLE_LABELS_BROWSER"]);
  assert.deepEqual(switches["packages/shell-web/test/productionBuild.browser.test.js"], ["JSKIT_SHELL_WEB_BROWSER_INTEGRATION"]);
  // A screenshot folder the test reads is not a switch: only a comparison with "1" is.
  assert.deepEqual(switches["packages/assistant-runtime/test/assistantConversationBinding.browser.test.js"],
    ["JSKIT_ASSISTANT_RUNTIME_BROWSER_INTEGRATION"]);
  assert.ok(Object.keys(switches).every((file) => /^packages\/[^/]+\/test\/[^/]+\.browser\.test\.js$/u.test(file)));
});

test("no test of this repository is turned on by a browser switch outside a browser test file", () => {
  assert.deepEqual(switchedOtherTestFiles(), []);
  // The mounted voice starter runs in the assistant runtime's browser step.
  assert.deepEqual(switchedBrowserTestFiles({ JSKIT_ASSISTANT_RUNTIME_BROWSER_INTEGRATION: "1" })
    .filter((file) => file.startsWith("packages/assistant-voice/")), ["packages/assistant-voice/test/conversationExampleStarter.browser.test.js"]);
});

test("test:browser runs the browser test files whose switches are all set, and no other", () => {
  assert.deepEqual(switchedBrowserTestFiles({ JSKIT_SHELL_WEB_BROWSER_INTEGRATION: "1" }), [
    "packages/shell-web/test/adaptiveShell.browser.test.js",
    "packages/shell-web/test/appEnvironmentBanner.browser.test.js",
    "packages/shell-web/test/colorContrast.browser.test.js",
    "packages/shell-web/test/inertBehindDialog.browser.test.js",
    "packages/shell-web/test/lateNavigation.browser.test.js",
    "packages/shell-web/test/pendingAction.browser.test.js",
    "packages/shell-web/test/productionBuild.browser.test.js",
    "packages/shell-web/test/topAppBarRoom.browser.test.js"
  ]);
  assert.deepEqual(switchedBrowserTestFiles({ JSKIT_MATERIAL_BASELINES: "1", JSKIT_SHELL_WEB_BROWSER_INTEGRATION: "0" }), [
    "packages/http-web/test/crudScreensMaterialBaselines.browser.test.js",
    "packages/shell-web/test/materialBaselines.browser.test.js"
  ]);
  assert.deepEqual(switchedBrowserTestFiles({}), []);
});

test("CI's browser job and test:material-baselines run npm run test:browser, which refuses a run with no switch set", () => {
  const { scripts } = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(scripts["test:browser"], "node ./scripts/test-browser.mjs");
  assert.equal(scripts["test:material-baselines"], "JSKIT_MATERIAL_BASELINES=1 node ./scripts/test-browser.mjs");
  const workflow = readFileSync(".github/workflows/verify.yml", "utf8");
  const job = workflow.slice(workflow.indexOf("\n  browser-contracts:"), workflow.indexOf("\n  browser-database:"));
  assert.doesNotMatch(job, /jskit test/u);
  assert.equal(job.match(/^ +run: npm run test:browser$/gmu)?.length, 23);

  const { status, stderr } = spawnSync(process.execPath, ["./scripts/test-browser.mjs"], { encoding: "utf8", env: { PATH: process.env.PATH } });
  assert.notEqual(status, 0);
  assert.match(stderr, /test:browser found no browser test file whose switch is set: set one of JSKIT_[A-Z_]+, /u);
});
