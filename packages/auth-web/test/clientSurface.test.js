import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import descriptor from "../package.descriptor.mjs";
import {
  useSignOut as fromRuntimeUseSignOut,
  createSignOutAction as fromRuntimeCreateSignOutAction,
  performSignOutRequest as fromRuntimePerformSignOutRequest
} from "../src/client/runtime/useSignOut.js";

test("auth-web descriptor declares auth surface ui routes", () => {
  const uiRoutes = Array.isArray(descriptor?.metadata?.ui?.routes) ? descriptor.metadata.ui.routes : [];
  const authRoutes = uiRoutes.filter((route) => String(route?.path || "").startsWith("/auth/"));

  assert.equal(authRoutes.length >= 2, true);
  for (const route of authRoutes) {
    assert.equal(String(route?.scope || "").trim().toLowerCase(), "surface");
    assert.equal(String(route?.surface || "").trim().toLowerCase(), "auth");
    assert.equal(String(route?.guard?.policy || "").trim().toLowerCase(), "public");
  }
});

test("auth-web auth page templates declare public route guard", () => {
  const loginTemplatePath = fileURLToPath(new URL("../templates/src/pages/auth/login.vue", import.meta.url));
  const signOutTemplatePath = fileURLToPath(new URL("../templates/src/pages/auth/signout.vue", import.meta.url));
  const loginTemplateSource = readFileSync(loginTemplatePath, "utf8");
  const signOutTemplateSource = readFileSync(signOutTemplatePath, "utf8");

  assert.match(loginTemplateSource, /"guard"\s*:\s*\{\s*"policy"\s*:\s*"public"\s*\}/);
  assert.match(signOutTemplateSource, /"guard"\s*:\s*\{\s*"policy"\s*:\s*"public"\s*\}/);
});

test("auth-web exports runtime signout helpers directly", () => {
  assert.equal(typeof fromRuntimeUseSignOut, "function");
  assert.equal(typeof fromRuntimeCreateSignOutAction, "function");
  assert.equal(typeof fromRuntimePerformSignOutRequest, "function");
});

test("auth-web removes copied client wrapper modules", () => {
  const removedFiles = [
    "../src/client/composables/authHttpClient.js",
    "../src/client/composables/authGuardRuntime.js",
    "../src/client/composables/useSignOut.js",
    "../src/client/api/AuthHttpClient.js"
  ];

  for (const relativePath of removedFiles) {
    const absolutePath = fileURLToPath(new URL(relativePath, import.meta.url));
    assert.equal(existsSync(absolutePath), false, `${relativePath} must not exist.`);
  }
});

test("auth-web runtime/useLoginView composes login view state, validation, and actions", () => {
  const runtimeUseLoginViewPath = fileURLToPath(new URL("../src/client/runtime/useLoginView.js", import.meta.url));
  const runtimeUseLoginViewSource = readFileSync(runtimeUseLoginViewPath, "utf8");

  assert.match(runtimeUseLoginViewSource, /import\s+\{\s*useLoginViewState\s*\}\s+from\s+"..\/composables\/loginView\/useLoginViewState\.js";/);
  assert.match(runtimeUseLoginViewSource, /import\s+\{\s*useLoginViewValidation\s*\}\s+from\s+"..\/composables\/loginView\/useLoginViewValidation\.js";/);
  assert.match(runtimeUseLoginViewSource, /import\s+\{\s*useLoginViewActions\s*\}\s+from\s+"..\/composables\/loginView\/useLoginViewActions\.js";/);
  assert.match(runtimeUseLoginViewSource, /const\s+state\s*=\s*useLoginViewState\(/);
  assert.match(runtimeUseLoginViewSource, /const\s+validation\s*=\s*useLoginViewValidation\(\s*\{\s*state\s*\}\s*\)/);
  assert.match(runtimeUseLoginViewSource, /const\s+actions\s*=\s*useLoginViewActions\(/);
  assert.doesNotMatch(runtimeUseLoginViewSource, /useDefaultLoginView/);
  assert.match(runtimeUseLoginViewSource, /export\s+\{\s*useLoginView\s*\};/);
});

test("auth-web package exports only minimal client runtime/view subpaths", () => {
  const packageJson = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"));
  const exportsMap = packageJson && typeof packageJson === "object" ? packageJson.exports : {};

  assert.equal(
    exportsMap["./client/views/DefaultLoginView"],
    "./src/client/views/DefaultLoginView.vue"
  );
  assert.equal(
    exportsMap["./client/views/DefaultSignOutView"],
    "./src/client/views/DefaultSignOutView.vue"
  );
  assert.equal(
    exportsMap["./client/runtime/authGuardRuntime"],
    "./src/client/runtime/authGuardRuntime.js"
  );
  assert.equal(
    exportsMap["./client/runtime/authHttpClient"],
    "./src/client/runtime/authHttpClient.js"
  );
  assert.equal(exportsMap["./client/runtime/useSignOut"], "./src/client/runtime/useSignOut.js");
  assert.equal(exportsMap["./client/composables/useDefaultLoginView"], undefined);
  assert.equal(exportsMap["./client/composables/useDefaultSignOutView"], undefined);
  assert.equal(exportsMap["./client/runtime/useLoginView"], undefined);
  assert.equal(exportsMap["./client/views/AuthProfileWidget"], undefined);
  assert.equal(exportsMap["./client/views/AuthProfileMenuLinkItem"], undefined);
});
