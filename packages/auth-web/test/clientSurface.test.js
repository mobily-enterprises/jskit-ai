import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import packageJson from "../package.json" with { type: "json" };

const packageMetadata = packageJson.jskit;
// The auth screens' behavior without their look, which the Default views render in Material 3 and an app with its own
// design system renders in its own.
const PUBLIC_COMPOSABLES = Object.freeze([
  "useLoginView",
  "useResetPasswordView",
  "useEmailChangeView",
  "useSignOutView",
  "useSecondFactorProof",
  "useSecondFactorSettings",
  "useSecondFactorStepUp"
]);
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

test("auth-web's useLoginView composes login view state, validation, and actions", () => {
  const useLoginViewPath = fileURLToPath(new URL("../src/client/composables/useLoginView.js", import.meta.url));
  const useLoginViewSource = readFileSync(useLoginViewPath, "utf8");

  assert.match(useLoginViewSource, /import\s+\{\s*useLoginViewState\s*\}\s+from\s+"\.\/loginView\/useLoginViewState\.js";/);
  assert.match(useLoginViewSource, /import\s+\{\s*useLoginViewValidation\s*\}\s+from\s+"\.\/loginView\/useLoginViewValidation\.js";/);
  assert.match(useLoginViewSource, /import\s+\{\s*useLoginViewActions\s*\}\s+from\s+"\.\/loginView\/useLoginViewActions\.js";/);
  assert.match(useLoginViewSource, /const\s+state\s*=\s*useLoginViewState\(/);
  assert.match(useLoginViewSource, /const\s+validation\s*=\s*useLoginViewValidation\(\s*\{\s*state\s*\}\s*\)/);
  assert.match(useLoginViewSource, /const\s+actions\s*=\s*useLoginViewActions\(/);
  assert.doesNotMatch(useLoginViewSource, /useDefaultLoginView/);
  assert.match(useLoginViewSource, /export\s+\{\s*useLoginView\s*\};/);
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
  assert.match(widgetSource, /<v-btn v-else v-bind="props" icon variant="text" class="auth-profile-widget__activator" :aria-label="compactName">/u);
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
  for (const [name, card] of [
    ["DefaultLoginView", "auth-card"],
    ["DefaultResetPasswordView", "reset-card"],
    ["DefaultSignOutView", "signout-card"],
    ["DefaultEmailChangeView", "email-change-card"]
  ]) {
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

test("auth-web package exports its views, the composables behind them, and minimal client runtime subpaths", () => {
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
    exportsMap["./client/views/DefaultEmailChangeView"],
    "./src/client/views/DefaultEmailChangeView.vue"
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
  assert.equal(exportsMap["./client/runtime/secondFactorRequests"], "./src/client/runtime/secondFactorRequests.js");
  // Each public composable is src/client/composables/<name>.js, exported as ./client/composables/<name>.
  for (const name of PUBLIC_COMPOSABLES) {
    assert.equal(exportsMap[`./client/composables/${name}`], `./src/client/composables/${name}.js`, name);
  }
  assert.equal(exportsMap["./client/composables/useDefaultLoginView"], undefined);
  assert.equal(exportsMap["./client/composables/useDefaultSignOutView"], undefined);
  assert.equal(exportsMap["./client/runtime/useLoginView"], undefined);
  assert.equal(exportsMap["./client/views/AuthProfileWidget"], undefined);
  assert.equal(exportsMap["./client/views/AuthProfileMenuLinkItem"], undefined);
});

test("default reset password view preserves recovery session-pair callback tokens", () => {
  const viewPath = fileURLToPath(new URL("../src/client/composables/useResetPasswordView.js", import.meta.url));
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
  const viewPath = fileURLToPath(new URL("../src/client/composables/useLoginView.js", import.meta.url));
  const viewSource = readFileSync(viewPath, "utf8");

  assert.match(viewSource, /oauthLaunchClient: useAuthOAuthLaunchClient\(\)/);
});

// One owner of each screen's behavior: the Material views and the second-factor components import the very file the
// package exports, so an app's own view and JSKIT's default run the same code.
test("the Material auth views consume the public composables, not copies of them", () => {
  const exportsMap = packageJson.exports;
  const consumers = [
    ["DefaultLoginView", "useLoginView"],
    ["DefaultResetPasswordView", "useResetPasswordView"],
    ["DefaultEmailChangeView", "useEmailChangeView"],
    ["DefaultSignOutView", "useSignOutView"],
    ["SecondFactorProofForm", "useSecondFactorProof"],
    ["SecondFactorSettings", "useSecondFactorSettings"]
  ];
  for (const [view, composable] of consumers) {
    const source = readFileSync(fileURLToPath(new URL(`../src/client/views/${view}.vue`, import.meta.url)), "utf8");
    const imported = source.match(new RegExp(`import \\{ ${composable} \\} from "([^"]+)";`, "u"))?.[1];
    assert.ok(imported, `${view} imports ${composable}`);
    const importedFile = new URL(imported, new URL(`../src/client/views/${view}.vue`, import.meta.url)).href;
    const exportedFile = new URL(exportsMap[`./client/composables/${composable}`], new URL("../", import.meta.url)).href;
    assert.equal(importedFile, exportedFile, `${view} renders the exported ${composable}`);
  }
  const prompt = readFileSync(fileURLToPath(new URL("../src/client/views/SecondFactorPrompt.vue", import.meta.url)), "utf8");
  assert.match(prompt, /import \{ verifySecondFactor \} from "\.\.\/runtime\/secondFactorRequests\.js";/u);
});

// An app without Vuetify's plugin, or with its own design system, calls these composables: nothing behind them reads
// Vuetify (the Material views read the window size from Vuetify themselves).
test("the public composables and the code behind them import nothing from Vuetify", () => {
  const files = [
    ...PUBLIC_COMPOSABLES.map((name) => `../src/client/composables/${name}.js`),
    ...readdirSync(fileURLToPath(new URL("../src/client/composables/loginView/", import.meta.url))).map((name) => `../src/client/composables/loginView/${name}`),
    "../src/client/runtime/secondFactorRequests.js"
  ];
  for (const file of files) {
    assert.doesNotMatch(readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8"), /from "vuetify/u, file);
  }
});

// The own-design-sign-in pattern is an application's code: it reaches auth-web only through the subpaths the package
// exports, and draws its screens with plain elements, no Vuetify component or Material class.
test("the own-design-sign-in pattern uses only auth-web's exported subpaths and no Vuetify", () => {
  const exportsMap = packageJson.exports;
  const example = new URL("../patterns/own-design-sign-in/example/src/", import.meta.url);
  for (const file of ["views/auth/LoginView.vue", "components/ConfirmItsYouDialog.vue"]) {
    const source = readFileSync(fileURLToPath(new URL(file, example)), "utf8");
    const imports = [...source.matchAll(/from "(@jskit-ai\/auth-web[^"]*)"/gu)].map((match) => match[1]);
    assert.ok(imports.length > 0, file);
    for (const specifier of imports) {
      assert.ok(Object.hasOwn(exportsMap, specifier.replace("@jskit-ai/auth-web", ".")), `${file} imports ${specifier}`);
    }
    assert.doesNotMatch(source, /from "vuetify|<v-[a-z]|class="(?:[^"]*\s)?v-/u, file);
  }
});

// An application with its own design system keeps these views and gives them its own button, dialog and type classes
// through shell-web's UI kit (`provideShellUi`); without one they draw Material 3. So each view draws its buttons with
// the kit's Button, its dialog with the kit's Dialog and its text with the kit's text classes, never a Vuetify button,
// dialog or Material type class of its own. Sign-in's Sign in and Register segmented button is the one exception: it is
// a choice between two modes, not a button, and stays Vuetify's.
test("the auth screens draw their buttons, dialog and type through shell-web's UI kit", () => {
  const views = [
    "DefaultLoginView",
    "DefaultResetPasswordView",
    "DefaultEmailChangeView",
    "DefaultSignOutView",
    "SecondFactorDialog",
    "SecondFactorPrompt",
    "SecondFactorProofForm",
    "SecondFactorProofFields",
    "SecondFactorSettings"
  ];
  for (const view of views) {
    const source = readFileSync(fileURLToPath(new URL(`../src/client/views/${view}.vue`, import.meta.url)), "utf8");
    const buttons = [...source.matchAll(/<v-btn\b[^>]*>/gu)].map(([tag]) => tag);
    if (view === "DefaultLoginView") {
      assert.equal(buttons.length, 2, `${view}: only the Sign in and Register segments are Vuetify buttons`);
      for (const tag of buttons) assert.match(tag, /mode-switch__segment/u, tag);
    } else {
      assert.deepEqual(buttons, [], `${view} draws no Vuetify button`);
    }
    assert.doesNotMatch(source, /<v-dialog\b/u, `${view} draws no Vuetify dialog`);
    assert.doesNotMatch(source, /\btext-(?:display|headline|title|body|label)-(?:large|medium|small)\b/u, `${view} has no Material type class`);
  }
  for (const view of views.filter((name) => name !== "SecondFactorProofFields")) {
    const source = readFileSync(fileURLToPath(new URL(`../src/client/views/${view}.vue`, import.meta.url)), "utf8");
    assert.match(source, /import \{ useShellUi \} from "@jskit-ai\/shell-web\/client\/ui";/u, `${view} reads the kit`);
  }
  const dialog = readFileSync(fileURLToPath(new URL("../src/client/views/SecondFactorDialog.vue", import.meta.url)), "utf8");
  assert.match(dialog, /<UiDialog\b[^>]*:open="open"[^>]*:title="t\('jskit\.auth\.secondFactor\.prompt\.title'\)"/u);
  assert.match(dialog, /<template #actions>/u);
  // The dialog's Confirm sits in its actions, outside the form, and submits it by the form's id.
  assert.match(dialog, /<UiButton\b[^>]*type="submit"[^>]*:form="formId"/u);
});
