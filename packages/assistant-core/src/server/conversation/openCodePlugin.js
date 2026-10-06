import { createOpenCodeConversationAdapter } from "./providers/opencode.js";
import { wrapNativeCommand } from "./commandWrapper.js";
import { readOpenCodeEnvironments, openCodeEnvironmentForSession, openCodeEnvironmentForDirectory,
  assertOpenCodeModelProvider, limitOpenCodeModelOutput } from "./openCodeRuntime.js";

// Runs in OpenCode. The host writes this private binding before every dispatch;
// the native system hook also rereads it after automatic compaction.
export default async function conversationInstructions({ client, registryPath = process.env.JSKIT_OPENCODE_ENV_REGISTRY,
  resolveHostInstructions } = {}) {
  const schemas = JSON.parse(process.env.JSKIT_OPENCODE_TOOL_SCHEMAS || "[]");
  const definitions = new Map(schemas.map(({ function: definition }) => [definition.name, definition]));
  const environments = () => readOpenCodeEnvironments(registryPath);
  async function readBinding(id) {
    const binding = await openCodeEnvironmentForSession(await environments(), id, client);
    if (!binding) throw new Error("This native conversation has no instruction owner.");
    return binding;
  }
  const adapter = createOpenCodeConversationAdapter({
    async resolveInstructions(id) {
      const { conversation } = await readBinding(id);
      if (!conversation) return null;
      return { identity: conversation.systemPrompt, placement: "replace", read: () => conversation.systemPrompt };
    }
  });
  const hostInstructions = resolveHostInstructions ? createOpenCodeConversationAdapter({
    resolveInstructions: async id => (await resolveHostInstructions(id))?.instructions
  }) : null;
  return {
    "experimental.chat.system.transform": hostInstructions ? async (input, output) => {
      const selected = await resolveHostInstructions(input.sessionID || input.sessionId);
      return selected?.conversation
        ? adapter.transformSystem(input, output)
        : hostInstructions.transformSystem(input, output);
    } : adapter.transformSystem,
    event: hostInstructions ? event => { hostInstructions.event(event); adapter.event(event); } : adapter.event,
    "chat.params": async (input, output) => {
      const binding = await readBinding(input.sessionID);
      assertOpenCodeModelProvider(binding, input);
      limitOpenCodeModelOutput(input, output);
    },
    "tool.execute.before": async ({ tool, sessionID }, output) => {
      const { conversation } = await readBinding(sessionID);
      const allowed = definitions.has(tool)
        ? conversation?.tools?.schemas.some(({ function: definition }) => definition.name === tool)
        : conversation?.nativeTools;
      if (!allowed) {
        throw new Error("This conversation has no authorization for that native tool.");
      }
      if (tool === "bash" && conversation.commandWrapper) {
        output.args.command = wrapNativeCommand(conversation.commandWrapper, output.args.command);
      }
    },
    "shell.env": async ({ sessionID, cwd }, output) => {
      const binding = sessionID ? await readBinding(sessionID) : openCodeEnvironmentForDirectory(await environments(), cwd);
      if (binding?.conversation?.nativeTools) {
        Object.assign(output.env, binding.env);
      }
    },
    // OpenCode 1.18.31 accepts JSON Schema properties from plugins. Preserve the
    // original required/optional fields through its native definition hook.
    "tool.definition": ({ toolID }, output) => {
      const definition = definitions.get(toolID);
      if (definition) output.jsonSchema = definition.parameters;
    },
    tool: Object.fromEntries([...definitions].map(([name, definition]) => [name, {
      description: definition.description, args: definition.parameters.properties,
      async execute(input, context) {
        if (!context.callID || !context.sessionID || !context.messageID) {
          throw new Error("OpenCode did not supply an application tool identity.");
        }
        const connection = (await readBinding(context.sessionID)).conversation?.tools;
        if (!connection?.schemas.some(({ function: definition }) => definition.name === name)) {
          throw new Error("This conversation has no authorization for that native tool.");
        }
        const response = await fetch(connection.url, { method: "POST", signal: context.abort,
          headers: { authorization: `Bearer ${connection.token}`, "content-type": "application/json" },
          body: JSON.stringify({ sessionId: context.sessionID, messageId: context.messageID, id: context.callID, name, input }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "The application tool request failed.");
        return JSON.stringify(result);
      }
    }]))
  };
}
