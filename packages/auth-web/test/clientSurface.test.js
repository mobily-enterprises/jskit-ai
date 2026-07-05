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
  const resetRoute = authRoutes.find((route) => route.id === "auth.reset-password");

  assert.equal(authRoutes.length >= 2, true);
  for (const route of authRoutes) {
    assert.equal(String(route?.scope || "").trim().toLowerCase(), "surface");
    assert.equal(String(route?.surface || "").trim().toLowerCase(), "auth");
    assert.equal(String(route?.guard?.policy || "").trim().toLowerCase(), "public");
  }
  assert.equal(resetRoute?.autoRegister, false);
});

test("auth-web auth page templates declare public route guard", () => {
  const loginTemplatePath = fileURLToPath(new URL("../templates/src/pages/auth/login.vue", import.meta.url));
  const signOutTemplatePath = fileURLToPath(new URL("../templates/src/pages/auth/signout.vue", import.meta.url));
  const resetTemplatePath = fileURLToPath(new URL("../templates/src/pages/auth/reset-password.vue", import.meta.url));
  const loginTemplateSource = readFileSync(loginTemplatePath, "utf8");
  const signOutTemplateSource = readFileSync(signOutTemplatePath, "utf8");
  const resetTemplateSource = readFileSync(resetTemplatePath, "utf8");

  assert.match(loginTemplateSource, /"guard"\s*:\s*\{\s*"policy"\s*:\s*"public"\s*\}/);
  assert.match(signOutTemplateSource, /"guard"\s*:\s*\{\s*"policy"\s*:\s*"public"\s*\}/);
  assert.match(resetTemplateSource, /"guard"\s*:\s*\{\s*"policy"\s*:\s*"public"\s*\}/);
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

test("auth-web client provider registers a mobile auth callback completion token", () => {
  const providerPath = fileURLToPath(new URL("../src/client/providers/AuthWebClientProvider.js", import.meta.url));
  const providerSource = readFileSync(providerPath, "utf8");

  assert.match(providerSource, /auth\.mobile-callback\.client/);
  assert.match(providerSource, /completeOAuthCallbackFromUrl/);
});

test("default login view owns the viewport and becomes a full-screen mobile screen", () => {
  const viewPath = fileURLToPath(new URL("../src/client/views/DefaultLoginView.vue", import.meta.url));
  const viewSource = readFileSync(viewPath, "utf8");

  assert.match(viewSource, /import\s+\{\s*useDisplay\s*\}\s+from\s+"vuetify";/);
  assert.match(viewSource, /useDisplay\(\{\s*mobileBreakpoint:\s*960\s*\}\)/);
  assert.doesNotMatch(viewSource, /<v-main\b/);
  assert.match(viewSource, /login-screen--mobile/);
  assert.match(viewSource, /login-shell--mobile/);
  assert.match(viewSource, /auth-card--mobile/);
  assert.match(viewSource, /auth-content--mobile/);
  assert.match(viewSource, /:elevation="isMobileViewport \? 0 : 1"/);
  assert.match(viewSource, /:border="!isMobileViewport"/);
  assert.match(viewSource, /\.login-screen\s*\{[\s\S]*position:\s*fixed;/);
  assert.match(viewSource, /\.login-screen\s*\{[\s\S]*inset:\s*0;/);
});

test("default login view avoids decorative login chrome", () => {
  const viewPath = fileURLToPath(new URL("../src/client/views/DefaultLoginView.vue", import.meta.url));
  const constantsPath = fileURLToPath(new URL("../src/client/composables/loginView/constants.js", import.meta.url));
  const viewSource = readFileSync(viewPath, "utf8");
  const constantsSource = readFileSync(constantsPath, "utf8");

  assert.match(viewSource, /v-if="authTitle \|\| authSubtitle"/);
  assert.doesNotMatch(viewSource, /Jskit Workspace|JSKIT WORKSPACE|auth-kicker|>Secure</);
  assert.match(constantsSource, /\[LOGIN_MODE\]:\s*""/);
  assert.doesNotMatch(constantsSource, /\[LOGIN_MODE\]:\s*"Welcome"/);
  assert.doesNotMatch(constantsSource, /\[LOGIN_MODE\]:\s*"Sign in to continue\.?"/);
});

test("default login view gates password login controls by provider capabilities", () => {
  const viewPath = fileURLToPath(new URL("../src/client/views/DefaultLoginView.vue", import.meta.url));
  const validationPath = fileURLToPath(new URL("../src/client/composables/loginView/useLoginViewValidation.js", import.meta.url));
  const viewSource = readFileSync(viewPath, "utf8");
  const validationSource = readFileSync(validationPath, "utf8");

  assert.match(viewSource, /v-if="!isLogin \|\| canUsePasswordLogin"/);
  assert.match(viewSource, /v-if="\(isLogin && canUsePasswordLogin\) \|\| isRegister"/);
  assert.match(validationSource, /state\.isLogin\.value && !state\.canUsePasswordLogin\.value/);
});

test("auth-web package exports only minimal client runtime/view subpaths", () => {
  const packageJson = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"));
  const exportsMap = packageJson && typeof packageJson === "object" ? packageJson.exports : {};

  assert.equal(
    exportsMap["./client/views/DefaultLoginView"],
    "./src/client/views/DefaultLoginView.vue"
  );
  assert.equal(
    exportsMap["./client/views/DefaultResetPasswordView"],
    "./src/client/views/DefaultResetPasswordView.vue"
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
  assert.equal(
    exportsMap["./client/runtime/oauthCallbackRuntime"],
    "./src/client/runtime/oauthCallbackRuntime.js"
  );
  assert.equal(exportsMap["./client/runtime/useSignOut"], "./src/client/runtime/useSignOut.js");
  assert.equal(exportsMap["./client/composables/useDefaultLoginView"], undefined);
  assert.equal(exportsMap["./client/composables/useDefaultSignOutView"], undefined);
  assert.equal(exportsMap["./client/runtime/useLoginView"], undefined);
  assert.equal(exportsMap["./client/views/AuthProfileWidget"], undefined);
  assert.equal(exportsMap["./client/views/AuthProfileMenuLinkItem"], undefined);
});

test("default reset password view preserves recovery session-pair callback tokens", () => {
  const viewPath = fileURLToPath(new URL("../src/client/views/DefaultResetPasswordView.vue", import.meta.url));
  const viewSource = readFileSync(viewPath, "utf8");

  assert.match(viewSource, /readPasswordRecoveryCallbackPayloadFromUrl\(window\.location\.href\)/);
  assert.match(viewSource, /stripPasswordRecoveryCallbackParamsFromLocation\(\);/);
  assert.match(viewSource, /authPasswordResetCommand/);
  assert.match(viewSource, /validateCommandSection\(authPasswordResetCommand,\s*"body"/);
  assert.match(viewSource, /if \(!recoveryPayload\)\s*\{\s*status\.value = "ready";/);
  assert.doesNotMatch(viewSource, /if \(!recoveryPayload\)\s*\{\s*status\.value = "error";/);
  assert.doesNotMatch(viewSource, /hash\.get\("access_token"\)[\s\S]*code:/);
});
