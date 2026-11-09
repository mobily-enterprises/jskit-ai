import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import packageJson from "../package.json" with { type: "json" };

const packageMetadata = packageJson.jskit;
import {
  useSignOut as fromRuntimeUseSignOut,
  createSignOutAction as fromRuntimeCreateSignOutAction,
  performSignOutRequest as fromRuntimePerformSignOutRequest
} from "../src/client/runtime/useSignOut.js";

test("auth-web packageMetadata declares auth surface ui routes", () => {
  const uiRoutes = Array.isArray(packageMetadata?.metadata?.ui?.routes) ? packageMetadata.metadata.ui.routes : [];
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

test("auth-web client capability includes mobile callback completion", () => {
  const providerPath = fileURLToPath(new URL("../src/client/providers/AuthWebClientProvider.js", import.meta.url));
  const authClientPath = fileURLToPath(new URL("../src/client/runtime/authClient.js", import.meta.url));
  const providerSource = readFileSync(providerPath, "utf8");
  const authClientSource = readFileSync(authClientPath, "utf8");

  assert.match(providerSource, /auth: "client\.auth"/);
  assert.match(authClientSource, /mobileCallback/);
  assert.match(authClientSource, /completeOAuthCallbackFromUrl/);
});

test("auth profile activator keeps Material 3's 48dp touch target without a fixed height", () => {
  const widgetPath = fileURLToPath(new URL("../src/client/views/AuthProfileWidget.vue", import.meta.url));
  const widgetSource = readFileSync(widgetPath, "utf8");

  assert.match(widgetSource, /class="auth-profile-widget__activator text-none pl-1 pr-2"/);
  // Without the name, up to medium width, the activator is an icon button, so its state layer is a circle round the
  // avatar; the name shows on expanded windows only, through the shell's window size classes.
  assert.match(widgetSource, /const showsName = computed\(\(\) => isExpanded\.value \|\| isLarge\.value\);/u);
  assert.match(widgetSource, /<v-btn v-else v-bind="props" icon variant="text" class="auth-profile-widget__activator" :aria-label="displayName">/u);
  // material-web gives every default-size button a 48dp touch target around its 40dp body; a fixed height would
  // make the button itself taller than Material 3 draws it.
  assert.doesNotMatch(widgetSource, /min-height/u);
  assert.doesNotMatch(widgetSource, /<v-btn[^>]*auth-profile-widget__activator[^>]*\ssize=/u);
});

test("the auth views fill the viewport through AuthScreen: a card on wide windows, the whole screen on phones", () => {
  const read = (name) => readFileSync(fileURLToPath(new URL(`../src/client/views/${name}.vue`, import.meta.url)), "utf8");
  const screen = read("AuthScreen");
  assert.match(screen, /useDisplay\(\{\s*mobileBreakpoint:\s*960\s*\}\)/);
  assert.match(screen, /\.auth-screen\s*\{[\s\S]*position:\s*fixed;/);
  // The full-viewport screen starts below shell banners shown on this bar-less surface.
  assert.match(screen, /\.auth-screen\s*\{[\s\S]*inset:\s*var\(--shell-error-banners-inline-height, 0px\) 0 0;/);
  assert.doesNotMatch(screen, /min-height:\s*100dvh/);
  for (const [name, card] of [["DefaultLoginView", "auth-card"], ["DefaultResetPasswordView", "reset-card"], ["DefaultSignOutView", "signout-card"]]) {
    const view = read(name);
    assert.match(view, /<AuthScreen\b/, name);
    // The app's brand slot reaches the screen's pane and row.
    assert.match(view, /<template v-if="\$slots\.brand" #brand="brand">\s*<slot name="brand" v-bind="brand" \/>/, name);
    assert.doesNotMatch(view, /<v-main\b|position:\s*fixed/, name);
    assert.match(view, new RegExp(`${card}--mobile`), name);
    // One container treatment: the card's tone against the screen, with no shadow or outline over it.
    assert.match(view, /<v-card\b[^>]*\svariant="flat"/, name);
    assert.doesNotMatch(view, /:?elevation=/, name);
    // An elevated Material 3 card on wide windows, the whole screen on phones; never an outlined one.
    assert.doesNotMatch(view, /:border=|\sborder(?=[\s>])/, name);
    // Each has its one h1.
    assert.equal((view.match(/<h1\b/gu) || []).length, 1, name);
  }
});

test("default login view avoids decorative login chrome", () => {
  const viewPath = fileURLToPath(new URL("../src/client/views/DefaultLoginView.vue", import.meta.url));
  const constantsPath = fileURLToPath(new URL("../src/client/composables/loginView/constants.js", import.meta.url));
  const viewSource = readFileSync(viewPath, "utf8");
  const constantsSource = readFileSync(constantsPath, "utf8");

  assert.match(viewSource, /v-if="authTitle \|\| authSubtitle"/);
  assert.doesNotMatch(viewSource, /Jskit Workspace|JSKIT WORKSPACE|auth-kicker|>Secure</);
  // Sign-in has its one h1 ("Sign in") and no tagline.
  assert.match(constantsSource, /AUTH_TITLE_BY_MODE = Object\.freeze\(\{\s*\[LOGIN_MODE\]:\s*"jskit\.auth\.login\.title\.login"/);
  assert.match(constantsSource, /AUTH_SUBTITLE_BY_MODE = Object\.freeze\(\{\s*\[LOGIN_MODE\]:\s*""/);
  assert.doesNotMatch(constantsSource, /\[LOGIN_MODE\]:\s*"Welcome"/);
  assert.doesNotMatch(constantsSource, /\[LOGIN_MODE\]:\s*"Sign in to continue\.?"/);
});

test("default login view's action rows wrap, so a phone shows every action instead of clipping the last", () => {
  const viewSource = readFileSync(fileURLToPath(new URL("../src/client/views/DefaultLoginView.vue", import.meta.url)), "utf8");
  const rows = [...viewSource.matchAll(/class="((?:switch-row|aux-links)\b[^"]*)"/gu)].map(([, classes]) => classes);

  assert.equal(rows.filter((classes) => classes.startsWith("switch-row")).length, 3);
  for (const classes of rows.filter((entry) => entry.startsWith("switch-row"))) {
    assert.match(classes, /\bflex-wrap\b/u, classes);
    assert.match(classes, /\bga-3\b/u, classes);
  }
  assert.match(rows.find((classes) => classes.startsWith("aux-links")), /\bflex-wrap\b/u);
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
  const viewPath = fileURLToPath(new URL("../src/client/composables/useDefaultResetPasswordView.js", import.meta.url));
  const viewSource = readFileSync(viewPath, "utf8");

  assert.match(viewSource, /readPasswordRecoveryCallbackPayloadFromUrl\(window\.location\.href\)/);
  assert.match(viewSource, /stripPasswordRecoveryCallbackParamsFromLocation\(\);/);
  assert.match(viewSource, /authPasswordResetCommand/);
  assert.match(viewSource, /validateCommandSection\(authPasswordResetCommand,\s*"body"/);
  assert.match(viewSource, /if \(!recoveryPayload\)\s*\{\s*status\.value = "ready";/);
  assert.doesNotMatch(viewSource, /if \(!recoveryPayload\)\s*\{\s*status\.value = "error";/);
  assert.doesNotMatch(viewSource, /hash\.get\("access_token"\)[\s\S]*code:/);
});

test("default login view hands its OAuth buttons the launch client", () => {
  const viewPath = fileURLToPath(new URL("../src/client/runtime/useLoginView.js", import.meta.url));
  const viewSource = readFileSync(viewPath, "utf8");

  assert.match(viewSource, /oauthLaunchClient: useAuthOAuthLaunchClient\(\)/);
});
