import assert from "node:assert/strict";
import test from "node:test";
import knexLib from "knex";
import { defineFeature } from "@jskit-ai/kernel/server/features";
import { startTestFeatures } from "@jskit-ai/resource-runtime/test";
import { UsersExtensionsProvider } from "@jskit-ai/users-core/server/UsersExtensionsProvider";
import { UsersIdentityProvider } from "@jskit-ai/users-core/server/UsersIdentityProvider";
import usersInitial from "../../users-core/migrations/users_core_generic_initial.cjs";
import usersUsername from "../../users-core/migrations/users_core_profile_username.cjs";
import usersUpdatedAt from "../../users-core/migrations/users_core_profile_updated_at.cjs";
import workspacesInitial from "../migrations/workspaces_core_initial.cjs";
import workspaceSettingsMigration from "../migrations/workspaces_core_workspace_settings_single_name_source.cjs";
import workspaceColorMigration from "../migrations/workspaces_core_workspaces_drop_color.cjs";
import { WorkspaceRecordsFeature } from "../src/test/WorkspaceRecordsFeature.js";

test("an app feature's test starts it beside the users and workspaces owners and reaches their records", async (t) => {
  const knex = knexLib({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  t.after(() => knex.destroy());
  for (const migration of [usersInitial, usersUsername, usersUpdatedAt, workspacesInitial, workspaceSettingsMigration, workspaceColorMigration]) {
    await migration.up(knex);
  }
  // An app feature that reads a workspace's members through workspaces.core's owner API.
  const RosterFeature = defineFeature({
    id: "roster",
    requires: { memberships: "workspaces.memberships" },
    provides: { roster: "roster" },
    setup: ({ memberships }) => ({ roster: Object.freeze({ memberIds: (workspaceId) => memberships.activeMemberIds(workspaceId) }) })
  });
  const { capabilities, resources, stop } = await startTestFeatures({
    knex,
    features: [RosterFeature, WorkspaceRecordsFeature, UsersIdentityProvider, UsersExtensionsProvider],
    requires: { roster: "roster", profiles: "users.profiles", workspaces: "workspaces", memberships: "workspaces.memberships" }
  });
  t.after(stop);
  const owner = await capabilities.profiles.upsert({ authProvider: "local", authProviderUserSid: "identity-ada", email: "ada@example.com", displayName: "Ada" });
  const workspace = await capabilities.workspaces.insert({ slug: "kept", name: "Kept", ownerUserId: owner.id });
  await capabilities.memberships.ensureOwnerMembership(workspace.id, owner.id);
  assert.deepEqual(await capabilities.roster.memberIds(workspace.id), [owner.id]);
  assert.deepEqual(resources.ownedTables().map(({ tableName }) => tableName).sort(), [
    "user_settings", "users", "workspace_invites", "workspace_memberships", "workspace_settings", "workspaces"
  ]);
});
