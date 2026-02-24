const appConfig = {
  tenancyMode: "team-single",
  workspaceProvisioningMode: "self-serve",
  features: {
    workspaceSwitching: false,
    workspaceInvites: true,
    // Preserves prior effective default for non-personal tenancy when WORKSPACE_CREATE_ENABLED was unset.
    workspaceCreateEnabled: true
  },
  limits: {
    maxWorkspacesPerUser: 1
  }
};

export { appConfig };
