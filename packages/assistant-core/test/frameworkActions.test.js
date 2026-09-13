import assert from "node:assert/strict";
import test from "node:test";
import { readdir } from "node:fs/promises";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { resolveStructuredSchemaTransportSchema } from "@jskit-ai/kernel/shared/validators";
import { returnJsonApiData } from "@jskit-ai/http-runtime/shared";
import { createServiceToolCatalog } from "../src/server/lib/serviceToolCatalog.js";
import { createAssistantActions } from "../../assistant-runtime/src/server/actions.js";
import { accountSettingsResponseFormatter } from "../../users-core/src/server/common/formatters/accountSettingsResponseFormatter.js";
import { DEFAULT_USER_SETTINGS } from "../../users-core/src/shared/settings.js";

const specifications = [];
for (const owner of ["users-core", "workspaces-core", "console-core"]) {
  const directory = new URL(`../../${owner}/src/server/`, import.meta.url);
  for (const path of await readdir(directory, { recursive: true })) {
    if (!path.endsWith("Actions.js")) continue;
    const module = await import(new URL(path, directory));
    for (const [name, value] of Object.entries(module)) {
      if (name.endsWith("ActionSpecifications")) specifications.push(...value);
    }
  }
}
specifications.push(...createAssistantActions({ assistantConfigService: {}, chatService: {}, config: {
  surfaceDefinitions: { admin: {} },
  assistantSurfaces: { admin: { settingsSurfaceId: "admin", configScope: "global" } }
}}).filter((action) => action.channels.includes("automation")));

const workspace = { id: "11", slug: "acme", name: "Acme", ownerUserId: "7", avatarUrl: "" };
const roleCatalog = { collaborationEnabled: true, defaultInviteRole: "member", roles: [], assignableRoleIds: [] };
const memberResult = { workspace, members: [], roleCatalog };
const invite = { id: "31", email: "invite@example.test", roleSid: "member", status: "pending", expiresAt: "2026-10-01" };
const invitesResult = { workspace, invites: [invite], roleCatalog };
const settings = accountSettingsResponseFormatter({
  profile: { id: "7", displayName: "Alice", email: "alice@example.test" }, settings: DEFAULT_USER_SETTINGS
});
const workspaceSettings = {
  workspace: { id: "11", slug: "acme", ownerUserId: "7" }, roleCatalog,
  settings: { ...Object.fromEntries(["light", "dark"].flatMap((theme) =>
    ["Primary", "Secondary", "Surface", "SurfaceVariant"].map((color) => [`${theme}${color}Color`, "#112233"]))),
  invitesEnabled: true, invitesAvailable: true, invitesEffective: true }
};
// These are native service results, including HTTP wrappers and deliberately sensitive state.
const fixtures = {
  "settings.read": [{}, returnJsonApiData(settings)],
  "settings.profile.update": [{ displayName: "Alice" }, { session: { token: "SECRET" }, response: returnJsonApiData(settings) }],
  "settings.profile.avatar.delete": [{}, returnJsonApiData(settings)],
  "settings.preferences.update": [{ theme: "dark" }, returnJsonApiData(settings)],
  "settings.notifications.update": [{ productUpdates: false }, returnJsonApiData(settings)],
  "settings.security.password_method.toggle": [{ enabled: true }, returnJsonApiData({ securityStatus: settings.security, settings, session: "SECRET" })],
  "settings.security.oauth.unlink": [{ provider: "google" }, returnJsonApiData({ securityStatus: settings.security, providerMessageId: "SECRET" })],
  "settings.security.sessions.logout_others": [{}, null],
  "workspace.workspaces.create": [{ name: "Acme" }, { ...workspace, isPersonal: false, createdAt: "2026-09-13", updatedAt: "2026-09-13", deletedAt: null }],
  "workspace.workspaces.list": [{}, [{ ...workspace, roleSid: "owner", isAccessible: true, membershipStatus: "active", createdAt: "2026-09-13" }]],
  "workspace.workspaces.read": [{ workspaceSlug: "evil" }, { ...workspace, isPersonal: false, createdAt: "2026-09-13" }],
  "workspace.workspaces.update": [{ workspaceSlug: "evil", name: "Acme" }, workspace],
  "workspace.settings.read": [{ workspaceSlug: "evil" }, workspaceSettings],
  "workspace.settings.update": [{ workspaceSlug: "evil", invitesEnabled: false }, workspaceSettings],
  "workspace.roles.list": [{ workspaceSlug: "evil" }, roleCatalog],
  "workspace.members.list": [{ workspaceSlug: "evil" }, memberResult],
  "workspace.member.role.update": [{ workspaceSlug: "evil", memberUserId: "8", roleSid: "member" }, memberResult],
  "workspace.member.remove": [{ workspaceSlug: "evil", memberUserId: "8" }, memberResult],
  "workspace.invites.list": [{ workspaceSlug: "evil" }, invitesResult],
  "workspace.invite.create": [{ workspaceSlug: "evil", email: invite.email, roleSid: "member" }, {
    ...invitesResult, createdInviteId: "31", inviteTokenPreview: "SECRET", inviteUrl: "https://example.test/invite?token=SECRET",
    inviteDelivery: { status: "sent", message: "SECRET", providerMessageId: "SECRET" }
  }],
  "workspace.invite.revoke": [{ workspaceSlug: "evil", inviteId: "31" }, { ...invitesResult, revokedInviteId: "31" }],
  "workspace.invitations.pending.list": [{}, [{ id: "31", workspaceId: "11", workspaceSlug: "acme", workspaceName: "Acme",
    workspaceAvatarUrl: "", roleSid: "member", status: "pending", expiresAt: "2026-10-01", token: "SECRET" }]]
};

function catalogFor(spec, result, observe = () => {}) {
  const actions = createActionCatalogue();
  const service = new Proxy({}, { get: () => async (...args) => { observe(args); return result; } });
  const { run, ...definition } = spec;
  actions.register({ contributorId: "test.framework", domain: "framework", actions: [{
    ...definition, events: [], execute: (input, context) => {
      observe([input, context]);
      return run(service, input, context);
    }
  }] });
  return createServiceToolCatalog(actions);
}
const context = { actor: { id: "7" }, surface: "admin", workspace, workspaceSlug: "acme",
  permissions: ["workspace.settings.view", "workspace.settings.update", "workspace.roles.view", "workspace.members.view",
    "workspace.members.manage", "workspace.members.invite", "workspace.invites.revoke"] };

test("every account, workspace, console and assistant automation action has a contract or documented exclusion", () => {
  assert.equal(specifications.length, 31);
  let direct = 0;
  for (const spec of specifications) {
    const assistant = spec.extensions?.assistant;
    assert.ok(assistant, spec.id);
    if (assistant.exclude) { assert.ok(assistant.exclude.length > 20, spec.id); continue; }
    direct++;
    assert.ok(assistant.description, spec.id);
    assert.equal(typeof assistant.transformResult, "function", spec.id);
    assert.ok(resolveStructuredSchemaTransportSchema(assistant.output), spec.id);
    assert.ok(fixtures[spec.id], `Add execution coverage for ${spec.id}`);
  }
  assert.equal(direct, 22);
});

for (const spec of specifications.filter((entry) => !entry.extensions?.assistant?.exclude)) {
  test(`${spec.id}: discovers and executes through the action catalogue with validated safe output`, async () => {
    const [input, result] = fixtures[spec.id];
    const observed = [];
    const catalog = catalogFor(spec, result, (args) => observed.push(args));
    const toolSet = catalog.resolveToolSet(context);
    assert.equal(toolSet.tools.length, 1);
    const response = await catalog.executeToolCall({ toolName: toolSet.tools[0].name,
      argumentsText: JSON.stringify(input), context, toolSet });
    assert.equal(response.ok, true, JSON.stringify(response));
    assert.equal(JSON.stringify(response).includes("SECRET"), false);
    assert.equal(JSON.stringify(response).includes("__jskitJsonApiResult"), false);
    if (Object.hasOwn(input, "workspaceSlug")) assert.equal(observed[0][0].workspaceSlug, "acme");
  });
}

test("member operations deny execution after permissions change, even with a previously resolved tool set", async () => {
  for (const id of ["workspace.member.role.update", "workspace.member.remove", "workspace.invite.create", "workspace.invite.revoke"]) {
    const spec = specifications.find((entry) => entry.id === id);
    let calls = 0;
    const catalog = catalogFor(spec, fixtures[id][1], () => calls++);
    const toolSet = catalog.resolveToolSet(context);
    const response = await catalog.executeToolCall({ toolName: toolSet.tools[0].name, toolSet,
      argumentsText: JSON.stringify(fixtures[id][0]), context: { ...context, permissions: [] } });
    assert.equal(response.ok, false);
    assert.equal(calls, 0);
  }
});

test("excluded actions cannot be discovered or executed even when their HTTP output becomes structured", async () => {
  for (const spec of specifications.filter((entry) => entry.extensions?.assistant?.exclude)) {
    const catalog = catalogFor({ ...spec, output: specifications[0].input }, null, () => assert.fail("Excluded action executed"));
    const toolSet = catalog.resolveToolSet(context);
    assert.equal(toolSet.tools.length, 0, spec.id);
    assert.equal((await catalog.executeToolCall({ toolName: spec.id, context, toolSet })).ok, false);
  }
});

test("unexpected nested output fields fail closed without entering the tool result", async () => {
  const spec = specifications.find((entry) => entry.id === "settings.read");
  const catalog = catalogFor(spec, returnJsonApiData({ ...settings, security: { ...settings.security, token: "SECRET" } }));
  const toolSet = catalog.resolveToolSet(context);
  const response = await catalog.executeToolCall({ toolName: toolSet.tools[0].name, context, toolSet });
  assert.equal(response.ok, false);
  assert.equal(response.error.code, "assistant_tool_output_invalid");
  assert.equal(JSON.stringify(response).includes("SECRET"), false);
});
