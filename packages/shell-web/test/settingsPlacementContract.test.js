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

function findFileMutation(id) {
  const files = descriptor?.mutations?.files;
  return Array.isArray(files)
    ? files.find((entry) => String(entry?.id || "").trim() === id) || null
    : null;
}

test("shell-web home settings template exposes surface-derived settings outlets", async () => {
  const source = await readFile(path.join(PACKAGE_DIR, "templates", "src", "pages", "home", "settings.vue"), "utf8");

  assert.match(source, /target="home-settings:primary-menu"/);
  assert.match(source, /default-link-component-token="local\.main\.ui\.surface-aware-menu-link-item"/);
  assert.match(source, /<RouterView \/>/);
});

test("shell-web settings landing page redirects to the starter child page", async () => {
  const source = await readFile(path.join(PACKAGE_DIR, "templates", "src", "pages", "home", "settings", "index.vue"), "utf8");

  assert.match(source, /definePage/);
  assert.match(source, /redirect:/);
  assert.match(source, /\/general/);
});

test("shell-web settings general child page exposes a tiny browser-local drawer preference", async () => {
  const source = await readFile(
    path.join(PACKAGE_DIR, "templates", "src", "pages", "home", "settings", "general", "index.vue"),
    "utf8"
  );

  assert.match(source, /useShellLayoutState/);
  assert.match(source, /drawerDefaultOpen/);
  assert.match(source, /setDrawerDefaultOpen/);
  assert.match(source, /Open navigation drawer by default/);
  assert.match(source, /live in this browser only/);
});

test("shell-web placement template seeds default Home and Settings drawer navigation", async () => {
  const source = await readFile(path.join(PACKAGE_DIR, "templates", "src", "placement.js"), "utf8");

  assert.match(source, /id: "shell-web\.home\.menu\.home"/);
  assert.match(source, /target: "shell-layout:primary-menu"/);
  assert.match(source, /label: "Home"/);
  assert.match(source, /unscopedSuffix: "\/"/);
  assert.match(source, /id: "shell-web\.home\.menu\.settings"/);
  assert.match(source, /label: "Settings"/);
  assert.match(source, /unscopedSuffix: "\/settings"/);
  assert.match(source, /id: "shell-web\.home\.settings\.general"/);
  assert.match(source, /target: "home-settings:primary-menu"/);
  assert.match(source, /label: "General"/);
  assert.match(source, /unscopedSuffix: "\/settings\/general"/);
  assert.match(source, /to: "\.\/general"/);
});

test("shell-web descriptor metadata advertises home settings outlets, default drawer links, and installs the scaffold page", () => {
  assert.deepEqual(
    readOutlets("home-settings:primary-menu"),
    [
      {
        target: "home-settings:primary-menu",
        defaultLinkComponentToken: "local.main.ui.surface-aware-menu-link-item",
        surfaces: ["home"],
        source: "templates/src/pages/home/settings.vue"
      }
    ]
  );

  assert.deepEqual(
    readContributions("shell-layout:primary-menu"),
    [
      {
        id: "shell-web.home.menu.home",
        target: "shell-layout:primary-menu",
        surfaces: ["*"],
        order: 50,
        componentToken: "local.main.ui.surface-aware-menu-link-item",
        source: "templates/src/placement.js"
      },
      {
        id: "shell-web.home.menu.settings",
        target: "shell-layout:primary-menu",
        surfaces: ["home"],
        order: 100,
        componentToken: "local.main.ui.surface-aware-menu-link-item",
        source: "templates/src/placement.js"
      }
    ]
  );

  assert.deepEqual(
    readContributions("home-settings:primary-menu"),
    [
      {
        id: "shell-web.home.settings.general",
        target: "home-settings:primary-menu",
        surfaces: ["home"],
        order: 100,
        componentToken: "local.main.ui.surface-aware-menu-link-item",
        source: "templates/src/placement.js"
      }
    ]
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
});

test("shell-web home starter page relies on drawer navigation instead of dead feature buttons", async () => {
  const source = await readFile(path.join(PACKAGE_DIR, "templates", "src", "pages", "home", "index.vue"), "utf8");

  assert.match(source, /Use the navigation drawer to move around the shell\./);
  assert.doesNotMatch(source, /\/home\/settings/);
  assert.doesNotMatch(source, /\/console/);
  assert.doesNotMatch(source, /\/auth\/signout/);
});
