import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
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
  const stdout = stripVTControlCharacters(String(result.stdout || ""));
  assert.match(stdout, /File writes \(/);
  assert.match(stdout, /UI routes \(/);
  assert.match(stdout, /\/auth\/login \((surface|global)\) \[advisory\] Public login route for authentication flows\. \(id:auth\.login\)/);
  assert.match(stdout, /Server routes \(/);
  assert.match(stdout, /GET \/api\/session: Get current session status and CSRF token/);
  assert.match(stdout, /Summary:/);
  assert.match(
    stdout,
    /@jskit-ai\/auth-web\/client:\n\s+Exports auth web client provider, default auth views, and route\/provider registration surface\./
  );
  assert.match(stdout, /Container tokens -- app\.make\('\.\.\.'\):/);
  assert.match(stdout, /server: auth\.web\.service/);
  assert.match(stdout, /Placement outlets \(\d+\):/);
  assert.match(stdout, /auth-profile-menu:primary-menu/);
  assert.match(stdout, /Placement contributions \(default entries\) \(\d+\):/);
  assert.match(stdout, /auth\.profile\.widget/);
  assert.match(stdout, /auth\.profile\.menu\.sign-out/);
  assert.match(stdout, /Code introspection:\n- Source files unavailable \(descriptor metadata only\)\./);
  assert.match(stdout, /Introspection notes \(\d+\):/);
  assert.match(stdout, /src\/views\/auth\/LoginView\.vue \(id:auth-view-login\):\n\s+Install minimal login container/);
  assert.match(stdout, /src\/views\/auth\/SignOutView\.vue \(id:auth-view-signout\):\n\s+Install minimal sign-out container/);
});

test("show package --details renders expanded capability graph details", () => {
  const result = runCli({
    cwd: path.resolve(path.dirname(CLI_PATH), ".."),
    args: ["show", "auth-web", "--details"]
  });

  assert.equal(result.status, 0, String(result.stderr || ""));
  const stdout = stripVTControlCharacters(String(result.stdout || ""));
  assert.match(stdout, /Capability details:/);
  assert.match(stdout, /Provides detail \(/);
  assert.match(stdout, /Requires detail \(/);
  assert.match(stdout, /auth\.provider/);
  assert.match(stdout, /@jskit-ai\/auth-provider-supabase-core@0\.\d+\.\d+/);
  assert.match(stdout, /providers \(\d+\):/);
  assert.match(stdout, /Code introspection:\n- Source files unavailable \(descriptor metadata only\)\./);
});

test("show package --debug-exports includes re-export provenance details", () => {
  const result = runCli({
    cwd: path.resolve(path.dirname(CLI_PATH), ".."),
    args: ["show", "http-runtime", "--debug-exports"]
  });

  assert.equal(result.status, 0, String(result.stderr || ""));
  const stdout = stripVTControlCharacters(String(result.stdout || ""));
  assert.match(stdout, /Code introspection:\n- Source files unavailable \(descriptor metadata only\)\./);
  assert.doesNotMatch(stdout, /Package exports \(/);
  assert.doesNotMatch(stdout, /re-export sources:/);
});

test("show package --json includes exports, container bindings, and exported symbols", () => {
  const result = runCli({
    cwd: path.resolve(path.dirname(CLI_PATH), ".."),
    args: ["show", "http-runtime", "--json"]
  });

  assert.equal(result.status, 0, String(result.stderr || ""));
  const payload = JSON.parse(String(result.stdout || "{}"));

  assert.equal(payload.packageId, "@jskit-ai/http-runtime");
  assert.ok(Array.isArray(payload.packageExports));
  assert.equal(payload.packageExports.length, 0);

  const containerBindings = payload.containerBindings || {};
  const serverBindings = Array.isArray(containerBindings.server) ? containerBindings.server : [];
  const clientBindings = Array.isArray(containerBindings.client) ? containerBindings.client : [];
  assert.equal(serverBindings.length, 0);
  assert.equal(clientBindings.length, 0);

  assert.ok(Array.isArray(payload.exportedSymbols));
  assert.equal(payload.exportedSymbols.length, 0);
  assert.equal(payload.introspection?.available, false);
});

test("show package --json includes symbol summaries for direct export files", () => {
  const result = runCli({
    cwd: path.resolve(path.dirname(CLI_PATH), ".."),
    args: ["show", "auth-provider-supabase-core", "--json"]
  });

  assert.equal(result.status, 0, String(result.stderr || ""));
  const payload = JSON.parse(String(result.stdout || "{}"));
  const exportedSymbols = Array.isArray(payload.exportedSymbols) ? payload.exportedSymbols : [];
  assert.equal(exportedSymbols.length, 0);
  assert.equal(payload.introspection?.available, false);
});
