import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("auth-web client index defines module boot hook and client routes", () => {
  const source = readFileSync(fileURLToPath(new URL("../src/client/index.js", import.meta.url)), "utf8");

  assert.equal(source.includes("const routeComponents = Object.freeze({"), true);
  assert.equal(source.includes('"auth-login": DefaultLoginView'), true);
  assert.equal(source.includes('"auth-signout": DefaultSignOutView'), true);
  assert.equal(source.includes("const clientProviders = Object.freeze([AuthWebClientProvider]);"), true);
  assert.equal(source.includes("async function bootClient(context) {"), true);
  assert.equal(source.includes('initializeAuthGuardRuntime({ loginRoute: "/auth/login" })'), false);
  assert.equal(source.includes("export { routeComponents, clientProviders, bootClient };"), true);
});
