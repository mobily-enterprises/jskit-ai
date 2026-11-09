import knexLib from "knex";
import { after } from "node:test";
import { requireTestDatabase } from "@jskit-ai/database-runtime/server/testDatabases";
import { createTestResourceRuntime } from "@jskit-ai/resource-runtime/test";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import { UsersIdentityProvider } from "@jskit-ai/users-core/server/UsersIdentityProvider";
import { createUsersExtensions } from "@jskit-ai/users-core/server/usersExtensions";
import usersInitial from "../../../users-core/migrations/users_core_generic_initial.cjs";
import usersUsername from "../../../users-core/migrations/users_core_profile_username.cjs";
import usersUpdatedAt from "../../../users-core/migrations/users_core_profile_updated_at.cjs";
import workspacesInitial from "../../migrations/workspaces_core_initial.cjs";
import workspaceSettingsMigration from "../../migrations/workspaces_core_workspace_settings_single_name_source.cjs";
import workspaceColorMigration from "../../migrations/workspaces_core_workspaces_drop_color.cjs";
import { createWorkspaceRecords } from "../../src/server/WorkspacesFeature.js";
import { createRepository as createInvitesRepository } from "../../src/server/common/repositories/workspaceInvitesRepository.js";
import { createRepository as createMemberPagesRepository } from "../../src/server/common/repositories/workspaceMemberPagesRepository.js";
import { createRepository as createSettingsRepository } from "../../src/server/workspaceSettings/workspaceSettingsRepository.js";
import { workspaceInvitesResource } from "../../src/shared/resources/workspaceInvitesResource.js";
import { workspaceMembershipsResource } from "../../src/shared/resources/workspaceMembershipsResource.js";
import { workspaceResource } from "../../src/shared/resources/workspaceResource.js";
import { workspaceSettingsResource } from "../../src/shared/resources/workspaceSettingsResource.js";
import { createWorkspaceRoleCatalog } from "../../src/shared/roles.js";

// The migrated users and workspaces tables in a MariaDB/MySQL database of the test file's own, named after
// TEST_DB_NAME with the file's suffix, so the characterization files run in parallel. The database is made on first
// use and dropped when the file ends. Each test keeps to its own users and workspaces (names carry the test's tag).
const MIGRATIONS = [usersInitial, usersUsername, usersUpdatedAt, workspacesInitial, workspaceSettingsMigration, workspaceColorMigration];

// The roles the characterization uses: an owner, and assignable admin and member roles.
const ROLE_CATALOG = createWorkspaceRoleCatalog({
  roleCatalog: {
    workspace: { defaultInviteRole: "member" },
    roles: {
      owner: { label: "Owner", assignable: false, permissions: ["*"] },
      admin: { label: "Admin", assignable: true, permissions: ["workspace.members.manage", "workspace.members.invite"] },
      member: { label: "Member", assignable: true, permissions: [] }
    }
  }
});

async function openDatabase(suffix, cleanups) {
  const name = `${requireTestDatabase(process.env)}_${suffix}`;
  if (name.length > 64) throw new Error(`Test database name ${name} is longer than MySQL's 64 characters.`);
  const server = {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    // The mysql2 options database-runtime's connection gives an application, so records read as apps see them.
    supportBigNumbers: true,
    bigNumberStrings: true,
    dateStrings: ["DATE"],
    timezone: "Z"
  };
  const admin = knexLib({ client: "mysql2", connection: server, pool: { min: 0, max: 1 } });
  const knex = knexLib({ client: "mysql2", connection: { ...server, database: name }, pool: { min: 0, max: 6 } });
  cleanups.push(async () => {
    try {
      await knex.destroy();
      await admin.raw("DROP DATABASE IF EXISTS ??", [name]);
    } finally {
      await admin.destroy();
    }
  });
  await admin.raw("DROP DATABASE IF EXISTS ??", [name]);
  await admin.raw("CREATE DATABASE ??", [name]);
  for (const migration of MIGRATIONS) await migration.up(knex);
  // The users and workspaces tables, owned as UsersIdentityProvider and WorkspacesFeature own them.
  const runtime = await createTestResourceRuntime({ knex, logger: silentLogger });
  const usersExtensions = createUsersExtensions();
  const { profiles, settings: userSettings, profileProjector } = await UsersIdentityProvider.setup({
    extensions: usersExtensions,
    actionCatalogue: { register() {} },
    resourceRuntime: runtime
  }, {});
  const resources = await runtime.own("workspaces.core", [
    workspaceResource,
    workspaceMembershipsResource,
    workspaceInvitesResource,
    workspaceSettingsResource
  ]);
  const records = createWorkspaceRecords(resources);
  return Object.freeze({
    name,
    knex,
    runtime,
    profiles,
    userSettings,
    profileProjector,
    usersExtensions,
    roleCatalog: ROLE_CATALOG,
    workspaces: records.workspaces,
    memberships: records.memberships,
    memberPages: createMemberPagesRepository({ workspaceMemberships: resources.workspaceMemberships, userProfiles: profiles }),
    invites: createInvitesRepository({ workspaceInvites: resources.workspaceInvites, workspaces: records.workspaces }),
    settings: createSettingsRepository({
      workspaceSettings: resources.workspaceSettings,
      defaultInvitesEnabled: true,
      defaultColorSettings: {}
    }),
    // A user whose email and identity carry `name`.
    createProfile: (name, options) => profiles.upsert({
      authProvider: "local",
      authProviderUserSid: `identity-${name}`,
      email: `${name}@example.test`,
      displayName: name
    }, options)
  });
}

/**
 * The file's database: call it at the file's top level, then `await open()` in each test after
 * requireTestDatabase(). The database is made by the first test that opens it and dropped after the file's tests.
 * @param {string} suffix A short name unique to the test file, such as "da_ws_invites".
 */
function workspacesDatabase(suffix) {
  const cleanups = [];
  let opening = null;
  after(async () => {
    if (opening) await opening.catch(() => {});
    for (const cleanup of cleanups) await cleanup();
  });
  return Object.freeze({
    open() {
      opening ??= openDatabase(suffix, cleanups);
      return opening;
    }
  });
}

export { ROLE_CATALOG, workspacesDatabase };
