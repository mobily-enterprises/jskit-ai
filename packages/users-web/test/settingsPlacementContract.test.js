import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import packageJson from "../package.json" with { type: "json" };

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = path.resolve(TEST_DIRECTORY, "..");
const placements = packageJson.jskit?.metadata?.ui?.placements;

function contributions() {
  return Array.isArray(placements?.contributions) ? placements.contributions : [];
}

function contribution(id) {
  return contributions().find((entry) => entry.id === id) || null;
}

test("account settings load state exposes a local retry action", async () => {
  const source = await readFile(
    path.join(PACKAGE_DIR, "src", "client", "components", "AccountSettingsClientElement.vue"),
    "utf8"
  );

  assert.match(source, /settingsLoadError/);
  assert.match(source, /@click="runtime\.refreshSettings"/);
});

test("users-web home tools widget exposes the semantic home-cog outlet", async () => {
  const source = await readFile(
    path.join(PACKAGE_DIR, "src", "client", "components", "UsersHomeToolsWidget.vue"),
    "utf8"
  );

  assert.match(source, /import \{ HOME_COG_OUTLET \} from "\.\.\/\.\.\/shared\/toolsOutletContracts\.js";/);
  assert.match(source, /<ShellOutletMenuWidget/);
  assert.match(source, /:target="HOME_COG_OUTLET\.target"/);
  assert.doesNotMatch(source, /default-link-component-token/);
});

test("account settings pattern keeps the app-owned route and sections as adaptable examples", async () => {
  const exampleRoot = path.join(PACKAGE_DIR, "patterns", "account-settings", "example");
  const page = await readFile(path.join(exampleRoot, "src", "pages", "account", "index.vue"), "utf8");

  assert.match(
    page,
    /import AccountSettingsClientElement from "@jskit-ai\/users-web\/client\/components\/AccountSettingsClientElement";/
  );

  for (const filename of [
    "AccountSettingsProfileSection.vue",
    "AccountSettingsPreferencesSection.vue",
    "AccountSettingsNotificationsSection.vue"
  ]) {
    const source = await readFile(
      path.join(exampleRoot, "src", "components", "account", "settings", filename),
      "utf8"
    );
    assert.match(source, /account-settings-section/);
    assert.doesNotMatch(source, /<v-card\b|v-card-title|v-card-subtitle/);
  }
});

test("profile copy remains authentication-provider neutral", async () => {
  for (const sourcePath of [
    path.join("src", "client", "components", "ProfileClientElement.vue"),
    path.join(
      "patterns",
      "account-settings",
      "example",
      "src",
      "components",
      "account",
      "settings",
      "AccountSettingsProfileSection.vue"
    )
  ]) {
    const source = await readFile(path.join(PACKAGE_DIR, sourcePath), "utf8");
    assert.match(source, /Managed by your sign-in account/);
    assert.doesNotMatch(source, /Managed by Supabase Auth/);
  }
});

test("package-owned account settings host is placement-backed rather than scaffold-backed", async () => {
  const source = await readFile(
    path.join(PACKAGE_DIR, "src", "client", "components", "AccountSettingsClientElement.vue"),
    "utf8"
  );

  assert.match(source, /useAccountSettingsSections/);
  assert.match(source, /settings-panel__header/);
  assert.doesNotMatch(source, /AccountSettingsProfileSection|AccountSettingsPreferencesSection|AccountSettingsNotificationsSection/);
});

test("users-web declares semantic outlets and topology without source mutations", () => {
  assert.equal(packageJson.jskit?.mutations, undefined);
  assert.deepEqual(placements?.outlets, [
    {
      target: "home-cog:primary-menu",
      surfaces: ["home"],
      source: "src/client/components/UsersHomeToolsWidget.vue"
    },
    {
      target: "account-settings:sections",
      surfaces: ["account"],
      source: "src/client/components/AccountSettingsClientElement.vue"
    }
  ]);
  assert.deepEqual(
    placements?.topology?.placements?.map(({ id, owner = null }) => ({ id, owner })),
    [
      { id: "home.tools-menu", owner: null },
      { id: "settings.sections", owner: "account-settings" }
    ]
  );
});

test("semantic contributions identify live package source or reusable pattern source", () => {
  assert.deepEqual(contribution("users.home.tools.widget"), {
    id: "users.home.tools.widget",
    target: "shell.status",
    kind: "component",
    surfaces: ["home"],
    order: 900,
    componentToken: "users.web.home.tools.widget",
    when: "auth.authenticated === true",
    source: "src/client/components/UsersHomeToolsWidget.vue"
  });
  assert.equal(contribution("users.profile.menu.settings")?.source, "patterns/account-settings/PATTERN.md");
  assert.equal(contribution("users.home.menu.settings")?.source, "patterns/account-settings/PATTERN.md");
  assert.equal(
    contribution("users.account.settings.profile")?.source,
    "patterns/account-settings/example/src/components/account/settings/AccountSettingsProfileSection.vue"
  );
  assert.equal(
    contribution("users.account.settings.preferences")?.source,
    "patterns/account-settings/example/src/components/account/settings/AccountSettingsPreferencesSection.vue"
  );
  assert.equal(
    contribution("users.account.settings.notifications")?.source,
    "patterns/account-settings/example/src/components/account/settings/AccountSettingsNotificationsSection.vue"
  );
  assert.equal(contribution("users.home.settings.general"), null);
});
