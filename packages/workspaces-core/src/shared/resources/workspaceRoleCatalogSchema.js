import { createSchema } from "json-rest-schema";

const workspaceRoleDescriptorSchema = createSchema({
  id: { type: "string", required: true, minLength: 1, maxLength: 64 },
  assignable: { type: "boolean", required: true },
  permissions: {
    type: "array",
    required: true,
    items: { type: "string", minLength: 1 }
  }
});

const workspaceRoleCatalogSchema = createSchema({
  collaborationEnabled: { type: "boolean", required: true },
  defaultInviteRole: { type: "string", required: true, minLength: 0, maxLength: 64 },
  roles: {
    type: "array",
    required: true,
    items: workspaceRoleDescriptorSchema
  },
  assignableRoleIds: {
    type: "array",
    required: true,
    items: { type: "string", minLength: 1, maxLength: 64 }
  }
});

export {
  workspaceRoleCatalogSchema,
  workspaceRoleDescriptorSchema
};
