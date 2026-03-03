import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import { createCliRunner } from "../../testUtils/runCli.js";

const CLI_PATH = fileURLToPath(new URL("../bin/jskit.js", import.meta.url));
const runCli = createCliRunner(CLI_PATH);

test("show package renders grouped file write plan from descriptor mutations", () => {
  const result = runCli({
    cwd: path.resolve(path.dirname(CLI_PATH), ".."),
    args: ["show", "auth-web"]
  });

  assert.equal(result.status, 0, String(result.stderr || ""));
  const stdout = String(result.stdout || "");
  assert.match(stdout, /File writes \(/);
  assert.match(stdout, /UI routes \(/);
  assert.match(stdout, /\/auth\/login \(global\) Public login route for authentication flows\. \(id:auth-login\)/);
  assert.match(stdout, /Server routes \(/);
  assert.match(stdout, /GET \/api\/session: Get current session status and CSRF token/);
  assert.match(stdout, /src\/views\/auth\/LoginView\.vue \(id:auth-view-login\):\n\s+Install minimal login container/);
  assert.match(stdout, /src\/views\/auth\/SignOutView\.vue \(id:auth-view-signout\):\n\s+Install minimal sign-out container/);
});

test("show package --details renders expanded capability graph details", () => {
  const result = runCli({
    cwd: path.resolve(path.dirname(CLI_PATH), ".."),
    args: ["show", "auth-web", "--details"]
  });

  assert.equal(result.status, 0, String(result.stderr || ""));
  const stdout = String(result.stdout || "");
  assert.match(stdout, /Capability details:/);
  assert.match(stdout, /Provides detail \(/);
  assert.match(stdout, /Requires detail \(/);
  assert.match(stdout, /auth\.provider/);
  assert.match(stdout, /@jskit-ai\/auth-provider-supabase-core@0\.1\.0/);
});
