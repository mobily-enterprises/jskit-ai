import {
  normalizeObject,
  OBJECT_INPUT_SCHEMA,
  requireAuthenticated,
  resolveRequest,
  resolveUser
} from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";

const accountProfileActions = Object.freeze([
  {
    id: "settings.read",
    version: 1,
    kind: "query",
    channels: ["api", "internal"],
    surfacesFrom: "enabled",
    visibility: "public",
    input: { schema: OBJECT_INPUT_SCHEMA },
    permission: requireAuthenticated,
    idempotency: "none",
    audit: {
      actionName: "settings.read"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.settingsService.getForUser(resolveRequest(context), resolveUser(context, input));
    }
  },
  {
    id: "settings.profile.update",
    version: 1,
    kind: "command",
    channels: ["api", "internal"],
    surfacesFrom: "enabled",
    visibility: "public",
    input: { schema: OBJECT_INPUT_SCHEMA },
    permission: requireAuthenticated,
    idempotency: "optional",
    audit: {
      actionName: "settings.profile.update"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.settingsService.updateProfile(resolveRequest(context), resolveUser(context, input), normalizeObject(input));
    }
  },
  {
    id: "settings.profile.avatar.upload",
    version: 1,
    kind: "command",
    channels: ["api", "internal"],
    surfacesFrom: "enabled",
    visibility: "public",
    input: { schema: OBJECT_INPUT_SCHEMA },
    permission: requireAuthenticated,
    idempotency: "none",
    audit: {
      actionName: "settings.profile.avatar.upload"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.settingsService.uploadAvatar(resolveRequest(context), resolveUser(context, input), normalizeObject(input));
    }
  },
  {
    id: "settings.profile.avatar.delete",
    version: 1,
    kind: "command",
    channels: ["api", "internal"],
    surfacesFrom: "enabled",
    visibility: "public",
    input: { schema: OBJECT_INPUT_SCHEMA },
    permission: requireAuthenticated,
    idempotency: "none",
    audit: {
      actionName: "settings.profile.avatar.delete"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.settingsService.deleteAvatar(resolveRequest(context), resolveUser(context, input), normalizeObject(input));
    }
  }
]);

export { accountProfileActions };
