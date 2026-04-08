export const roleCatalog = {
  workspace: {
    defaultInviteRole: "member"
  },
  roles: {
    owner: {
      assignable: false,
      permissions: ["*"]
    },
    admin: {
      assignable: true,
      inherits: "member",
      permissions: [
        "workspace.roles.view",
        "workspace.settings.update",
        "workspace.members.view",
        "workspace.members.invite",
        "workspace.members.manage",
        "workspace.invites.revoke"
      ]
    },
    member: {
      assignable: true,
      permissions: ["workspace.settings.view"]
    }
  }
};
