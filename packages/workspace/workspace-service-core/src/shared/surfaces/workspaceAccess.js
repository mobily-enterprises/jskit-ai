function denyWorkspaceAccess() {
  return {
    allowed: false,
    reason: "surface_not_supported",
    permissions: []
  };
}

export { denyWorkspaceAccess };
