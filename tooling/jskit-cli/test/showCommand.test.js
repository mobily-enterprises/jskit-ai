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
  assert.match(stdout, /\/auth\/login \(global\) \[advisory\] Public login route for authentication flows\. \(id:auth\.login\)/);
  assert.match(stdout, /Server routes \(/);
  assert.match(stdout, /GET \/api\/session: Get current session status and CSRF token/);
  assert.match(stdout, /Summary:/);
  assert.match(
    stdout,
    /@jskit-ai\/auth-web\/client:\n\s+Exports auth web client runtime\/views\/composables and AuthWebClientProvider\./
  );
  assert.match(stdout, /Container tokens -- app\.make\('\.\.\.'\):/);
  assert.match(stdout, /server: auth\.web\.service/);
  assert.match(stdout, /Placement outlets \(accepted slots\) \(\d+\):/);
  assert.match(stdout, /avatar\.primary-menu/);
  assert.match(stdout, /Placement contributions \(default entries\) \(\d+\):/);
  assert.match(stdout, /auth\.profile\.widget/);
  assert.match(stdout, /auth\.profile\.menu\.sign-out/);
  assert.match(stdout, /Package exports \(/);
  assert.match(stdout, /- \.\/server\s+\[ok\]/);
  assert.doesNotMatch(stdout, /\.\/server -> \.\/src\/server\/index\.js/);
  assert.match(stdout, /\.\/client\/views\/DefaultLoginView -> \.\/src\/client\/views\/DefaultLoginView\.vue/);
  assert.doesNotMatch(stdout, /Exported symbols from index files \(/);
  assert.match(stdout, /Container bindings server \(/);
  assert.match(stdout, /auth\.web\.service/);
  assert.match(stdout, /Container bindings client \(/);
  assert.match(stdout, /auth\.login\.component/);
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
  assert.match(stdout, /Package exports \(/);
  assert.match(stdout, /providers \(\d+\):/);
  assert.doesNotMatch(stdout, /named re-exports \(\d+\):/);
});

test("show package --debug-exports includes re-export provenance details", () => {
  const result = runCli({
    cwd: path.resolve(path.dirname(CLI_PATH), ".."),
    args: ["show", "http-runtime", "--debug-exports"]
  });

  assert.equal(result.status, 0, String(result.stderr || ""));
  const stdout = String(result.stdout || "");
  assert.match(stdout, /Package exports \(/);
  assert.match(stdout, /re-export sources:/);
  assert.match(stdout, /named re-exports \(\d+\):/);
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
  assert.ok(payload.packageExports.some((record) => record.subpath === "./server" && record.target === "./src/server/index.js"));

  const containerBindings = payload.containerBindings || {};
  const serverBindings = Array.isArray(containerBindings.server) ? containerBindings.server : [];
  const clientBindings = Array.isArray(containerBindings.client) ? containerBindings.client : [];
  assert.ok(serverBindings.some((record) => record.token === "contracts.http"));
  assert.ok(clientBindings.some((record) => record.token === "contracts.http.client"));

  assert.ok(Array.isArray(payload.exportedSymbols));
  assert.ok(payload.exportedSymbols.some((record) => record.file === "src/server/index.js"));
  assert.ok(payload.exportedSymbols.some((record) => record.file === "src/client/index.js"));
  const clientIndex = payload.exportedSymbols.find((record) => record.file === "src/client/index.js");
  assert.ok(clientIndex);
  assert.deepEqual(clientIndex.starReExports, []);
  assert.ok(Array.isArray(clientIndex.namedReExports));
  assert.ok(clientIndex.namedReExports.includes("../shared/clientRuntime/client.js"));
});

test("show package --json includes symbol summaries for direct export files", () => {
  const result = runCli({
    cwd: path.resolve(path.dirname(CLI_PATH), ".."),
    args: ["show", "auth-provider-supabase-core", "--json"]
  });

  assert.equal(result.status, 0, String(result.stderr || ""));
  const payload = JSON.parse(String(result.stdout || "{}"));
  const exportedSymbols = Array.isArray(payload.exportedSymbols) ? payload.exportedSymbols : [];
  const providerExport = exportedSymbols.find(
    (record) => record && record.file === "src/server/providers/AuthSupabaseServiceProvider.js"
  );
  assert.ok(providerExport);
  const symbols = Array.isArray(providerExport.symbols) ? providerExport.symbols : [];
  assert.ok(symbols.includes("AuthSupabaseServiceProvider"));
});
