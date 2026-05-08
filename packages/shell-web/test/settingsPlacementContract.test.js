import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import descriptor from "../package.descriptor.mjs";

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

function findFileMutation(id) {
  const files = descriptor?.mutations?.files;
  return Array.isArray(files)
    ? files.find((entry) => String(entry?.id || "").trim() === id) || null
    : null;
}

test("shell-web home settings template exposes surface-derived settings outlets", async () => {
  const source = await readFile(path.join(PACKAGE_DIR, "templates", "src", "pages", "home", "settings.vue"), "utf8");

  assert.match(source, /target="home-settings:primary-menu"/);
  assert.doesNotMatch(source, /default-link-component-token/);
  assert.match(source, /<RouterView \/>/);
});

test("shell-web shell layout registers navigation at the app layout level", async () => {
  for (const relativePath of [
    path.join("src", "client", "components", "ShellLayout.vue"),
    path.join("templates", "src", "components", "ShellLayout.vue")
  ]) {
    const source = await readFile(path.join(PACKAGE_DIR, relativePath), "utf8");

    assert.doesNotMatch(source, /<v-layout\b/);
    assert.doesNotMatch(source, /overflow-hidden/);
    assert.doesNotMatch(source, /min-height:\s*72vh/);
    assert.match(source, /ShellRouteTransition/);
    assert.match(source, /<ShellRouteTransition>[\s\S]*<slot \/>[\s\S]*<\/ShellRouteTransition>/);
    assert.match(source, /<v-bottom-navigation[\s\S]*target="shell-layout:primary-bottom-nav"/);
    assert.match(source, /data-testid="jskit-shell-drawer"/);
    assert.match(source, /data-testid="jskit-shell-bottom-nav"/);
    assert.match(source, /padding:\s*0\.75rem 1rem calc\(1rem \+ env\(safe-area-inset-bottom, 0px\)\)/);
  }
});

test("shell-web installs generated adaptive shell Playwright smoke coverage", async () => {
  const source = await readFile(path.join(PACKAGE_DIR, "templates", "tests", "e2e", "adaptive-shell.spec.ts"), "utf8");

  assert.match(source, /generated adaptive shell smoke/);
  assert.match(source, /390/);
  assert.match(source, /768/);
  assert.match(source, /1280/);
  assert.match(source, /jskit-shell-bottom-nav/);
  assert.match(source, /jskit-shell-drawer/);
  assert.match(source, /scrollWidth/);
  assert.match(source, /toBeGreaterThanOrEqual\(48\)/);
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
  assert.match(source, /transitionDirection\.value = nextIndex > previousIndex \? "forward" : "reverse"/);
  assert.match(source, /prefers-reduced-motion:\s*reduce/);
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
  assert.match(source, /drawerDefaultOpen/);
  assert.match(source, /setDrawerDefaultOpen/);
  assert.match(source, /Phone layouts keep primary navigation in the bottom bar/);
  assert.match(source, /Open drawer by default on wider screens/);
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

test("shell-web descriptor metadata advertises adaptive shell outlets, default links, and installs the scaffold page", () => {
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
  assert.equal(readTopology("page.section-nav", "home-settings").length, 1);

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

  assert.match(source, /Core services are available\./);
  assert.match(source, /to="\/home\/settings\/general"/);
  assert.doesNotMatch(source, /Use bottom navigation|Replace this content|Main public surface/);
  assert.doesNotMatch(source, /\/console/);
  assert.doesNotMatch(source, /\/auth\/signout/);
});
