import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("auth-web client index defines provider-based client routes surface", () => {
  const source = readFileSync(fileURLToPath(new URL("../src/client/index.js", import.meta.url)), "utf8");

  assert.equal(source.includes('export { useAuthStore } from "./stores/useAuthStore.js";'), true);
  assert.equal(source.includes('export { useAuthGuardRuntime } from "./runtime/inject.js";'), true);
  assert.equal(source.includes('export {\n  completeOAuthCallbackFromCurrentLocation,\n  completeOAuthCallbackFromUrl,\n  readOAuthCallbackParamsFromUrl\n} from "./runtime/oauthCallbackRuntime.js";'), true);
  assert.equal(source.includes('export { useAuth } from "./composables/useAuth.js";'), false);
  assert.equal(source.includes("const routeComponents = Object.freeze({"), true);
  assert.equal(source.includes('"auth-login": DefaultLoginView'), true);
  assert.equal(source.includes('"auth-signout": DefaultSignOutView'), true);
  assert.equal(source.includes('"auth-default-login": DefaultLoginView'), true);
  assert.equal(source.includes("const clientProviders = Object.freeze([AuthWebClientProvider]);"), true);
  assert.equal(source.includes("async function bootClient(context) {"), false);
  assert.equal(source.includes("export { routeComponents, clientProviders };"), true);
});
