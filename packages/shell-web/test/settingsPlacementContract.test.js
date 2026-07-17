import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { assertGeneratedUiSourceContract } from "@jskit-ai/kernel/shared/support/generatedUiContract";
import descriptor from "../package.descriptor.mjs";
import { resolveShellRouteTransitionKey } from "../src/client/support/routeTransitionKey.js";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = path.resolve(TEST_DIRECTORY, "..");

function readOutlets(target = "") {
  const outlets = descriptor?.metadata?.ui?.placements?.outlets;
  const normalizedTarget = String(target || "").trim();
  return Array.isArray(outlets)
    ? outlets.filter((entry) => String(entry?.target || "").trim() === normalizedTarget)
    : [];
}

function readContributions(target = "") {
  const contributions = descriptor?.metadata?.ui?.placements?.contributions;
  const normalizedTarget = String(target || "").trim();
  return Array.isArray(contributions)
    ? contributions.filter((entry) => String(entry?.target || "").trim() === normalizedTarget)
    : [];
}

function readTopology(id = "", owner = "") {
  const placements = descriptor?.metadata?.ui?.placements?.topology?.placements;
  const normalizedId = String(id || "").trim();
  const normalizedOwner = String(owner || "").trim();
  return Array.isArray(placements)
    ? placements.filter((entry) =>
        String(entry?.id || "").trim() === normalizedId &&
        String(entry?.owner || "").trim() === normalizedOwner
      )
    : [];
}

function readPackageImportSpecifiers(source = "") {
  return Array.from(
    String(source || "").matchAll(/\bfrom\s+["'](@jskit-ai\/[^"']+)["']/gu),
    (match) => match[1]
  );
}

function readClientContainerTokens() {
  const tokens = descriptor?.metadata?.apiSummary?.containerTokens?.client;
  return Array.isArray(tokens) ? tokens : [];
}

function findFileMutation(id) {
  const files = descriptor?.mutations?.files;
  return Array.isArray(files)
    ? files.find((entry) => String(entry?.id || "").trim() === id) || null
    : null;
}

test("shell-web home settings template exposes surface-derived settings outlets", async () => {
  const source = await readFile(path.join(PACKAGE_DIR, "templates", "src", "pages", "home", "settings.vue"), "utf8");

  assert.match(source, /target="home-settings:primary-menu"/);
  assert.match(source, /generated-ui-screen generated-ui-screen--settings settings-shell/);
  assert.match(source, /--generated-ui-screen-title-size/);
  assert.doesNotMatch(source, /default-link-component-token/);
  assert.match(source, /<RouterView \/>/);
});

test("shell-web shell layout registers navigation at the app layout level", async () => {
  const source = await readFile(path.join(PACKAGE_DIR, "src", "client", "components", "ShellLayout.vue"), "utf8");

  assert.doesNotMatch(source, /<v-layout\b/);
  assert.doesNotMatch(source, /overflow-hidden/);
  assert.doesNotMatch(source, /min-height:\s*72vh/);
  assert.match(source, /ShellRouteTransition/);
  assert.match(source, /<ShellRouteTransition>[\s\S]*<slot \/>[\s\S]*<\/ShellRouteTransition>/);
  assert.match(source, /data-testid="jskit-shell-app-bar"/);
  assert.match(source, /:density="isCompactLayout \? 'compact' : 'comfortable'"/);
  assert.match(source, /shell-layout__surface-label/);
  assert.doesNotMatch(source, /shell-layout__surface-chip/);
  assert.doesNotMatch(source, /<v-chip[^>]*resolvedSurfaceLabel/);
  assert.match(source, /shell-layout__top-right[\s\S]*max-width:\s*min\(45vw, 18rem\)/);
  assert.match(source, /<v-bottom-navigation[\s\S]*target="shell-layout:primary-bottom-nav"/);
  assert.match(source, /<v-bottom-sheet[\s\S]*target="shell-layout:supporting-bottom-sheet"/);
  assert.match(source, /target="shell-layout:supporting-side-panel"/);
  assert.match(source, /data-testid="jskit-shell-supporting-bottom-sheet"/);
  assert.match(source, /data-testid="jskit-shell-supporting-side-panel"/);
  assert.match(source, /inject\("jskit\.shell-web\.runtime\.web-refresh\.client", null\)/);
  assert.match(source, /window\.addEventListener\("pointerdown", handlePullPointerDown/);
  assert.match(source, /window\.addEventListener\("touchmove", handlePullTouchMove/);
  assert.match(source, /refreshRuntime\.refresh\("pull-to-refresh"\)/);
  assert.match(source, /data-testid="jskit-shell-pull-refresh"/);
  assert.match(source, /target="shell-layout:primary-menu"[\s\S]*default/);
  assert.doesNotMatch(source, /target="shell-layout:primary-bottom-nav"[\s\S]*default/);
  assert.match(source, /data-testid="jskit-shell-drawer"/);
  assert.match(source, /data-testid="jskit-shell-bottom-nav"/);
  assert.match(source, /padding:\s*0\.75rem 1rem calc\(1rem \+ env\(safe-area-inset-bottom, 0px\)\)/);

  const template = await readFile(path.join(PACKAGE_DIR, "templates", "src", "components", "ShellLayout.vue"), "utf8");

  assert.match(template, /PackageShellLayout from "@jskit-ai\/shell-web\/client\/components\/ShellLayout"/);
  assert.match(template, /h\(PackageShellLayout, attrs, slots\)/);
  assert.doesNotMatch(template, /ShellOutlet|ShellRouteTransition|useShellLayoutState|pointerdown|v-navigation-drawer|v-bottom-navigation/);
});

test("shell-web error host uses one explicit close affordance for banner errors", async () => {
  const source = await readFile(path.join(PACKAGE_DIR, "src", "client", "components", "ShellErrorHost.vue"), "utf8");

  assert.match(source, /function resolveSeverityIcon/);
  assert.match(source, /mdi-alert-outline/);
  assert.match(source, /:icon="resolveSeverityIcon\(entry\.severity\)"/);
  assert.match(source, /closable[\s\S]*@click:close="dismiss\(entry\)"/);
  assert.doesNotMatch(source, /mdi-close/);
});

test("shell-web error host keeps snackbar color stable while closing", async () => {
  const source = await readFile(path.join(PACKAGE_DIR, "src", "client", "components", "ShellErrorHost.vue"), "utf8");

  assert.match(source, /displayedSnackbarEntry/);
  assert.match(source, /@after-leave="onSnackbarAfterLeave"/);
  assert.match(source, /:color="displayedSnackbarEntry \? resolveSeverityColor\(displayedSnackbarEntry\.severity\) : undefined"/);
  assert.doesNotMatch(source, /resolveSeverityColor\(snackbarEntry\?\.severity\)/);
});

test("shell-web error template uses intent-driven default presentation", async () => {
  const source = await readFile(path.join(PACKAGE_DIR, "templates", "src", "error.js"), "utf8");

  assert.match(source, /resourceLoadChannel:\s*"silent"/);
  assert.match(source, /actionFeedbackChannel:\s*"snackbar"/);
  assert.match(source, /appRecoverableChannel:\s*"banner"/);
  assert.match(source, /blockingChannel:\s*"dialog"/);
});

test("shell-web installs generated adaptive shell Playwright smoke coverage", async () => {
  const source = await readFile(path.join(PACKAGE_DIR, "templates", "tests", "e2e", "adaptive-shell.spec.ts"), "utf8");
  const helperSource = await readFile(path.join(PACKAGE_DIR, "src", "test", "adaptiveShellSmoke.js"), "utf8");

  assertGeneratedUiSourceContract(helperSource, {
    profile: "responsive-smoke",
    sourceName: "adaptiveShellSmoke.js"
  });
  assert.match(source, /runAdaptiveShellSmoke/);
  assert.match(source, /@jskit-ai\/shell-web\/test\/adaptiveShellSmoke/);
  assert.match(helperSource, /generated adaptive shell smoke/);
  assert.match(helperSource, /390/);
  assert.match(helperSource, /768/);
  assert.match(helperSource, /1280/);
  assert.match(helperSource, /jskit-shell-bottom-nav/);
  assert.match(helperSource, /jskit-shell-drawer/);
  assert.match(helperSource, /scrollWidth/);
  assert.match(helperSource, /toBeGreaterThanOrEqual\(48\)/);

  const packageJson = JSON.parse(await readFile(path.join(PACKAGE_DIR, "package.json"), "utf8"));
  assert.equal(packageJson?.exports?.["./test/adaptiveShellSmoke"], "./src/test/adaptiveShellSmoke.js");
});

test("shell-web exports async module recovery runtime access as a public client API", async () => {
  const packageJson = JSON.parse(await readFile(path.join(PACKAGE_DIR, "package.json"), "utf8"));
  const clientIndex = await readFile(path.join(PACKAGE_DIR, "src", "client", "index.js"), "utf8");
  const recoveryIndex = await readFile(
    path.join(PACKAGE_DIR, "src", "client", "asyncModuleRecovery", "index.js"),
    "utf8"
  );
  const providerSource = await readFile(
    path.join(PACKAGE_DIR, "src", "client", "providers", "ShellWebClientProvider.js"),
    "utf8"
  );

  assert.equal(
    packageJson?.exports?.["./client/asyncModuleRecovery"],
    "./src/client/asyncModuleRecovery/index.js"
  );
  assert.match(clientIndex, /useShellAsyncModuleRecoveryRuntime/);
  assert.match(clientIndex, /SHELL_ASYNC_MODULE_RECOVERY_RUNTIME_KEY/);
  assert.match(recoveryIndex, /useShellAsyncModuleRecoveryRuntime/);
  assert.match(recoveryIndex, /SHELL_ASYNC_MODULE_RECOVERY_RUNTIME_KEY/);
  assert.match(providerSource, /SHELL_ASYNC_MODULE_RECOVERY_RUNTIME_KEY/);
});

test("shell-web exports request recovery runtime access as a public client API", async () => {
  const packageJson = JSON.parse(await readFile(path.join(PACKAGE_DIR, "package.json"), "utf8"));
  const clientIndex = await readFile(path.join(PACKAGE_DIR, "src", "client", "index.js"), "utf8");
  const recoveryIndex = await readFile(
    path.join(PACKAGE_DIR, "src", "client", "requestRecovery", "index.js"),
    "utf8"
  );
  const providerSource = await readFile(
    path.join(PACKAGE_DIR, "src", "client", "providers", "ShellWebClientProvider.js"),
    "utf8"
  );

  assert.equal(
    packageJson?.exports?.["./client/requestRecovery"],
    "./src/client/requestRecovery/index.js"
  );
  assert.match(clientIndex, /useShellRequestRecoveryRuntime/);
  assert.match(clientIndex, /SHELL_REQUEST_RECOVERY_RUNTIME_KEY/);
  assert.match(recoveryIndex, /useShellRequestRecoveryRuntime/);
  assert.match(recoveryIndex, /SHELL_REQUEST_RECOVERY_RUNTIME_KEY/);
  assert.match(providerSource, /SHELL_REQUEST_RECOVERY_RUNTIME_KEY/);
});

test("shell-web route transition keeps mobile route motion placement-driven", async () => {
  const source = await readFile(
    path.join(PACKAGE_DIR, "src", "client", "components", "ShellRouteTransition.vue"),
    "utf8"
  );

  assert.match(source, /target:\s*\{[\s\S]*default:\s*"shell-layout:primary-bottom-nav"/);
  assert.match(source, /semanticTarget:\s*\{[\s\S]*default:\s*"shell\.primary-nav"/);
  assert.match(source, /placementRuntime\s*\.\s*getPlacements/);
  assert.match(source, /useRouter\(\)/);
  assert.match(source, /swipeEnabled:\s*\{[\s\S]*default:\s*true/);
  assert.match(source, /window\.addEventListener\("pointerdown", handlePointerDown/);
  assert.match(source, /document\.documentElement\.classList\.toggle\("shell-route-swipe-enabled", enabled\)/);
  assert.match(source, /navigateBySwipe\(deltaX < 0 \? 1 : -1\)/);
  assert.match(source, /router\.push\(nextEntry\.href\)/);
  assert.match(source, /isSwipeIgnoredTarget/);
  assert.match(source, /touch-action:\s*pan-y/);
  assert.match(source, /\.shell-route-transition\s*\{[\s\S]*display:\s*flex/);
  assert.match(source, /\.shell-route-transition\s*\{[\s\S]*min-height:\s*0/);
  assert.match(source, /\.shell-route-transition__pane\s*\{[\s\S]*flex:\s*1 1 auto/);
  assert.match(source, /\.shell-route-transition__pane\s*\{[\s\S]*min-height:\s*0/);
  assert.match(source, /transitionDirection\.value = nextIndex > previousIndex \? "forward" : "reverse"/);
  assert.match(
    source,
    /const routeTransitionKey = computed\(\(\) => \{[\s\S]*const routePathKey = routeTransitionName\.value[\s\S]*normalizeComparablePathname\(route\?\.path \|\| route\?\.fullPath \|\| "\/"\)[\s\S]*resolveShellRouteTransitionKey\(\{[\s\S]*routeTransitionName: routeTransitionName\.value,[\s\S]*surfaceId: currentSurfaceId\.value[\s\S]*\}\);[\s\S]*\}\);/
  );
  assert.match(source, /prefers-reduced-motion:\s*reduce/);
});

test("shell-web route transition key preserves no-motion surfaces and animated path transitions", () => {
  const previewSurfaceKey = "surface:vibe64-preview";
  assert.equal(
    resolveShellRouteTransitionKey({
      routeTransitionName: "",
      routePathKey: "/preview",
      surfaceId: "vibe64-preview"
    }),
    previewSurfaceKey
  );
  assert.equal(
    resolveShellRouteTransitionKey({
      routeTransitionName: "",
      routePathKey: "/preview/dashboard",
      surfaceId: "vibe64-preview"
    }),
    previewSurfaceKey
  );
  assert.equal(
    resolveShellRouteTransitionKey({
      routeTransitionName: "shell-route-slide-forward",
      routePathKey: "/dashboard",
      surfaceId: "home"
    }),
    "/dashboard"
  );
  assert.equal(
    resolveShellRouteTransitionKey({
      routeTransitionName: "",
      routePathKey: "/dashboard",
      surfaceId: "*"
    }),
    "stable"
  );
});

test("shell-web settings landing page redirects to the starter child page", async () => {
  const source = await readFile(path.join(PACKAGE_DIR, "templates", "src", "pages", "home", "settings", "index.vue"), "utf8");

  assert.match(source, /@jskit-ai\/kernel\/client\/pageRedirects/);
  assert.match(source, /definePage/);
  assert.match(source, /redirectToChild\("general"\)/);
});

test("shell-web settings general child page exposes an adaptive drawer preference", async () => {
  const source = await readFile(
    path.join(PACKAGE_DIR, "templates", "src", "pages", "home", "settings", "general", "index.vue"),
    "utf8"
  );

  assert.match(source, /useShellLayoutState/);
  assert.match(source, /generated-ui-screen generated-ui-screen--settings settings-general-screen/);
  assert.match(source, /drawerDefaultOpen/);
  assert.match(source, /setDrawerDefaultOpen/);
  assert.match(source, /Phone layouts keep primary navigation in the bottom bar/);
  assert.match(source, /Open drawer by default on wider screens/);
  assert.match(source, /min-height:\s*48px/);
  assert.doesNotMatch(source, /live in this browser only|tiny example|starter settings/);
});

test("shell-web placement template seeds default Home and Settings adaptive navigation", async () => {
  const source = await readFile(path.join(PACKAGE_DIR, "templates", "src", "placement.js"), "utf8");

  assert.match(source, /id: "shell-web\.home\.menu\.home"/);
  assert.match(source, /target: "shell\.primary-nav"/);
  assert.match(source, /kind: "link"/);
  assert.match(source, /surfaces: \["home"\]/);
  assert.match(source, /label: "Home"/);
  assert.match(source, /unscopedSuffix: "\/"/);
  assert.match(source, /id: "shell-web\.home\.menu\.settings"/);
  assert.match(source, /label: "Settings"/);
  assert.match(source, /unscopedSuffix: "\/settings"/);
  assert.match(source, /id: "shell-web\.home\.settings\.general"/);
  assert.match(source, /target: "page\.section-nav"/);
  assert.match(source, /owner: "home-settings"/);
  assert.match(source, /label: "General"/);
  assert.match(source, /unscopedSuffix: "\/settings\/general"/);
  assert.doesNotMatch(source, /to: "\.\/general"/);
});

test("shell-web placement topology seeds global actions as a semantic shell placement", async () => {
  const source = await readFile(path.join(PACKAGE_DIR, "templates", "src", "placementTopology.js"), "utf8");

  assert.match(source, /id: "shell\.global-actions"/);
  assert.match(source, /description: "Global surface actions that should stay outside primary navigation\."/);
  assert.match(source, /outlet: "shell-layout:top-right"/);
  assert.match(source, /renderers: menuLinkRenderers/);
  assert.match(source, /id: "page\.supporting-content"/);
  assert.match(source, /outlet: "shell-layout:supporting-bottom-sheet"/);
  assert.match(source, /outlet: "shell-layout:supporting-side-panel"/);
});

test("shell-web descriptor pre-optimizes package subpaths reached only through dynamic base-shell modules", async () => {
  const [providerSource, placementSource, placementTopologySource, errorSource] = await Promise.all([
    readFile(path.join(PACKAGE_DIR, "src", "client", "providers", "ShellWebClientProvider.js"), "utf8"),
    readFile(path.join(PACKAGE_DIR, "templates", "src", "placement.js"), "utf8"),
    readFile(path.join(PACKAGE_DIR, "templates", "src", "placementTopology.js"), "utf8"),
    readFile(path.join(PACKAGE_DIR, "templates", "src", "error.js"), "utf8")
  ]);

  assert.deepEqual(
    Array.from(
      new Set(
        Array.from(
          providerSource.matchAll(/\bimport\(["'](\/src\/[^"']+)["']\)/gu),
          (match) => match[1]
        )
      )
    ),
    ["/src/placement.js", "/src/placementTopology.js", "/src/error.js"]
  );
  assert.deepEqual(readPackageImportSpecifiers(placementSource), [
    "@jskit-ai/shell-web/client/placement"
  ]);
  assert.deepEqual(readPackageImportSpecifiers(placementTopologySource), []);
  assert.deepEqual(readPackageImportSpecifiers(errorSource), [
    "@jskit-ai/shell-web/client/error"
  ]);

  assert.deepEqual(descriptor?.metadata?.client?.optimizeDeps?.include, [
    "@jskit-ai/shell-web/client/placement",
    "@jskit-ai/shell-web/client/error"
  ]);
  assert.deepEqual(descriptor?.metadata?.client?.optimizeDeps?.exclude, [
    "@jskit-ai/shell-web/client"
  ]);
});

test("shell-web descriptor metadata advertises adaptive shell outlets, default links, and installs the scaffold page", () => {
  assert.deepEqual(readClientContainerTokens(), [
    "runtime.web-placement.client",
    "runtime.web-bootstrap.client",
    "runtime.web-refresh.client",
    "runtime.web-async-module-recovery.client",
    "runtime.web-request-recovery.client",
    "runtime.web-error.client",
    "runtime.web-error.presentation-store.client"
  ]);

  assert.deepEqual(
    readOutlets("shell-layout:primary-bottom-nav"),
    [
      {
        target: "shell-layout:primary-bottom-nav",
        surfaces: ["*"],
        source: "src/client/components/ShellLayout.vue"
      }
    ]
  );

  assert.deepEqual(
    readOutlets("shell-layout:supporting-bottom-sheet"),
    [
      {
        target: "shell-layout:supporting-bottom-sheet",
        surfaces: ["*"],
        source: "src/client/components/ShellLayout.vue"
      }
    ]
  );

  assert.deepEqual(
    readOutlets("shell-layout:supporting-side-panel"),
    [
      {
        target: "shell-layout:supporting-side-panel",
        surfaces: ["*"],
        source: "src/client/components/ShellLayout.vue"
      }
    ]
  );

  assert.deepEqual(
    readOutlets("home-settings:primary-menu"),
    [
      {
        target: "home-settings:primary-menu",
        surfaces: ["home"],
        source: "templates/src/pages/home/settings.vue"
      }
    ]
  );

  assert.deepEqual(
    readContributions("shell.primary-nav"),
    [
      {
        id: "shell-web.home.menu.home",
        target: "shell.primary-nav",
        kind: "link",
        surfaces: ["home"],
        order: 50,
        source: "templates/src/placement.js"
      },
      {
        id: "shell-web.home.menu.settings",
        target: "shell.primary-nav",
        kind: "link",
        surfaces: ["home"],
        order: 100,
        source: "templates/src/placement.js"
      }
    ]
  );

  assert.deepEqual(
    readContributions("page.section-nav"),
    [
      {
        id: "shell-web.home.settings.general",
        target: "page.section-nav",
        owner: "home-settings",
        kind: "link",
        surfaces: ["home"],
        order: 100,
        source: "templates/src/placement.js"
      }
    ]
  );

  assert.equal(readTopology("shell.primary-nav").length, 1);
  assert.equal(readTopology("shell.primary-nav")[0]?.variants?.compact?.outlet, "shell-layout:primary-bottom-nav");
  assert.equal(
    readTopology("shell.primary-nav")[0]?.variants?.compact?.renderers?.link,
    "local.main.ui.tab-link-item"
  );
  assert.equal(readTopology("shell.primary-nav")[0]?.variants?.medium?.outlet, "shell-layout:primary-menu");
  assert.equal(readTopology("shell.global-actions").length, 1);
  assert.equal(readTopology("shell.global-actions")[0]?.variants?.compact?.outlet, "shell-layout:top-right");
  assert.equal(
    readTopology("shell.global-actions")[0]?.variants?.compact?.renderers?.link,
    "local.main.ui.surface-aware-menu-link-item"
  );
  assert.equal(readTopology("page.section-nav", "home-settings").length, 1);
  assert.equal(readTopology("page.supporting-content").length, 1);
  assert.equal(
    readTopology("page.supporting-content")[0]?.variants?.compact?.outlet,
    "shell-layout:supporting-bottom-sheet"
  );
  assert.equal(
    readTopology("page.supporting-content")[0]?.variants?.expanded?.outlet,
    "shell-layout:supporting-side-panel"
  );

  assert.deepEqual(findFileMutation("shell-web-page-home-settings-shell"), {
    from: "templates/src/pages/home/settings.vue",
    toSurface: "home",
    toSurfacePath: "settings.vue",
    ownership: "app",
    reason: "Install shell-driven home settings shell route with section navigation.",
    category: "shell-web",
    id: "shell-web-page-home-settings-shell"
  });

  assert.deepEqual(findFileMutation("shell-web-page-home-settings"), {
    from: "templates/src/pages/home/settings/index.vue",
    toSurface: "home",
    toSurfacePath: "settings/index.vue",
    ownership: "app",
    reason: "Install shell-driven home settings redirect so the starter settings shell lands on a real child page.",
    category: "shell-web",
    id: "shell-web-page-home-settings"
  });

  assert.deepEqual(findFileMutation("shell-web-page-home-settings-general"), {
    from: "templates/src/pages/home/settings/general/index.vue",
    toSurface: "home",
    toSurfacePath: "settings/general/index.vue",
    ownership: "app",
    reason: "Install shell-driven general settings child page with a tiny browser-local shell preference example.",
    category: "shell-web",
    id: "shell-web-page-home-settings-general"
  });

  assert.deepEqual(findFileMutation("shell-web-test-adaptive-shell-smoke"), {
    from: "templates/tests/e2e/adaptive-shell.spec.ts",
    to: "tests/e2e/adaptive-shell.spec.ts",
    ownership: "app",
    reason: "Install compact/medium/expanded Playwright smoke coverage for the adaptive shell.",
    category: "shell-web",
    id: "shell-web-test-adaptive-shell-smoke"
  });
});

test("shell-web home starter page relies on adaptive shell navigation instead of dead feature buttons", async () => {
  const source = await readFile(path.join(PACKAGE_DIR, "templates", "src", "pages", "home", "index.vue"), "utf8");

  assertGeneratedUiSourceContract(source, {
    profile: "shell-home",
    sourceName: "shell-web home/index.vue"
  });
  assert.match(source, /generated-ui-screen generated-ui-screen--app home-surface-screen/);
  assert.match(source, /--generated-ui-screen-title-size/);
  assert.match(source, /Core services are available\./);
  assert.match(source, /to="\/home\/settings\/general"/);
  assert.doesNotMatch(source, /Use bottom navigation|Replace this content|Main public surface/);
  assert.doesNotMatch(source, /\/console/);
  assert.doesNotMatch(source, /\/auth\/signout/);
});
