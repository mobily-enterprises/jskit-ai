import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

// The child starts its own fixture server and Chromium; 120 s stops a hung one long before the file's bound.
const options = { skip: process.env.JSKIT_ASSISTANT_RUNTIME_BROWSER_INTEGRATION !== "1", timeout: 120_000 };
const LATE_ROUTE_HANDLER = fileURLToPath(new URL("../fixtures/route-teardown/lateRouteHandler.mjs", import.meta.url));

/** Runs one test file in a `node --test` process of its own, as a run does, and answers its exit code and output. */
function runTestFile(file) {
  // NODE_TEST_CONTEXT would make the child report to this runner instead of printing its own results.
  const { NODE_TEST_CONTEXT: _parentRunner, ...env } = process.env;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--test", "--test-reporter=spec", file], { env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, output }));
  });
}

// A route handler still running when its test ends (a re-read the app started, a fetched response not yet read) met
// the context the fixture closed, threw after the test, and failed the whole file with no test to own the error
// ("apiResponse.json: Response has been disposed", blamed on the fixture's beforeEach, in which Chromium started).
test("a route handler still running when its test ends fails nothing after it: the shared fixture unroutes before closing", options, async () => {
  const { code, output } = await runTestFile(LATE_ROUTE_HANDLER);
  assert.doesNotMatch(output, /generated asynchronous activity after the test ended|Response has been disposed/u, output);
  assert.match(output, /^ℹ pass 1$/mu, output);
  assert.equal(code, 0, output);
});
