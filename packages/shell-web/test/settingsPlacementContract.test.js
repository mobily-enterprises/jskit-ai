import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import test from "node:test";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { optimizeDeps, resolveConfig } from "vite";
import packageJson from "../package.json" with { type: "json" };

const packageMetadata = packageJson.jskit;
import { resolveShellRouteTransitionKey } from "../src/client/support/routeTransitionKey.js";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = path.resolve(TEST_DIRECTORY, "..");

async function readClientSources(...relativePaths) {
  const sources = await Promise.all(
    relativePaths.map((relativePath) => readFile(path.join(PACKAGE_DIR, "src", "client", relativePath), "utf8"))
  );
  return sources.join("\n");
}

function readOutlets(target = "") {
  const outlets = packageMetadata?.metadata?.ui?.placements?.outlets;
  const normalizedTarget = String(target || "").trim();
  return Array.isArray(outlets)
    ? outlets.filter((entry) => String(entry?.target || "").trim() === normalizedTarget)
    : [];
}

function readContributions(target = "") {
  const contributions = packageMetadata?.metadata?.ui?.placements?.contributions;
  const normalizedTarget = String(target || "").trim();
  return Array.isArray(contributions)
    ? contributions.filter((entry) => String(entry?.target || "").trim() === normalizedTarget)
    : [];
}

function readTopology(id = "", owner = "") {
  const placements = packageMetadata?.metadata?.ui?.placements?.topology?.placements;
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

test("shell-web application pattern exposes surface-derived settings outlets", async () => {
  const source = await readFile(
    path.join(PACKAGE_DIR, "patterns", "application-shell", "example", "src", "pages", "home", "settings.vue"),
    "utf8"
  );

  assert.match(source, /target="home-settings:primary-menu"/);
  assert.match(source, /<ShellListDetail :detail-open="detailOpen">/u);
  assert.doesNotMatch(source, /<style|border|v-sheet/u);
  assert.doesNotMatch(source, /generated-ui/u);
  assert.doesNotMatch(source, /default-link-component-token/);
  assert.match(source, /<RouterView \/>/);
});

test("shell-web shell layout registers navigation at the app layout level", async () => {
  const layoutSource = await readClientSources("components/ShellLayout.vue");
  const source = await readClientSources("composables/useShellDrawer.js", "components/ShellLayout.vue");
  const barPieces = await readClientSources(
    "components/ShellUpButton.vue",
    "components/ShellPageTitle.vue",
    "components/ShellPageActionsTarget.vue",
    "composables/useShellAppBar.js"
  );

  // ShellLayout's bar is made of the pieces a layout with its own top app bar uses: one owner, no copy.
  assert.match(layoutSource, /useShellAppBar\(\);/u);
  assert.match(layoutSource, /<ShellUpButton v-if="canGoUp" class="shell-layout__leading" \/>/u);
  assert.match(layoutSource, /<ShellPageTitle :title="fallbackTitle" \/>/u);
  assert.match(layoutSource, /<ShellPageActionsTarget \/>/u);
  assert.doesNotMatch(layoutSource, /\$arrowBack|PAGE_TITLE_ID|SHELL_PAGE_ACTIONS_ID|attachShell/u);

  assert.doesNotMatch(source, /<v-layout\b/);
  assert.doesNotMatch(source, /overflow-hidden/);
  assert.doesNotMatch(source, /min-height:\s*72vh/);
  assert.match(source, /ShellRouteTransition/);
  assert.match(source, /<ShellRouteTransition>[\s\S]*<slot \/>[\s\S]*<\/ShellRouteTransition>/);
  assert.match(source, /data-testid="jskit-shell-app-bar"/);
  assert.match(source, /:height="64"/u);
  assert.match(source, /:color="scrolled \? 'surface-container' : 'surface'"/u);
  assert.match(barPieces, /data-testid="jskit-shell-back"[\s\S]*:aria-label="t\('jskit\.shell\.actions\.back'\)"/u);
  assert.match(barPieces, /:id="PAGE_TITLE_ID"/u);
  assert.match(barPieces, /:id="SHELL_PAGE_ACTIONS_ID"/u);
  assert.match(barPieces, /provide\(SHELL_PAGE_ACTIONS_TARGET_KEY, `#\$\{SHELL_PAGE_ACTIONS_ID\}`\)/u);
  assert.match(barPieces, /release = navigationRuntime\.attachShell\(\);/u);
  assert.match(source, /shell-layout__surface-label/);
  assert.doesNotMatch(source, /shell-layout__surface-chip/);
  assert.doesNotMatch(source, /<v-chip[^>]*resolvedSurfaceLabel/);
  assert.match(source, /<v-bottom-navigation[\s\S]*target="shell-layout:primary-bottom-nav"/);
  assert.match(source, /bg-color="surface-container"[\s\S]*:height="80"/u);
  assert.doesNotMatch(source, /!important|border-(?:top|bottom|right|left)?-?width:\s*thin/u);
  assert.match(source, /<v-bottom-sheet[\s\S]*target="shell-layout:supporting-bottom-sheet"/);
  assert.match(source, /target="shell-layout:supporting-side-panel"/);
  assert.match(source, /data-testid="jskit-shell-supporting-bottom-sheet"/);
  assert.match(source, /data-testid="jskit-shell-supporting-side-panel"/);
  assert.match(source, /inject\(SHELL_WEB_REFRESH_RUNTIME_KEY, NO_SHELL_WEB_REFRESH_RUNTIME\)/);
  const refreshRuntimeSource = await readFile(path.join(PACKAGE_DIR, "src", "client", "runtime", "refreshRuntime.js"), "utf8");
  assert.match(refreshRuntimeSource, /SHELL_WEB_REFRESH_RUNTIME_KEY = "jskit\.shell-web\.runtime\.web-refresh\.client"/);
  assert.match(source, /useShellPullToRefresh\(\{ enabled: isCompactLayout, refreshRuntime \}\)/);
  const pullToRefreshSource = await readFile(
    path.join(PACKAGE_DIR, "src", "client", "composables", "useShellPullToRefresh.js"),
    "utf8"
  );
  assert.match(pullToRefreshSource, /window\.addEventListener\("pointerdown", handlePullPointerDown/);
  assert.match(pullToRefreshSource, /window\.addEventListener\("touchmove", handlePullTouchMove/);
  assert.match(pullToRefreshSource, /refreshRuntime\.refresh\("pull-to-refresh"\)/);
  assert.match(source, /data-testid="jskit-shell-pull-refresh"/);
  assert.match(source, /target="shell-layout:primary-menu"[\s\S]*default/);
  assert.doesNotMatch(source, /target="shell-layout:primary-bottom-nav"[\s\S]*default/);
  assert.match(source, /data-testid="jskit-shell-drawer"/);
  assert.match(source, /desktopDrawerClosedMode/);
  assert.match(source, /default: "rail"/);
  assert.match(source, /:rail="drawerPresentation\.rail"/);
  assert.match(source, /drawerWidth/);
  assert.match(source, /railWidth/);
  assert.match(source, /navigationItemSpacing/);
  assert.match(source, /:width="resolvedDrawerWidth"/);
  assert.match(source, /:rail-width="resolvedRailWidth"/);
  assert.match(source, /data-drawer-width="resolvedDrawerWidth"/);
  assert.match(source, /data-navigation-item-spacing="resolvedNavigationItemSpacing"/);
  assert.match(source, /data-rail-width="resolvedRailWidth"/);
  assert.match(source, /data-layout="layoutClass"/);
  assert.match(source, /measureDrawerContentWidth/);
  assert.match(source, /DEFAULT_SHELL_NAVIGATION_ITEM_SPACING/);
  assert.match(source, /:prepend-gap="resolvedNavigationItemSpacing"/);
  assert.match(source, /--shell-navigation-drawer-inset:\s*12px/);
  assert.match(source, /--shell-navigation-rail-width/);
  assert.match(source, /padding-inline-start:\s*var\(--shell-navigation-drawer-inset\)/);
  assert.doesNotMatch(source, /<v-list-subheader/);
  assert.doesNotMatch(source, /:width="248"/);
  assert.doesNotMatch(source, /:rail-width="80"/);
  assert.match(source, /:model-value="drawerPresentation\.visible"/);
  assert.match(source, /data-testid="jskit-shell-nav-toggle"/);
  assert.match(source, /data-testid="jskit-shell-bottom-nav"/);
  assert.match(source, /padding:\s*8px 24px calc\(24px \+ env\(safe-area-inset-bottom, 0px\)\)/u);
  assert.match(source, /\.shell-layout__content--compact\s*\{\s*padding-inline:\s*16px;/u);

  const template = await readFile(
    path.join(PACKAGE_DIR, "patterns", "application-shell", "example", "src", "components", "ShellLayout.vue"),
    "utf8"
  );

  assert.match(template, /PackageShellLayout from "@jskit-ai\/shell-web\/client\/components\/ShellLayout"/);
  assert.match(template, /drawerWidth, railWidth, navigationItemSpacing, and future shell props package-owned/);
  assert.match(template, /h\(PackageShellLayout, attrs, slots\)/);
  assert.doesNotMatch(template, /ShellOutlet|ShellRouteTransition|useShellLayoutState|pointerdown|v-navigation-drawer|v-bottom-navigation/);
});

test("shell-web application pattern renders its not-found view in the shell, whose app bar carries the title", async () => {
  const source = await readFile(
    path.join(PACKAGE_DIR, "patterns", "application-shell", "example", "src", "views", "NotFound.vue"),
    "utf8"
  );

  assert.match(source, /<ShellLayout title="Not Found"/u);
  assert.doesNotMatch(source, /<h1/u);
});

test("shell-web error host uses one explicit close affordance for banner errors", async () => {
  const source = await readClientSources("components/ShellErrorHost.vue", "error/presentation.js");

  assert.match(source, /function resolveSeverityIcon/);
  assert.match(source, /"\$warning"/u);
  assert.match(source, /:icon="resolveSeverityIcon\(entry\.severity\)"/);
  assert.match(source, /closable[\s\S]*@click:close="dismiss\(entry\)"/);
  assert.doesNotMatch(source, /mdi-close/);
});

test("shell-web error host keeps snackbar color stable while closing", async () => {
  const source = await readFile(path.join(PACKAGE_DIR, "src", "client", "components", "ShellErrorHost.vue"), "utf8");

  assert.match(source, /displayedSnackbarEntry/);
  assert.match(source, /@after-leave="onSnackbarAfterLeave"/);
  // Material 3 snackbars are always inverse-surface, whatever the message's severity.
  assert.doesNotMatch(source, /<v-snackbar[^>]*:color=/u);
  assert.doesNotMatch(source, /!important/u);
});

test("shell-web application pattern uses intent-driven default error presentation", async () => {
  const source = await readFile(
    path.join(PACKAGE_DIR, "patterns", "application-shell", "example", "src", "error.js"),
    "utf8"
  );

  assert.match(source, /resourceLoadChannel:\s*"silent"/);
  assert.match(source, /actionFeedbackChannel:\s*"snackbar"/);
  assert.match(source, /appRecoverableChannel:\s*"banner"/);
  assert.match(source, /blockingChannel:\s*"dialog"/);
});

test("shell-web application pattern includes adaptive shell Playwright coverage", async () => {
  const source = await readFile(
    path.join(PACKAGE_DIR, "patterns", "application-shell", "example", "tests", "e2e", "adaptive-shell.spec.ts"),
    "utf8"
  );
  const helperSource = await readFile(path.join(PACKAGE_DIR, "src", "test", "adaptiveShellSmoke.js"), "utf8");

  assert.match(source, /DEFAULT_VIEWPORTS, runAdaptiveShellSmokeCase/);
  assert.match(source, /test\(`/);
  assert.match(source, /runAdaptiveShellSmokeCase\(\{ page, expect, viewport \}\)/);
  assert.doesNotMatch(source, /runAdaptiveShellSmoke\(\{/);
  assert.match(source, /@jskit-ai\/shell-web\/test\/adaptiveShellSmoke/);
  assert.match(helperSource, /adaptive shell smoke/);
  assert.match(helperSource, /390/);
  assert.match(helperSource, /1024/);
  assert.match(helperSource, /1280/);
  assert.match(helperSource, /jskit-shell-bottom-nav/);
  assert.match(helperSource, /jskit-shell-drawer/);
  assert.match(helperSource, /scrollWidth/);
  assert.match(helperSource, /toBeGreaterThanOrEqual\(48\)/);
  // The modal drawer opens over the app bar; the smoke closes it from the scrim beside it and with Escape.
  assert.match(helperSource, /toHaveAttribute\("aria-label", "Close navigation menu"\)/);
  assert.match(helperSource, /page\.mouse\.click\(viewport\.width - 8/);
  assert.doesNotMatch(helperSource, /\.v-navigation-drawer__scrim|generated-ui-screen/u);

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
  const source = await readClientSources("components/ShellRouteTransition.vue", "composables/useShellRouteTransition.js");

  assert.match(source, /target:\s*\{[\s\S]*default:\s*"shell-layout:primary-bottom-nav"/);
  assert.match(source, /semanticTarget:\s*\{[\s\S]*default:\s*"shell\.primary-nav"/);
  assert.match(source, /placementRuntime\s*\.\s*getPlacements/);
  assert.match(source, /useRouter\(\)/);
  assert.match(source, /swipeEnabled:\s*\{[\s\S]*default:\s*true/);
  assert.match(source, /window\.addEventListener\("pointerdown", handlePointerDown/);
  assert.match(source, /document\.documentElement\.classList\.toggle\("shell-route-swipe-enabled", enabled\)/);
  assert.match(source, /createRouteSwipeGesture\(\)/);
  assert.match(source, /const offset = swipeGesture\.end\(event\);[\s\S]*navigateBySwipe\(offset\)/);
  assert.match(source, /router\.push\(nextEntry\.href\)/);
  assert.match(source, /isShellGestureIgnoredTarget\(event\.target\)/);
  assert.match(source, /touch-action:\s*pan-y/);
  assert.match(source, /\.shell-route-transition\s*\{[\s\S]*display:\s*flex/);
  assert.match(source, /\.shell-route-transition\s*\{[\s\S]*min-height:\s*0/);
  assert.match(source, /\.shell-route-transition__pane\s*\{[\s\S]*flex:\s*1 1 auto/);
  assert.match(source, /\.shell-route-transition__pane\s*\{[\s\S]*min-height:\s*0/);
  assert.match(source, /transitionDirection\.value = nextIndex > previousIndex \? "forward" : "reverse"/);
  assert.match(source, /const routeTransitionKey = ref\(""\)/);
  assert.match(source, /\[\(\) => normalizeComparablePathname\(route\.path\), currentSurfaceId\]/);
  assert.match(source, /routeTransitionKey\.value = resolveShellRouteTransitionKey/);
  assert.match(source, /prefers-reduced-motion:\s*reduce/);
});

test("shell-web route transition key preserves no-motion surfaces and animated path transitions", () => {
  const previewSurfaceKey = "surface:editor-preview";
  assert.equal(
    resolveShellRouteTransitionKey({
      routeTransitionName: "",
      routePathKey: "/preview",
      surfaceId: "editor-preview"
    }),
    previewSurfaceKey
  );
  assert.equal(
    resolveShellRouteTransitionKey({
      routeTransitionName: "",
      routePathKey: "/preview/dashboard",
      surfaceId: "editor-preview"
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

test("shell-web pattern settings page is a list-detail page whose landing shows the list, not a redirect", async () => {
  const settingsRoot = path.join(PACKAGE_DIR, "patterns", "application-shell", "example", "src", "pages", "home");
  const source = await readFile(path.join(settingsRoot, "settings.vue"), "utf8");

  assert.match(source, /<ShellListDetail :detail-open="detailOpen">/);
  assert.match(source, /title: "Settings"/);
  await assert.rejects(readFile(path.join(settingsRoot, "settings", "index.vue"), "utf8"), { code: "ENOENT" });
});

test("shell-web pattern settings page exposes an adaptive drawer preference", async () => {
  const source = await readFile(
    path.join(
      PACKAGE_DIR,
      "patterns",
      "application-shell",
      "example",
      "src",
      "pages",
      "home",
      "settings",
      "general",
      "index.vue"
    ),
    "utf8"
  );

  assert.match(source, /useShellLayoutState/);
  assert.match(source, /parent: "\/settings"/);
  assert.match(source, /<v-card>\s*<v-list lines="three">/);
  assert.doesNotMatch(source, /generated-ui/u);
  assert.match(source, /drawerDefaultOpen/);
  assert.match(source, /setDrawerDefaultOpen/);
  assert.match(source, /collapsed navigation remains available as a rail/);
  assert.match(source, /Phone layouts close the drawer/);
  assert.match(source, /Start with expanded navigation on wider screens/);
  assert.doesNotMatch(source, /<style|min-height/u);
  assert.doesNotMatch(source, /live in this browser only|tiny example|starter settings/);
});

test("shell-web application pattern demonstrates Home and Settings adaptive navigation", async () => {
  const source = await readFile(
    path.join(PACKAGE_DIR, "patterns", "application-shell", "example", "src", "placement.js"),
    "utf8"
  );

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

test("shell-web application pattern demonstrates semantic global actions", async () => {
  const source = await readFile(
    path.join(PACKAGE_DIR, "patterns", "application-shell", "example", "src", "placementTopology.js"),
    "utf8"
  );

  assert.match(source, /id: "shell\.global-actions"/);
  assert.match(source, /description: "Global surface actions that should stay outside primary navigation\."/);
  assert.match(source, /outlet: "shell-layout:top-right"/);
  assert.match(source, /renderers: menuLinkRenderers/);
  assert.match(source, /id: "page\.supporting-content"/);
  assert.match(source, /outlet: "shell-layout:supporting-bottom-sheet"/);
  assert.match(source, /outlet: "shell-layout:supporting-side-panel"/);
});

test("shell-web packageMetadata pre-optimizes package subpaths reached through dynamic shell modules", async () => {
  const [providerSource, placementSource, placementTopologySource, errorSource] = await Promise.all([
    readFile(path.join(PACKAGE_DIR, "src", "client", "providers", "ShellWebClientProvider.js"), "utf8"),
    readFile(path.join(PACKAGE_DIR, "patterns", "application-shell", "example", "src", "placement.js"), "utf8"),
    readFile(path.join(PACKAGE_DIR, "patterns", "application-shell", "example", "src", "placementTopology.js"), "utf8"),
    readFile(path.join(PACKAGE_DIR, "patterns", "application-shell", "example", "src", "error.js"), "utf8")
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

  assert.deepEqual(packageMetadata?.metadata?.client?.optimizeDeps?.exclude, [
    "@jskit-ai/shell-web/client"
  ]);
});

test("all public shell JavaScript helpers are ready in a cold dependency scan", async () => {
  // The provider loads application-owned /src modules. It and Vue components stay source.
  const sourceEntries = new Set(["./client", "./client/providers/ShellWebClientProvider"]);
  const helpers = Object.entries(packageJson.exports)
    .filter(([entry, target]) => entry.startsWith("./client/") && target.endsWith(".js") && !sourceEntries.has(entry))
    .map(([entry]) => `${packageJson.name}${entry.slice(1)}`)
    .sort();
  const optimization = packageMetadata.metadata.client.optimizeDeps;
  assert.deepEqual([...optimization.include].sort(), helpers,
    "Every exported JavaScript helper needs prebundling beneath the excluded client entry.");

  const root = await mkdtemp(path.join(os.tmpdir(), "shell-cold-scan-"));
  try {
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "shell-cold-scan", type: "module" }));
    await symlink(path.resolve(PACKAGE_DIR, "../../node_modules"), path.join(root, "node_modules"), "dir");
    const config = await resolveConfig({
      root,
      configFile: false,
      cacheDir: path.join(root, "cache"),
      logLevel: "silent",
      optimizeDeps: { ...optimization, noDiscovery: true }
    }, "serve");
    const metadata = await optimizeDeps(config, true);
    for (const helper of helpers) {
      assert.ok(metadata.optimized[helper], `${helper} must be prepared before page loading.`);
    }
    assert.equal(metadata.optimized[`${packageJson.name}/client`], undefined);
    assert.equal(metadata.optimized[`${packageJson.name}/client/providers/ShellWebClientProvider`], undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("shell-web metadata advertises adaptive shell outlets and pattern-backed links", () => {
  assert.equal(packageMetadata?.mutations, undefined);
  assert.equal(Object.hasOwn(packageMetadata?.metadata?.apiSummary || {}, "containerTokens"), false);
  assert.deepEqual(packageMetadata?.capabilities?.provides, ["client.shell"]);

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
        source: "patterns/application-shell/example/src/pages/home/settings.vue"
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
        source: "patterns/application-shell/example/src/placement.js"
      },
      {
        id: "shell-web.home.menu.settings",
        target: "shell.primary-nav",
        kind: "link",
        surfaces: ["home"],
        order: 100,
        source: "patterns/application-shell/example/src/placement.js"
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
        source: "patterns/application-shell/example/src/placement.js"
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

});

test("shell-web pattern home page relies on adaptive navigation instead of dead feature buttons", async () => {
  const source = await readFile(
    path.join(PACKAGE_DIR, "patterns", "application-shell", "example", "src", "pages", "home", "index.vue"),
    "utf8"
  );

  assert.doesNotMatch(source, /<style|--home-surface/u);
  assert.doesNotMatch(source, /generated-ui/u);
  assert.match(source, /Service health/);
  assert.match(source, /<v-skeleton-loader/u);
  assert.doesNotMatch(source, /loading\.\.\.|v-progress-circular/u);
  assert.match(source, /:to="paths\.page\('\/settings'\)"/);
  assert.doesNotMatch(source, /Use bottom navigation|Replace this content|Main public surface/);
  assert.doesNotMatch(source, /\/console/);
  assert.doesNotMatch(source, /\/auth\/signout/);
});
