function createWorkspaceRoleCatalogOutputSchema(Type) {
  if (!Type || typeof Type.Object !== "function" || typeof Type.Array !== "function" || typeof Type.String !== "function") {
    throw new TypeError("createWorkspaceRoleCatalogOutputSchema requires a TypeBox Type helper.");
  }

  return Type.Object(
    {
      collaborationEnabled: Type.Boolean(),
      defaultInviteRole: Type.String(),
      roles: Type.Array(Type.Object({}, { additionalProperties: true })),
      assignableRoleIds: Type.Array(Type.String({ minLength: 1 }))
    },
    { additionalProperties: true }
  );
}

function hasWorkspaceRoleCatalog(value = null) {
  const source = value && typeof value === "object" ? value : {};
  return Array.isArray(source.roles) && source.roles.length > 0 && Array.isArray(source.assignableRoleIds);
}

export {
  createWorkspaceRoleCatalogOutputSchema,
  hasWorkspaceRoleCatalog
};
