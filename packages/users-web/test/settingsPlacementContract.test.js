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

test("users-web home tools widget exposes home-cog outlet", async () => {
  const source = await readFile(path.join(PACKAGE_DIR, "src", "client", "components", "UsersHomeToolsWidget.vue"), "utf8");

  assert.match(source, /import \{ HOME_COG_OUTLET \} from "\.\.\/\.\.\/shared\/toolsOutletContracts\.js";/);
  assert.match(source, /<ShellOutletMenuWidget/);
  assert.match(source, /:target="HOME_COG_OUTLET\.target"/);
  assert.match(source, /:default-link-component-token="HOME_COG_OUTLET\.defaultLinkComponentToken"/);
});

test("users-web account page template uses the package-owned account settings host", async () => {
  const source = await readFile(path.join(PACKAGE_DIR, "templates", "src", "pages", "account", "index.vue"), "utf8");

  assert.match(
    source,
    /import AccountSettingsClientElement from "@jskit-ai\/users-web\/client\/components\/AccountSettingsClientElement";/
  );
  assert.doesNotMatch(source, /components\/account\/settings\/AccountSettingsClientElement\.vue/);
});

test("users-web package-owned account settings host is fully placement-backed", async () => {
  const source = await readFile(
    path.join(PACKAGE_DIR, "src", "client", "components", "AccountSettingsClientElement.vue"),
    "utf8"
  );

  assert.match(source, /useAccountSettingsSections/);
  assert.doesNotMatch(source, /AccountSettingsProfileSection/);
  assert.doesNotMatch(source, /AccountSettingsPreferencesSection/);
  assert.doesNotMatch(source, /AccountSettingsNotificationsSection/);
});

test("users-web descriptor metadata advertises home cog outlet and standard home settings placements", () => {
  assert.deepEqual(
    readOutlets("home-cog:primary-menu"),
    [
      {
        target: "home-cog:primary-menu",
        defaultLinkComponentToken: "local.main.ui.surface-aware-menu-link-item",
        surfaces: ["home"],
        source: "src/client/components/UsersHomeToolsWidget.vue"
      }
    ]
  );
  assert.deepEqual(
    readOutlets("account-settings:sections"),
    [
      {
        target: "account-settings:sections",
        surfaces: ["account"],
        source: "src/client/components/AccountSettingsClientElement.vue"
      }
    ]
  );

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
    target: "home-cog:primary-menu",
    surfaces: ["home"],
    order: 100,
    componentToken: "local.main.ui.surface-aware-menu-link-item",
    when: "auth.authenticated === true",
    source: "mutations.text#users-web-home-tools-placement"
  });
  assert.equal(findContribution("users.home.settings.general"), null);
  expectContribution("users.account.settings.profile", {
    target: "account-settings:sections",
    surfaces: ["account"],
    order: 100,
    componentToken: "local.main.account-settings.section.profile",
    source: "mutations.text#users-web-account-settings-sections-placement"
  });
  expectContribution("users.account.settings.preferences", {
    target: "account-settings:sections",
    surfaces: ["account"],
    order: 200,
    componentToken: "local.main.account-settings.section.preferences",
    source: "mutations.text#users-web-account-settings-sections-placement"
  });
  expectContribution("users.account.settings.notifications", {
    target: "account-settings:sections",
    surfaces: ["account"],
    order: 300,
    componentToken: "local.main.account-settings.section.notifications",
    source: "mutations.text#users-web-account-settings-sections-placement"
  });

  expectTextMutation("users-web-home-tools-placement", {
    reason: "Append users-web home tools widget and settings menu placements into app-owned placement registry.",
    category: "users-web",
    skipIfContains: 'id: "users.home.tools.widget"',
    snippets: [
      'id: "users.home.tools.widget"',
      'componentToken: "users.web.home.tools.widget"',
      'id: "users.home.menu.settings"',
      'target: "home-cog:primary-menu"',
      'componentToken: "local.main.ui.surface-aware-menu-link-item"',
      'scopedSuffix: "/settings"',
      'unscopedSuffix: "/settings"'
    ]
  });
  expectTextMutation("users-web-account-settings-sections-placement", {
    reason: "Append users-web account settings section placements into the app-owned placement registry.",
    category: "users-web",
    skipIfContains: 'id: "users.account.settings.profile"',
    snippets: [
      'id: "users.account.settings.profile"',
      'componentToken: "local.main.account-settings.section.profile"',
      'value: "profile"',
      'id: "users.account.settings.preferences"',
      'componentToken: "local.main.account-settings.section.preferences"',
      'value: "preferences"',
      'id: "users.account.settings.notifications"',
      'componentToken: "local.main.account-settings.section.notifications"',
      'value: "notifications"'
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

  assert.equal(findFileMutation("users-web-component-account-settings-root"), null);
  assert.equal(findFileMutation("users-web-component-account-settings-invites"), null);
  assert.deepEqual(findFileMutation("users-web-component-account-settings-profile"), {
    from: "templates/src/components/account/settings/AccountSettingsProfileSection.vue",
    to: "src/components/account/settings/AccountSettingsProfileSection.vue",
    reason: "Install app-owned account settings profile section scaffold.",
    category: "users-web",
    id: "users-web-component-account-settings-profile"
  });
  assert.deepEqual(findFileMutation("users-web-component-account-settings-preferences"), {
    from: "templates/src/components/account/settings/AccountSettingsPreferencesSection.vue",
    to: "src/components/account/settings/AccountSettingsPreferencesSection.vue",
    reason: "Install app-owned account settings preferences section scaffold.",
    category: "users-web",
    id: "users-web-component-account-settings-preferences"
  });
  assert.deepEqual(findFileMutation("users-web-component-account-settings-notifications"), {
    from: "templates/src/components/account/settings/AccountSettingsNotificationsSection.vue",
    to: "src/components/account/settings/AccountSettingsNotificationsSection.vue",
    reason: "Install app-owned account settings notifications section scaffold.",
    category: "users-web",
    id: "users-web-component-account-settings-notifications"
  });
  assert.deepEqual(findTextMutation("users-web-main-client-provider-account-settings-profile-import"), {
    op: "append-text",
    file: "packages/main/src/client/providers/MainClientProvider.js",
    position: "top",
    skipIfContains:
      "import AccountSettingsProfileSection from \"/src/components/account/settings/AccountSettingsProfileSection.vue\";",
    value: "import AccountSettingsProfileSection from \"/src/components/account/settings/AccountSettingsProfileSection.vue\";\n",
    reason: "Bind the app-owned account profile settings section into local main client provider imports.",
    category: "users-web",
    id: "users-web-main-client-provider-account-settings-profile-import"
  });
  assert.deepEqual(findTextMutation("users-web-main-client-provider-account-settings-preferences-import"), {
    op: "append-text",
    file: "packages/main/src/client/providers/MainClientProvider.js",
    position: "top",
    skipIfContains:
      "import AccountSettingsPreferencesSection from \"/src/components/account/settings/AccountSettingsPreferencesSection.vue\";",
    value:
      "import AccountSettingsPreferencesSection from \"/src/components/account/settings/AccountSettingsPreferencesSection.vue\";\n",
    reason: "Bind the app-owned account preferences settings section into local main client provider imports.",
    category: "users-web",
    id: "users-web-main-client-provider-account-settings-preferences-import"
  });
  assert.deepEqual(findTextMutation("users-web-main-client-provider-account-settings-notifications-import"), {
    op: "append-text",
    file: "packages/main/src/client/providers/MainClientProvider.js",
    position: "top",
    skipIfContains:
      "import AccountSettingsNotificationsSection from \"/src/components/account/settings/AccountSettingsNotificationsSection.vue\";",
    value:
      "import AccountSettingsNotificationsSection from \"/src/components/account/settings/AccountSettingsNotificationsSection.vue\";\n",
    reason: "Bind the app-owned account notifications settings section into local main client provider imports.",
    category: "users-web",
    id: "users-web-main-client-provider-account-settings-notifications-import"
  });
  assert.deepEqual(findTextMutation("users-web-main-client-provider-account-settings-profile-register"), {
    op: "append-text",
    file: "packages/main/src/client/providers/MainClientProvider.js",
    position: "bottom",
    skipIfContains:
      "registerMainClientComponent(\"local.main.account-settings.section.profile\", () => AccountSettingsProfileSection);",
    value:
      "\nregisterMainClientComponent(\"local.main.account-settings.section.profile\", () => AccountSettingsProfileSection);\n",
    reason: "Bind the app-owned account profile settings section token into local main client provider registry.",
    category: "users-web",
    id: "users-web-main-client-provider-account-settings-profile-register"
  });
  assert.deepEqual(findTextMutation("users-web-main-client-provider-account-settings-preferences-register"), {
    op: "append-text",
    file: "packages/main/src/client/providers/MainClientProvider.js",
    position: "bottom",
    skipIfContains:
      "registerMainClientComponent(\"local.main.account-settings.section.preferences\", () => AccountSettingsPreferencesSection);",
    value:
      "\nregisterMainClientComponent(\"local.main.account-settings.section.preferences\", () => AccountSettingsPreferencesSection);\n",
    reason: "Bind the app-owned account preferences settings section token into local main client provider registry.",
    category: "users-web",
    id: "users-web-main-client-provider-account-settings-preferences-register"
  });
  assert.deepEqual(findTextMutation("users-web-main-client-provider-account-settings-notifications-register"), {
    op: "append-text",
    file: "packages/main/src/client/providers/MainClientProvider.js",
    position: "bottom",
    skipIfContains:
      "registerMainClientComponent(\"local.main.account-settings.section.notifications\", () => AccountSettingsNotificationsSection);",
    value:
      "\nregisterMainClientComponent(\"local.main.account-settings.section.notifications\", () => AccountSettingsNotificationsSection);\n",
    reason: "Bind the app-owned account notifications settings section token into local main client provider registry.",
    category: "users-web",
    id: "users-web-main-client-provider-account-settings-notifications-register"
  });

});
