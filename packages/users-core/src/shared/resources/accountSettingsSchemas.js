import { createSchema } from "json-rest-schema";

const accountAvatarOutputSchema = createSchema({
  uploadedUrl: { type: "string", required: true, nullable: true },
  gravatarUrl: { type: "string", required: true, minLength: 1 },
  effectiveUrl: { type: "string", required: true, minLength: 1 },
  hasUploadedAvatar: { type: "boolean", required: true },
  size: { type: "number", required: true, min: 1 },
  version: { type: "string", required: true, nullable: true }
});

const userProfileOutputSchema = createSchema({
  displayName: { type: "string", required: true },
  email: { type: "string", required: true },
  emailManagedBy: { type: "string", required: true },
  emailChangeFlow: { type: "string", required: true },
  avatar: {
    type: "object",
    required: true,
    schema: accountAvatarOutputSchema
  }
});

const accountSecurityMfaSchema = createSchema({
  status: { type: "string", required: true },
  enrolled: { type: "boolean", required: true },
  methods: {
    type: "array",
    required: true,
    items: { type: "string", minLength: 1 }
  }
});

const accountSecuritySessionsSchema = createSchema({
  canSignOutOtherDevices: { type: "boolean", required: true }
});

const accountSecurityAuthPolicySchema = createSchema({
  minimumEnabledMethods: { type: "integer", required: true, min: 1 },
  enabledMethodsCount: { type: "integer", required: true, min: 0 }
});

const accountSecurityAuthMethodSchema = createSchema({
  id: { type: "string", required: true },
  kind: { type: "string", required: true },
  provider: { type: "string", required: true, nullable: true },
  label: { type: "string", required: true },
  configured: { type: "boolean", required: true },
  enabled: { type: "boolean", required: true },
  canEnable: { type: "boolean", required: true },
  canDisable: { type: "boolean", required: true },
  supportsSecretUpdate: { type: "boolean", required: true },
  requiresCurrentPassword: { type: "boolean", required: true }
});

const accountSecurityStatusSchema = createSchema({
  mfa: {
    type: "object",
    required: true,
    schema: accountSecurityMfaSchema
  },
  sessions: {
    type: "object",
    required: true,
    schema: accountSecuritySessionsSchema
  },
  authPolicy: {
    type: "object",
    required: true,
    schema: accountSecurityAuthPolicySchema
  },
  authMethods: {
    type: "array",
    required: true,
    items: accountSecurityAuthMethodSchema
  }
});

export {
  accountAvatarOutputSchema,
  userProfileOutputSchema,
  accountSecurityStatusSchema
};
