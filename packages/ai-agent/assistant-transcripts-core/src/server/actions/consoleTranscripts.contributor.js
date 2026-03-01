import { CONSOLE_AI_TRANSCRIPTS_PERMISSIONS } from "@jskit-ai/workspace-console-core/consoleRoles";

function normalizeObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value;
}

function resolveRequest(context) {
  return context?.requestMeta?.request || null;
}

function resolveUser(context, input) {
  const payload = normalizeObject(input);
  return payload.user || resolveRequest(context)?.user || context?.actor || null;
}

const OBJECT_INPUT_SCHEMA = Object.freeze({
  parse(value) {
    return normalizeObject(value);
  }
});

function createConsoleTranscriptsActionContributor({ aiTranscriptsService = null } = {}) {
  const contributorId = "assistant.console.transcripts";

  if (
    !aiTranscriptsService ||
    typeof aiTranscriptsService.listConsoleConversations !== "function" ||
    typeof aiTranscriptsService.getConsoleConversationMessages !== "function" ||
    typeof aiTranscriptsService.exportConsoleMessages !== "function"
  ) {
    return {
      contributorId,
      domain: "console",
      actions: Object.freeze([])
    };
  }

  const actions = [
    {
      id: "console.ai.transcripts.list",
      version: 1,
      kind: "query",
      channels: ["api", "internal"],
      surfaces: ["console"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: [CONSOLE_AI_TRANSCRIPTS_PERMISSIONS.READ_ALL],
      idempotency: "none",
      audit: {
        actionName: "console.ai.transcripts.list"
      },
      observability: {},
      async execute(input, context) {
        return aiTranscriptsService.listConsoleConversations(resolveUser(context, input), normalizeObject(input));
      }
    },
    {
      id: "console.ai.transcript.messages.get",
      version: 1,
      kind: "query",
      channels: ["api", "internal"],
      surfaces: ["console"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: [CONSOLE_AI_TRANSCRIPTS_PERMISSIONS.READ_ALL],
      idempotency: "none",
      audit: {
        actionName: "console.ai.transcript.messages.get"
      },
      observability: {},
      async execute(input, context) {
        const payload = normalizeObject(input);
        const conversationId = payload.conversationId || payload.params?.conversationId;
        return aiTranscriptsService.getConsoleConversationMessages(resolveUser(context, payload), conversationId, payload);
      }
    },
    {
      id: "console.ai.transcripts.export",
      version: 1,
      kind: "query",
      channels: ["api", "internal"],
      surfaces: ["console"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: [CONSOLE_AI_TRANSCRIPTS_PERMISSIONS.EXPORT_ALL],
      idempotency: "none",
      audit: {
        actionName: "console.ai.transcripts.export"
      },
      observability: {},
      async execute(input, context) {
        return aiTranscriptsService.exportConsoleMessages(resolveUser(context, input), normalizeObject(input));
      }
    }
  ];

  return {
    contributorId,
    domain: "console",
    actions: Object.freeze(actions)
  };
}

export { createConsoleTranscriptsActionContributor };
