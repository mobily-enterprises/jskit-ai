import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import descriptor from "../package.descriptor.mjs";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = path.resolve(TEST_DIRECTORY, "..");

function readOutlets(host = "") {
  const outlets = descriptor?.metadata?.ui?.placements?.outlets;
  const normalizedTarget = String(host || "").trim();
  return Array.isArray(outlets)
    ? outlets.filter((entry) => String(entry?.target || "").trim() === normalizedTarget)
    : [];
}

function findContribution(id) {
  const contributions = descriptor?.metadata?.ui?.placements?.contributions;
  return Array.isArray(contributions)
    ? contributions.find((entry) => String(entry?.id || "").trim() === id) || null
    : null;
}

function findTextMutation(id) {
  const textMutations = descriptor?.mutations?.text;
  return Array.isArray(textMutations)
    ? textMutations.find((entry) => String(entry?.id || "").trim() === id) || null
    : null;
}

function findFileMutation(id) {
  const fileMutations = descriptor?.mutations?.files;
  return Array.isArray(fileMutations)
    ? fileMutations.find((entry) => String(entry?.id || "").trim() === id) || null
    : null;
}

function expectContribution(id, expected = {}) {
  const contribution = findContribution(id);
  assert.ok(contribution, `Expected contribution "${id}".`);

  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(contribution[key], value);
  }
}

function expectTextMutation(id, { reason = "", category = "", skipIfContains = "", snippets = [] } = {}) {
  const mutation = findTextMutation(id);
  assert.ok(mutation, `Expected text mutation "${id}".`);
  assert.equal(mutation.op, "append-text");
  assert.equal(mutation.file, "src/placement.js");
  assert.equal(mutation.position, "bottom");
  assert.equal(mutation.id, id);

  if (reason) {
    assert.equal(mutation.reason, reason);
  }

  if (category) {
    assert.equal(mutation.category, category);
  }

  if (skipIfContains) {
    assert.equal(mutation.skipIfContains, skipIfContains);
  }

  for (const snippet of snippets) {
    assert.ok(mutation.value.includes(snippet), `Expected mutation "${id}" to include "${snippet}".`);
  }
}

test("users-web console settings template exposes surface-derived settings outlets", async () => {
  const source = await readFile(path.join(PACKAGE_DIR, "templates", "src", "pages", "console", "settings.vue"), "utf8");

  assert.match(source, /target="console-settings:primary-menu"/);
  assert.match(source, /default-link-component-token="local\.main\.ui\.surface-aware-menu-link-item"/);
  assert.match(source, /<RouterView \/>/);
});

test("users-web console settings index template is a simple developer-owned stub", async () => {
  const source = await readFile(path.join(PACKAGE_DIR, "templates", "src", "pages", "console", "settings", "index.vue"), "utf8");

  assert.match(source, /definePage/);
  assert.match(source, /your_child_segment/);
});

test("users-web descriptor metadata advertises console settings outlets with standard positions", () => {
  const outlets = readOutlets("console-settings:primary-menu");
  assert.deepEqual(
    outlets,
    [
      {
        target: "console-settings:primary-menu",
        defaultLinkComponentToken: "local.main.ui.surface-aware-menu-link-item",
        surfaces: ["console"],
        source: "templates/src/pages/console/settings.vue"
      }
    ]
  );
  assert.deepEqual(findFileMutation("users-web-page-console-settings"), {
    from: "templates/src/pages/console/settings/index.vue",
    toSurface: "console",
    toSurfacePath: "settings/index.vue",
    reason: "Install console settings index stub scaffold for app-owned landing or redirect behavior.",
    category: "users-web",
    id: "users-web-page-console-settings"
  });
});

test("users-web home tools widget exposes home-tools outlet", async () => {
  const source = await readFile(path.join(PACKAGE_DIR, "src", "client", "components", "UsersHomeToolsWidget.vue"), "utf8");

  assert.match(source, /import \{ HOME_TOOLS_OUTLET \} from "\.\.\/\.\.\/shared\/toolsOutletContracts\.js";/);
  assert.match(source, /<ShellOutletMenuWidget/);
  assert.match(source, /:target="HOME_TOOLS_OUTLET\.target"/);
  assert.match(source, /:default-link-component-token="HOME_TOOLS_OUTLET\.defaultLinkComponentToken"/);
});

test("users-web workspace tools widget exposes workspace-tools outlet", async () => {
  const source = await readFile(path.join(PACKAGE_DIR, "src", "client", "components", "UsersWorkspaceToolsWidget.vue"), "utf8");

  assert.match(source, /import \{ WORKSPACE_TOOLS_OUTLET \} from "\.\.\/\.\.\/shared\/toolsOutletContracts\.js";/);
  assert.match(source, /<ShellOutletMenuWidget/);
  assert.match(source, /:target="WORKSPACE_TOOLS_OUTLET\.target"/);
  assert.match(source, /:default-link-component-token="WORKSPACE_TOOLS_OUTLET\.defaultLinkComponentToken"/);
});

test("users-web descriptor metadata advertises home tools outlet and standard home settings placements", () => {
  assert.deepEqual(
    readOutlets("home-tools:primary-menu"),
    [
      {
        target: "home-tools:primary-menu",
        defaultLinkComponentToken: "local.main.ui.surface-aware-menu-link-item",
        surfaces: ["home"],
        source: "src/client/components/UsersHomeToolsWidget.vue"
      }
    ]
  );

  expectContribution("users.home.menu.home", {
    target: "shell-layout:primary-menu",
    surfaces: ["*"],
    order: 50,
    componentToken: "local.main.ui.surface-aware-menu-link-item",
    when: "auth.authenticated === true",
    source: "mutations.text#users-web-home-shell-menu-placement"
  });

  expectContribution("users.profile.menu.settings", {
    target: "auth-profile-menu:primary-menu",
    surfaces: ["*"],
    order: 500,
    componentToken: "auth.web.profile.menu.link-item",
    when: "auth.authenticated === true",
    source: "mutations.text#users-web-profile-settings-placement"
  });

  expectContribution("users.home.tools.widget", {
    target: "shell-layout:top-right",
    surfaces: ["home"],
    order: 900,
    componentToken: "users.web.home.tools.widget",
    when: "auth.authenticated === true",
    source: "mutations.text#users-web-home-tools-placement"
  });

  expectContribution("users.home.menu.settings", {
    target: "home-tools:primary-menu",
    surfaces: ["home"],
    order: 100,
    componentToken: "local.main.ui.surface-aware-menu-link-item",
    when: "auth.authenticated === true",
    source: "mutations.text#users-web-home-tools-placement"
  });
  assert.equal(findContribution("users.home.settings.general"), null);

  expectTextMutation("users-web-home-tools-placement", {
    reason: "Append users-web home tools widget and settings menu placements into app-owned placement registry.",
    category: "users-web",
    skipIfContains: 'id: "users.home.tools.widget"',
    snippets: [
      'id: "users.home.tools.widget"',
      'componentToken: "users.web.home.tools.widget"',
      'id: "users.home.menu.settings"',
      'target: "home-tools:primary-menu"',
      'componentToken: "local.main.ui.surface-aware-menu-link-item"',
      'workspaceSuffix: "/settings"',
      'nonWorkspaceSuffix: "/settings"'
    ]
  });

  expectTextMutation("users-web-profile-settings-placement", {
    reason: "Append users-web profile settings menu placement into app-owned placement registry.",
    category: "users-web",
    skipIfContains: 'id: "users.profile.menu.settings"',
    snippets: [
      'id: "users.profile.menu.settings"',
      'target: "auth-profile-menu:primary-menu"',
      'componentToken: "auth.web.profile.menu.link-item"',
      'label: "Settings"',
      'to: "/account"'
    ]
  });

  expectTextMutation("users-web-home-shell-menu-placement", {
    reason: "Append users-web home shell menu placement into app-owned placement registry.",
    category: "users-web",
    skipIfContains: 'id: "users.home.menu.home"',
    snippets: [
      'id: "users.home.menu.home"',
      'target: "shell-layout:primary-menu"',
      'componentToken: "local.main.ui.surface-aware-menu-link-item"',
      'label: "Home"',
      'surface: "home"',
      'workspaceSuffix: "/"',
      'nonWorkspaceSuffix: "/"',
      'exact: true'
    ]
  });

});
