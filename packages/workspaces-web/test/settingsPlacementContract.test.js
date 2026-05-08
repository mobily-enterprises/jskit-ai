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

test("workspaces-web admin settings template exposes surface-derived settings outlets", async () => {
  const source = await readFile(
    path.join(PACKAGE_DIR, "templates", "src", "pages", "admin", "workspace", "settings.vue"),
    "utf8"
  );

  assert.match(source, /target="admin-settings:primary-menu"/);
  assert.doesNotMatch(source, /default-link-component-token/);
  assert.match(source, /<RouterView \/>/);
});

test("workspaces-web installs an app-owned account invites section wrapper", async () => {
  const source = await readFile(
    path.join(PACKAGE_DIR, "templates", "packages", "main", "src", "client", "components", "AccountSettingsInvitesSection.vue"),
    "utf8"
  );

  assert.match(
    source,
    /@jskit-ai\/workspaces-web\/client\/components\/AccountSettingsInvitesSection/
  );
  assert.deepEqual(findFileMutation("users-web-main-component-account-settings-invites-section"), {
    from: "templates/packages/main/src/client/components/AccountSettingsInvitesSection.vue",
    to: "packages/main/src/client/components/AccountSettingsInvitesSection.vue",
    reason: "Install app-owned account invites section scaffold for multihoming account settings.",
    category: "workspaces-web",
    id: "users-web-main-component-account-settings-invites-section"
  });
});

test("workspaces-web installs an account invites cue scaffold that reads placement runtime state", async () => {
  const source = await readFile(
    path.join(PACKAGE_DIR, "templates", "packages", "main", "src", "client", "components", "AccountPendingInvitesCue.vue"),
    "utf8"
  );

  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /\buseQuery\b/);
  assert.match(source, /placementContext\.value\?\.pendingInvitesCount/);
  assert.match(source, /placementContext\.value\?\.workspaceInvitesEnabled/);
  assert.deepEqual(findFileMutation("users-web-main-component-account-pending-invites-cue"), {
    from: "templates/packages/main/src/client/components/AccountPendingInvitesCue.vue",
    to: "packages/main/src/client/components/AccountPendingInvitesCue.vue",
    reason: "Install app-owned account pending invites cue component scaffold.",
    category: "workspaces-web",
    id: "users-web-main-component-account-pending-invites-cue"
  });
});

test("workspaces-web admin settings index template is a simple developer-owned stub", async () => {
  const source = await readFile(
    path.join(PACKAGE_DIR, "templates", "src", "pages", "admin", "workspace", "settings", "index.vue"),
    "utf8"
  );

  assert.match(source, /definePage/);
  assert.match(source, /your_child_segment/);
});

test("workspaces-web descriptor metadata advertises admin settings outlets", () => {
  assert.deepEqual(
    readOutlets("admin-settings:primary-menu"),
    [
      {
        target: "admin-settings:primary-menu",
        surfaces: ["admin"],
        source: "templates/src/pages/admin/workspace/settings.vue"
      }
    ]
  );
  assert.deepEqual(
    readOutlets("admin-cog:primary-menu"),
    [
      {
        target: "admin-cog:primary-menu",
        surfaces: ["admin"],
        source: "src/client/components/UsersWorkspaceToolsWidget.vue"
      }
    ]
  );
  assert.deepEqual(findTopology("page.section-nav", "admin-settings"), {
    id: "page.section-nav",
    owner: "admin-settings",
    description: "Navigation between workspace admin settings child pages.",
    surfaces: ["admin"],
    variants: {
      compact: {
        outlet: "admin-settings:primary-menu",
        renderers: {
          link: "local.main.ui.surface-aware-menu-link-item"
        }
      },
      medium: {
        outlet: "admin-settings:primary-menu",
        renderers: {
          link: "local.main.ui.surface-aware-menu-link-item"
        }
      },
      expanded: {
        outlet: "admin-settings:primary-menu",
        renderers: {
          link: "local.main.ui.surface-aware-menu-link-item"
        }
      }
    }
  });
  assert.deepEqual(findTopology("admin.tools-menu"), {
    id: "admin.tools-menu",
    description: "Admin surface tools menu actions.",
    surfaces: ["admin"],
    variants: {
      compact: {
        outlet: "admin-cog:primary-menu",
        renderers: {
          link: "local.main.ui.surface-aware-menu-link-item"
        }
      },
      medium: {
        outlet: "admin-cog:primary-menu",
        renderers: {
          link: "local.main.ui.surface-aware-menu-link-item"
        }
      },
      expanded: {
        outlet: "admin-cog:primary-menu",
        renderers: {
          link: "local.main.ui.surface-aware-menu-link-item"
        }
      }
    }
  });
  assert.equal(findContribution("workspaces.workspace.settings.general"), null);
  assert.deepEqual(findContribution("workspaces.workspace.menu.app"), {
    id: "workspaces.workspace.menu.app",
    target: "shell.primary-nav",
    kind: "link",
    surfaces: ["app"],
    order: 50,
    when: "auth.authenticated === true",
    source: "mutations.text#workspaces-web-placement-block"
  });
  assert.deepEqual(findContribution("workspaces.workspace.menu.admin"), {
    id: "workspaces.workspace.menu.admin",
    target: "shell.primary-nav",
    kind: "link",
    surfaces: ["admin"],
    order: 60,
    when: "auth.authenticated === true",
    source: "mutations.text#workspaces-web-placement-block"
  });
  assert.match(findTextMutation("workspaces-web-placement-block")?.value || "", /id: "workspaces\.workspace\.menu\.app"[\s\S]*surfaces: \["app"\][\s\S]*label: "Home"/);
  assert.match(findTextMutation("workspaces-web-placement-block")?.value || "", /id: "workspaces\.workspace\.menu\.admin"[\s\S]*surfaces: \["admin"\][\s\S]*label: "Home"/);
  assert.deepEqual(findContribution("workspaces.profile.menu.surface-switch"), {
    id: "workspaces.profile.menu.surface-switch",
    target: "auth.profile-menu",
    kind: "component",
    surfaces: ["*"],
    order: 100,
    componentToken: "workspaces.web.profile.menu.surface-switch-item",
    when: "auth.authenticated === true",
    source: "mutations.text#workspaces-web-profile-surface-switch-placement"
  });
  assert.deepEqual(findContribution("workspaces.workspace.selector"), {
    id: "workspaces.workspace.selector",
    target: "shell.identity",
    kind: "component",
    surfaces: ["*"],
    order: 200,
    componentToken: "workspaces.web.workspace.selector",
    when: "auth.authenticated === true",
    source: "mutations.text#workspaces-web-placement-block"
  });
  assert.deepEqual(findContribution("workspaces.account.settings.invites"), {
    id: "workspaces.account.settings.invites",
    target: "settings.sections",
    owner: "account-settings",
    kind: "component",
    surfaces: ["account"],
    order: 400,
    componentToken: "local.main.account-settings.section.invites",
    when: "auth.authenticated === true && workspaceInvitesEnabled === true",
    source: "mutations.text#workspaces-web-account-settings-placement"
  });
  assert.match(findTextMutation("workspaces-web-account-settings-placement")?.value || "", /id: "workspaces\.account\.settings\.invites"/);
  assert.match(findTextMutation("workspaces-web-account-settings-placement")?.value || "", /target: "settings\.sections"/);
  assert.match(findTextMutation("workspaces-web-account-settings-placement")?.value || "", /owner: "account-settings"/);
  assert.match(findTextMutation("workspaces-web-account-settings-placement")?.value || "", /componentToken: "local\.main\.account-settings\.section\.invites"/);
  assert.equal(findTextMutation("workspaces-web-admin-placement-topology")?.file, "src/placementTopology.js");
  assert.match(findTextMutation("workspaces-web-admin-placement-topology")?.value || "", /id: "page\.section-nav"/);
  assert.match(findTextMutation("workspaces-web-admin-placement-topology")?.value || "", /owner: "admin-settings"/);
  assert.match(findTextMutation("workspaces-web-admin-placement-topology")?.value || "", /outlet: "admin-settings:primary-menu"/);
  assert.match(findTextMutation("workspaces-web-admin-placement-topology")?.value || "", /id: "admin\.tools-menu"/);
  assert.match(findTextMutation("workspaces-web-admin-placement-topology")?.value || "", /outlet: "admin-cog:primary-menu"/);
  assert.deepEqual(findFileMutation("users-web-page-admin-workspace-settings"), {
    from: "templates/src/pages/admin/workspace/settings/index.vue",
    toSurface: "admin",
    toSurfacePath: "workspace/settings/index.vue",
    reason: "Install workspace settings index stub scaffold for app-owned landing or redirect behavior.",
    category: "workspaces-web",
    id: "users-web-page-admin-workspace-settings",
    when: {
      config: "tenancyMode",
      in: ["personal", "workspaces"]
    }
  });
  assert.match(
    findTextMutation("users-web-main-client-provider-account-settings-section-import")?.value || "",
    /import AccountSettingsInvitesSection from "\.\.\/components\/AccountSettingsInvitesSection\.vue";/
  );
  assert.match(
    findTextMutation("users-web-main-client-provider-account-settings-section-register")?.value || "",
    /registerMainClientComponent\("local\.main\.account-settings\.section\.invites", \(\) => AccountSettingsInvitesSection\);/
  );
});
