import usersInitial from "../../../users-core/migrations/users_core_generic_initial.cjs";
import usersUsername from "../../../users-core/migrations/users_core_profile_username.cjs";
import usersUpdatedAt from "../../../users-core/migrations/users_core_profile_updated_at.cjs";
import workspacesInitial from "../../migrations/workspaces_core_initial.cjs";
import membershipsAcceptedInvite from "../../migrations/workspaces_core_memberships_accepted_invite.cjs";
import settingsInvitesRequireSameEmail from "../../migrations/workspaces_core_settings_invites_require_same_email.cjs";
import workspaceSettingsSingleNameSource from "../../migrations/workspaces_core_workspace_settings_single_name_source.cjs";
import workspacesDropColor from "../../migrations/workspaces_core_workspaces_drop_color.cjs";

// The users and workspaces tables' migrations the tests run, in the order an application's db:migrate runs them,
// without the index and collation ones the tests that need them run themselves.
const WORKSPACES_TEST_MIGRATIONS = Object.freeze([
  usersInitial,
  usersUsername,
  usersUpdatedAt,
  workspacesInitial,
  membershipsAcceptedInvite,
  settingsInvitesRequireSameEmail,
  workspaceSettingsSingleNameSource,
  workspacesDropColor
]);

export { WORKSPACES_TEST_MIGRATIONS };
