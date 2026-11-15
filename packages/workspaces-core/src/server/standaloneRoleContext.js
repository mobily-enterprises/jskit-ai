import { createUsersExtensions } from "@jskit-ai/users-core/server/usersExtensions";
import { USERS_IDENTITY_TABLES, createUsersIdentity } from "@jskit-ai/users-core/server/usersIdentity";
import { buildWorkspaceName } from "./common/services/workspaceDirectoryService.js";
import { noWorkspaceCreatedParticipant } from "./workspaceDirectory/noWorkspaceCreatedParticipant.js";
import { WORKSPACES_TABLES, createWorkspaceDirectory, createWorkspaceRecords } from "./workspacesRuntime.js";

// The tables a standalone runtime owns for createStandaloneRoleContext: a workspace names its owner, and a membership
// its user, so the users tables come with the workspaces tables.
const ROLE_CONTEXT_TABLES = Object.freeze([...USERS_IDENTITY_TABLES, ...WORKSPACES_TABLES]);

/**
 * `workspaces.core`'s `roleContext` for code outside a JSKIT server, such as a migration or seed script, on the
 * handles of its standalone runtime: the same function the server's capability holds, built the same way
 * (createWorkspaceDirectory) from the application's runtime config. So it takes the same arguments, answers the same
 * context and refuses the same calls: `roleContext({ workspaceId, userId, role, reason }, { context:
 * systemContext(reason), trx })`, the system context and `trx` being the script's own. The script owns
 * ROLE_CONTEXT_TABLES, with its own tables, through createStandaloneResources (which refuses them on the Knex client
 * of a JSKIT server: code inside a server takes `workspaces.core`'s):
 *
 *   const { resources, systemContext } = await createStandaloneResources({
 *     knex, feature: "seed", owns: [...ROLE_CONTEXT_TABLES, ...seedTables], systemScope: "seeds every workspace"
 *   });
 *   const roleContext = createStandaloneRoleContext({ resources, config });
 * @param {object} options
 * @param {Record<string, object>} options.resources The handles of a standalone runtime that owns ROLE_CONTEXT_TABLES.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeConfig} options.config The application's runtime config, as
 *   the server's `runtime.config` holds it: the tenancy mode, the role catalog and the workspace settings' defaults.
 * @returns {import("./types.js").WorkspacesCore["roleContext"]}
 */
function createStandaloneRoleContext({ resources, config }) {
  const missing = ROLE_CONTEXT_TABLES.filter((table) => !resources?.[table.name]).map((table) => table.name);
  if (missing.length > 0) {
    throw new TypeError(
      "createStandaloneRoleContext() takes the resources of a standalone runtime that owns ROLE_CONTEXT_TABLES " +
        "(createStandaloneResources({ knex, feature, owns: [...ROLE_CONTEXT_TABLES, ...yourTables], systemScope })). " +
        `Missing: ${missing.join(", ")}.`
    );
  }
  const { profiles } = createUsersIdentity({ resources, extensions: createUsersExtensions() });
  const records = createWorkspaceRecords(resources);
  return createWorkspaceDirectory({
    config,
    personalWorkspaceName: buildWorkspaceName,
    resources,
    userProfiles: profiles,
    workspaceCreatedParticipant: noWorkspaceCreatedParticipant,
    workspaces: records.workspaces,
    workspaceMemberships: records.memberships
  }).roleContext;
}

export { ROLE_CONTEXT_TABLES, createStandaloneRoleContext };
