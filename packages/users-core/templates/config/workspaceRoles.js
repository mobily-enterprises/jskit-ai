export const workspaceRoles = {};

workspaceRoles.defaultInviteRole = "member";
workspaceRoles.roles = {};

workspaceRoles.roles.owner = {
  assignable: false,
  permissions: []
};
workspaceRoles.roles.owner.permissions.push("*");

workspaceRoles.roles.admin = {
  assignable: true,
  permissions: []
};
workspaceRoles.roles.admin.permissions.push(
  "workspace.roles.view",
  "workspace.settings.view",
  "workspace.settings.update",
  "workspace.members.view",
  "workspace.members.invite",
  "workspace.members.manage",
  "workspace.invites.revoke"
);

workspaceRoles.roles.member = {
  assignable: true,
  permissions: []
};
workspaceRoles.roles.member.permissions.push("workspace.settings.view");
