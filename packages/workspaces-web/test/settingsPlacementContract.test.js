import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import packageJson from "../package.json" with { type: "json" };

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const exampleRoot = path.join(packageRoot, "patterns", "workspace-surfaces", "example");
const placements = packageJson.jskit?.metadata?.ui?.placements;

function contribution(id) {
  return placements?.contributions?.find((entry) => entry.id === id) || null;
}

test("workspace surfaces pattern includes settings, invitations, and app-owned integration examples", async () => {
  const settings = await readFile(
    path.join(exampleRoot, "src", "pages", "admin", "workspace", "settings.vue"),
    "utf8"
  );
  const invites = await readFile(
    path.join(exampleRoot, "packages", "main", "src", "client", "components", "AccountSettingsInvitesSection.vue"),
    "utf8"
  );
  const invitationPage = await readFile(
    path.join(exampleRoot, "src", "pages", "invite", "[token].vue"),
    "utf8"
  );

  assert.match(settings, /target="admin-settings:primary-menu"/);
  assert.match(settings, /<RouterView \/>/);
  assert.doesNotMatch(settings, /<v-card\b|default-link-component-token/);
  assert.match(invites, /@jskit-ai\/workspaces-web\/client\/components\/AccountSettingsInvitesSection/);
  assert.match(invitationPage, /@jskit-ai\/workspaces-web\/client\/components\/WorkspaceInviteLanding/);
  assert.match(invitationPage, /<WorkspaceInviteLanding \/>/);
  assert.doesNotMatch(invitationPage, /\bfetch\s*\(/);
});

test("workspace settings and not-found examples use direct panels", async () => {
  for (const sourcePath of [
    path.join(exampleRoot, "src", "components", "WorkspaceNotFoundCard.vue"),
    path.join(packageRoot, "src", "client", "components", "WorkspacesClientElement.vue"),
    path.join(packageRoot, "src", "client", "components", "AccountSettingsInvitesSection.vue")
  ]) {
    const source = await readFile(sourcePath, "utf8");
    assert.doesNotMatch(source, /<v-card\b|v-card-title|v-card-subtitle/);
  }
});

test("workspace resource load states expose local retry actions", async () => {
  const expectations = new Map([
    ["src/client/components/WorkspacesClientElement.vue", /bootstrapLoadError[\s\S]*@click="refreshBootstrap"/],
    ["src/client/components/WorkspaceMembersClientElement.vue", /canRetryLoad[\s\S]*@click="refreshLoad"/]
  ]);

  for (const [relativePath, pattern] of expectations) {
    const source = await readFile(path.join(packageRoot, relativePath), "utf8");
    assert.match(source, pattern);
  }
});

test("workspace command loading follows the http-web proxyRefs contract", async () => {
  const expectations = new Map([
    [
      "src/client/components/WorkspaceMembersClientElement.vue",
      [/isCreatingInvite: Boolean\(inviteCreateCommand\.isRunning\)/, /inviteCreateCommand\.isRunning \|\| !canInviteMembers\.value/]
    ],
    [
      "src/client/components/WorkspacesClientElement.vue",
      [/const isCreatingWorkspace = computed\(\(\) => Boolean\(createWorkspaceCommand\.isRunning\)\)/]
    ],
    [
      "src/client/account-settings/useAccountSettingsInvitesSectionRuntime.js",
      [/const isResolvingInvite = computed\(\(\) => Boolean\(redeemInviteCommand\.isRunning\)\)/]
    ]
  ]);

  for (const [relativePath, patterns] of expectations) {
    const source = await readFile(path.join(packageRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /\.isRunning\.value/);
    for (const pattern of patterns) {
      assert.match(source, pattern);
    }
  }
});

test("workspace pattern includes pending-invite context and product-ready empty surfaces", async () => {
  const cue = await readFile(
    path.join(exampleRoot, "packages", "main", "src", "client", "components", "AccountPendingInvitesCue.vue"),
    "utf8"
  );
  const settingsLanding = await readFile(
    path.join(exampleRoot, "src", "pages", "admin", "workspace", "settings", "index.vue"),
    "utf8"
  );
  const appSurface = await readFile(path.join(exampleRoot, "src", "surfaces", "app", "index.vue"), "utf8");
  const adminSurface = await readFile(path.join(exampleRoot, "src", "surfaces", "admin", "index.vue"), "utf8");

  assert.match(cue, /placementContext\.value\?\.pendingInvitesCount/);
  assert.match(cue, /placementContext\.value\?\.workspaceInvitesEnabled/);
  assert.doesNotMatch(cue, /\bfetch\s*\(|\buseQuery\b/);
  assert.match(settingsLanding, /No settings sections yet/);
  assert.match(appSurface, /No workspace activity yet/);
  assert.match(adminSurface, /Manage members and workspace settings/);
  assert.doesNotMatch(appSurface, /Replace this page|Primary in-workspace surface/);
  assert.doesNotMatch(adminSurface, /Use this area|Privileged workspace workflows/);
});

test("workspaces-web metadata declares semantic outlets without source mutations", () => {
  assert.equal(packageJson.jskit?.mutations, undefined);
  assert.deepEqual(placements?.outlets, [
    {
      target: "admin-settings:primary-menu",
      surfaces: ["admin"],
      source: "patterns/workspace-surfaces/example/src/pages/admin/workspace/settings.vue"
    },
    {
      target: "admin-cog:primary-menu",
      surfaces: ["admin"],
      source: "src/client/components/WorkspaceToolsWidget.vue"
    }
  ]);
  assert.deepEqual(
    placements?.topology?.placements?.map(({ id, owner = null }) => ({ id, owner })),
    [
      { id: "page.section-nav", owner: "admin-settings" },
      { id: "admin.tools-menu", owner: null }
    ]
  );
});

test("workspace contributions identify live package source or reusable pattern source", () => {
  assert.equal(contribution("workspaces.workspace.menu.app")?.source, "patterns/workspace-surfaces/example/src/surfaces/app/index.vue");
  assert.equal(contribution("workspaces.workspace.menu.admin")?.source, "patterns/workspace-surfaces/example/src/surfaces/admin/index.vue");
  assert.equal(contribution("workspaces.profile.menu.surface-switch")?.source, "src/client/components/WorkspaceProfileSurfaceSwitchMenuItem.vue");
  assert.equal(contribution("workspaces.workspace.selector")?.source, "src/client/components/WorkspaceSelector.vue");
  assert.equal(
    contribution("workspaces.account.invites.cue")?.source,
    "patterns/workspace-surfaces/example/packages/main/src/client/components/AccountPendingInvitesCue.vue"
  );
  assert.equal(
    contribution("workspaces.account.settings.invites")?.source,
    "patterns/workspace-surfaces/example/packages/main/src/client/components/AccountSettingsInvitesSection.vue"
  );
  assert.equal(contribution("workspaces.workspace.tools.widget")?.source, "src/client/components/WorkspaceToolsWidget.vue");
  assert.equal(contribution("workspaces.workspace.menu.workspace-settings")?.source, "src/client/components/WorkspaceSettingsMenuItem.vue");
  assert.equal(contribution("workspaces.workspace.menu.members")?.source, "src/client/components/WorkspaceMembersMenuItem.vue");
  assert.equal(contribution("workspaces.workspace.settings.general"), null);
});
