import {
  normalizeObject,
  OBJECT_INPUT_SCHEMA,
  requireAuthenticated,
  resolveRequest,
  resolveUser
} from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";

const accountChatActions = Object.freeze([
  {
    id: "settings.chat.update",
    version: 1,
    kind: "command",
    channels: ["api", "internal"],
    surfacesFrom: "enabled",
    visibility: "public",
    inputSchema: OBJECT_INPUT_SCHEMA,
    permission: requireAuthenticated,
    idempotency: "optional",
    audit: {
      actionName: "settings.chat.update"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.settingsService.updateChat(resolveRequest(context), resolveUser(context, input), normalizeObject(input));
    }
  }
]);

export { accountChatActions };
