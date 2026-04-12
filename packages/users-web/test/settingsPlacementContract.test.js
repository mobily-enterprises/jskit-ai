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
  const normalizedHost = String(host || "").trim();
  return Array.isArray(outlets)
    ? outlets.filter((entry) => String(entry?.host || "").trim() === normalizedHost)
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

  assert.match(source, /<ShellOutlet host="console-settings" position="primary-menu" \/>/);
});

test("users-web descriptor metadata advertises console settings outlets with standard positions", () => {
  const outlets = readOutlets("console-settings");
  assert.deepEqual(
    outlets,
    [
      {
        host: "console-settings",
        position: "primary-menu",
        surfaces: ["console"],
        source: "templates/src/pages/console/settings.vue"
      }
    ]
  );
});

test("users-web home tools widget exposes home-tools outlet", async () => {
  const source = await readFile(path.join(PACKAGE_DIR, "src", "client", "components", "UsersHomeToolsWidget.vue"), "utf8");

  assert.match(source, /<ShellOutletMenuWidget/);
  assert.match(source, /host="home-tools"/);
  assert.match(source, /position="primary-menu"/);
});

test("users-web descriptor metadata advertises home tools outlet and standard home settings placements", () => {
  assert.deepEqual(
    readOutlets("home-tools"),
    [
      {
        host: "home-tools",
        position: "primary-menu",
        surfaces: ["home"],
        source: "src/client/components/UsersHomeToolsWidget.vue"
      }
    ]
  );

  expectContribution("users.home.menu.home", {
    host: "shell-layout",
    position: "primary-menu",
    surfaces: ["*"],
    order: 50,
    componentToken: "users.web.shell.surface-aware-menu-link-item",
    when: "auth.authenticated === true",
    source: "mutations.text#users-web-home-shell-menu-placement"
  });

  expectContribution("users.home.tools.widget", {
    host: "shell-layout",
    position: "top-right",
    surfaces: ["home"],
    order: 900,
    componentToken: "users.web.home.tools.widget",
    when: "auth.authenticated === true",
    source: "mutations.text#users-web-home-tools-placement"
  });

  expectContribution("users.home.menu.settings", {
    host: "home-tools",
    position: "primary-menu",
    surfaces: ["home"],
    order: 100,
    componentToken: "users.web.shell.surface-aware-menu-link-item",
    when: "auth.authenticated === true",
    source: "mutations.text#users-web-home-tools-placement"
  });

  expectContribution("users.home.settings.general", {
    host: "home-settings",
    position: "primary-menu",
    surfaces: ["home"],
    order: 100,
    componentToken: "users.web.shell.surface-aware-menu-link-item",
    when: "auth.authenticated === true",
    source: "mutations.text#users-web-home-settings-general-placement"
  });

  expectTextMutation("users-web-home-tools-placement", {
    reason: "Append users-web home tools widget and settings menu placements into app-owned placement registry.",
    category: "users-web",
    skipIfContains: 'id: "users.home.tools.widget"',
    snippets: [
      'id: "users.home.tools.widget"',
      'componentToken: "users.web.home.tools.widget"',
      'id: "users.home.menu.settings"',
      'host: "home-tools"',
      'componentToken: "users.web.shell.surface-aware-menu-link-item"',
      'workspaceSuffix: "/settings"',
      'nonWorkspaceSuffix: "/settings"'
    ]
  });

  expectTextMutation("users-web-home-shell-menu-placement", {
    reason: "Append users-web home shell menu placement into app-owned placement registry.",
    category: "users-web",
    skipIfContains: 'id: "users.home.menu.home"',
    snippets: [
      'id: "users.home.menu.home"',
      'host: "shell-layout"',
      'componentToken: "users.web.shell.surface-aware-menu-link-item"',
      'label: "Home"',
      'surface: "home"',
      'workspaceSuffix: "/"',
      'nonWorkspaceSuffix: "/"'
    ]
  });

  expectTextMutation("users-web-home-settings-general-placement", {
    reason: "Append users-web home settings general-page placement into app-owned placement registry.",
    category: "users-web",
    skipIfContains: 'id: "users.home.settings.general"',
    snippets: [
      'id: "users.home.settings.general"',
      'host: "home-settings"',
      'componentToken: "users.web.shell.surface-aware-menu-link-item"',
      'label: "General"',
      'workspaceSuffix: "/settings"',
      'nonWorkspaceSuffix: "/settings"'
    ]
  });
});
