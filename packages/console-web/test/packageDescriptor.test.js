import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import descriptor from "../package.descriptor.mjs";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = path.resolve(TEST_DIRECTORY, "..");

function findFileMutation(id) {
  const files = descriptor?.mutations?.files;
  return Array.isArray(files)
    ? files.find((entry) => String(entry?.id || "").trim() === id) || null
    : null;
}

function findTextMutation(id) {
  const text = descriptor?.mutations?.text;
  return Array.isArray(text)
    ? text.find((entry) => String(entry?.id || "").trim() === id) || null
    : null;
}

function readOutlets(target = "") {
  const outlets = descriptor?.metadata?.ui?.placements?.outlets;
  const normalizedTarget = String(target || "").trim();
  return Array.isArray(outlets)
    ? outlets.filter((entry) => String(entry?.target || "").trim() === normalizedTarget)
    : [];
}

function findTopology(id, owner = "") {
  const placements = descriptor?.metadata?.ui?.placements?.topology?.placements;
  const normalizedId = String(id || "").trim();
  const normalizedOwner = String(owner || "").trim();
  return Array.isArray(placements)
    ? placements.find((entry) => {
        const entryId = String(entry?.id || "").trim();
        const entryOwner = String(entry?.owner || "").trim();
        return entryId === normalizedId && entryOwner === normalizedOwner;
      }) || null
    : null;
}

function findContribution(id) {
  const contributions = descriptor?.metadata?.ui?.placements?.contributions;
  return Array.isArray(contributions)
    ? contributions.find((entry) => String(entry?.id || "").trim() === id) || null
    : null;
}

test("console-web installs console surface scripts and files", () => {
  assert.deepEqual(descriptor?.mutations?.packageJson?.scripts, {
    "server:console": "SERVER_SURFACE=console node ./bin/server.js",
    "dev:console": "VITE_SURFACE=console vite",
    "build:console": "VITE_SURFACE=console vite build"
  });
  assert.deepEqual(findFileMutation("console-web-page-console-wrapper"), {
    from: "templates/src/pages/console.vue",
    toSurface: "console",
    toSurfaceRoot: true,
    ownership: "app",
    reason: "Install shell-driven console wrapper page.",
    category: "console-web",
    id: "console-web-page-console-wrapper"
  });
  assert.deepEqual(findFileMutation("console-web-page-console"), {
    from: "templates/src/pages/console/index.vue",
    toSurface: "console",
    toSurfacePath: "index.vue",
    ownership: "app",
    reason: "Install shell-driven console page starter.",
    category: "console-web",
    id: "console-web-page-console"
  });
  assert.deepEqual(findFileMutation("console-web-page-console-settings-shell"), {
    from: "templates/src/pages/console/settings.vue",
    toSurface: "console",
    toSurfacePath: "settings.vue",
    ownership: "app",
    reason: "Install console settings shell route scaffold for console-web.",
    category: "console-web",
    id: "console-web-page-console-settings-shell"
  });
  assert.deepEqual(findFileMutation("console-web-page-console-settings"), {
    from: "templates/src/pages/console/settings/index.vue",
    toSurface: "console",
    toSurfacePath: "settings/index.vue",
    ownership: "app",
    reason: "Install console settings index stub scaffold for app-owned landing or redirect behavior.",
    category: "console-web",
    id: "console-web-page-console-settings"
  });
});

test("console-web wires console surface policy into app config", () => {
  assert.equal(
    findTextMutation("console-web-surface-access-policies-console-owner")?.file,
    "config/surfaceAccessPolicies.js"
  );
  assert.equal(findTextMutation("console-web-surface-config-console")?.file, "config/public.js");
  assert.match(findTextMutation("console-web-surface-config-console")?.value || "", /accessPolicyId: "console_owner"/);
  assert.match(findTextMutation("console-web-surface-config-console")?.value || "", /icon: "mdi-console-network-outline"/);
  assert.match(findTextMutation("console-web-surface-config-console")?.value || "", /showInSurfaceSwitchMenu: false/);
  assert.equal(findTextMutation("console-web-profile-menu-console-placement")?.file, "src/placement.js");
  assert.match(findTextMutation("console-web-profile-menu-console-placement")?.value || "", /label: "Go to console"/);
  assert.match(
    findTextMutation("console-web-profile-menu-console-placement")?.value || "",
    /surfaceAccess\?\.consoleowner === true && surface !== "console"/
  );
  assert.equal(findTextMutation("console-web-console-settings-placement")?.file, "src/placement.js");
  assert.equal(findTextMutation("console-web-settings-placement-topology")?.file, "src/placementTopology.js");
  assert.deepEqual(readOutlets("console-settings:primary-menu"), [
    {
      target: "console-settings:primary-menu",
      surfaces: ["console"],
      source: "templates/src/pages/console/settings.vue"
    }
  ]);
  assert.deepEqual(findTopology("page.section-nav", "console-settings"), {
    id: "page.section-nav",
    owner: "console-settings",
    description: "Navigation between console settings child pages.",
    surfaces: ["console"],
    variants: {
      compact: {
        outlet: "console-settings:primary-menu",
        renderers: {
          link: "local.main.ui.surface-aware-menu-link-item"
        }
      },
      medium: {
        outlet: "console-settings:primary-menu",
        renderers: {
          link: "local.main.ui.surface-aware-menu-link-item"
        }
      },
      expanded: {
        outlet: "console-settings:primary-menu",
        renderers: {
          link: "local.main.ui.surface-aware-menu-link-item"
        }
      }
    }
  });
  assert.deepEqual(findContribution("console.web.menu.settings"), {
    id: "console.web.menu.settings",
    target: "shell.primary-nav",
    kind: "link",
    surfaces: ["console"],
    order: 100,
    when: "auth.authenticated === true",
    source: "mutations.text#console-web-console-settings-placement"
  });
});

test("console-web console templates stay shell-driven", async () => {
  const wrapperSource = await readFile(path.join(PACKAGE_DIR, "templates", "src", "pages", "console.vue"), "utf8");
  const indexSource = await readFile(path.join(PACKAGE_DIR, "templates", "src", "pages", "console", "index.vue"), "utf8");
  const settingsSource = await readFile(path.join(PACKAGE_DIR, "templates", "src", "pages", "console", "settings.vue"), "utf8");
  const settingsIndexSource = await readFile(path.join(PACKAGE_DIR, "templates", "src", "pages", "console", "settings", "index.vue"), "utf8");

  assert.match(wrapperSource, /ShellLayout/);
  assert.match(wrapperSource, /"surface": "console"/);
  assert.match(indexSource, /Operations Console/);
  assert.match(settingsSource, /target="console-settings:primary-menu"/);
  assert.doesNotMatch(settingsSource, /default-link-component-token/);
  assert.match(settingsSource, /<RouterView \/>/);
  assert.match(settingsIndexSource, /definePage/);
  assert.match(settingsIndexSource, /your_child_segment/);
});
