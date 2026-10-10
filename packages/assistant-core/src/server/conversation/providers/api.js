import { conversationRequestText } from "../continuity.js";
import { validateConversationConfiguration, validateConnectionModel } from "../configuration.js";
import { consumeCompletionStream, sanitizeAssistantMessageText } from "../../lib/assistantCompletion.js";
import { runAssistantToolLoop } from "../../lib/assistantToolLoop.js";
import { isAssistantProgressOnlyText } from "../../../shared/assistantResponseText.js";

// Preserve the original assistant service's model-facing action result. The
// durable receipt keeps its full ok/result/error envelope in common storage.
const toolResultContent = result => JSON.stringify(result.ok ? result.result ?? null : { error: result.error });

/** Direct API inference uses the same authorized connection catalogue as other JSKIT services. */
export function createApiConversationDriver({ connections, apiClientFactory, fetch, limits = {} }) {
  if (apiClientFactory !== undefined && typeof apiClientFactory?.resolveClient !== "function") {
    throw new TypeError("An API client factory requires resolveClient({ context, configuration }).");
  }
  if (!apiClientFactory && typeof connections?.resolve !== "function") throw new TypeError("API conversations require an authorized AI connection resolver.");
  const maximumOutput = limits.maxOutputCharacters ?? 64_000;
  const maximumHistory = limits.maxHistoryCharacters ?? 256_000;
  const maximumToolProgress = limits.maxApiToolProgressCharacters;
  const preserveWhitespace = apiClientFactory?.preserveWhitespace !== false;
  for (const limit of [maximumOutput, maximumHistory]) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError("Invalid API conversation limit.");
  }
  if (maximumToolProgress !== undefined && (!Number.isSafeInteger(maximumToolProgress) || maximumToolProgress < 1)) {
    throw new TypeError("Invalid API application tool progress limit.");
  }
  const driver = Object.freeze({
    admissionBeforeDispatch: true,
    attachmentTypes: ["text", "image", "file"],
    capabilities: Object.freeze({ streaming: true, cancellation: true, instructions: true,
      configuration: true, history: true, steering: false, goals: false, attachments: true, tools: true, nativeTools: false, structuredOutput: false }),
    open() { return { run: driver.run, dispose: async () => {} }; },
    validateConfiguration(configuration) {
      validateConversationConfiguration(configuration, { engine: "API", connections, apiClientFactory, connectionRequired: true,
        efforts: ["none", "minimal", "low", "medium", "high", "xhigh"] });
    },
    async run({ configuration, context, input, history, requestHistory, continuity, tools, signal, accept, beforeDispatch, onMessage }) {
      const { createAiConnectionClient } = await import("../../lib/aiConnectionClient.js");
      const content = message => message.content?.length
        ? [...(message.text ? [{ type: "text", text: message.text }] : []), ...message.content] : message.text;
      const messages = [
        { role: "system", content: configuration.systemPrompt },
        ...(continuity ? [{ role: "user", content: continuity }] : []),
        ...(requestHistory ?? history.flatMap(turn => [
          ...(turn.user ? [{ role: "user", content: content({ ...turn.user, text: conversationRequestText(turn.user) }) }] : []),
          ...(turn.system ? [{ role: "user", content: content({ ...turn.system, text: conversationRequestText({ ...turn.system, origin: "application" }) }) }] : []),
          ...(turn.metadata?.applicationTools || []).filter(call => call.result).flatMap(call => [
            { role: "assistant", content: "", tool_calls: [{ id: call.id, type: "function", function: { name: call.name, arguments: call.arguments } }] },
            { role: "tool", tool_call_id: call.id, content: toolResultContent(call.result) }
          ]),
          ...(turn.assistant ? [{ role: "assistant", content: turn.assistant.text }] : [])
        ])),
        { role: "user", content: content(input) }
      ];
      let accepted = false;
      let round = 0;
      let responseId;
      let responseIsCommentary = false;
      async function prepareClient(inferenceMessages = messages) {
        if (inferenceMessages.reduce((size, message) => size + (typeof message.content === "string" ? message.content.length
          : message.content.reduce((count, part) => count + (part.type === "text" ? part.text.length : 0), 0)) +
          (message.tool_calls ? JSON.stringify(message.tool_calls).length : 0), 0) > maximumHistory) {
          throw new Error("This conversation exceeds the configured API history limit. Start another conversation or increase the limit.");
        }
        let client;
        if (apiClientFactory) {
          client = await apiClientFactory.resolveClient({ context, configuration });
          if (!client?.enabled || typeof client.createChatCompletionStream !== "function") {
            throw new Error("Assistant provider is not configured.");
          }
          validateConnectionModel(configuration, { model: client.defaultModel });
        } else {
          const connection = await connections.resolve({ context, integrationId: configuration.integrationId });
          validateConnectionModel(configuration, connection);
          client = createAiConnectionClient(connection, { fetch, effort: configuration.effort,
            reportUnavailableToolCalls: Boolean(tools),
            maxOutputTokens: limits.maxOutputTokens, timeoutMs: limits.timeoutMs });
        }
        signal.throwIfAborted();
        await beforeDispatch();
        if (!accepted) { await accept(); accepted = true; }
        return client;
      }
      return runAssistantToolLoop({
        messages, input: input.text, toolSet: { tools: tools?.descriptors || [] }, preserveWhitespace,
        toToolSchema: tool => tools.schemas.find(schema => schema.function.name === tool.name),
        async complete(messages, schemas) {
          const id = responseId = `reply-${++round}`;
          responseIsCommentary = false;
          const client = await prepareClient(messages);
          const completion = await consumeCompletionStream(
            await client.createChatCompletionStream({ signal, messages, tools: schemas }),
            async text => { if (text.trim()) await onMessage({ id, outputId: id, role: "assistant", text, complete: false }); },
            { signal, preserveWhitespace, requireCallIds: true, callIdPrefix: `${id}:`,
              limits: { maxOutputCharacters: maximumOutput, maxToolCalls: tools ? limits.maxToolCalls ?? 32 : 0,
                maxToolArgumentBytes: tools?.maximumArgumentBytes ?? 0 } }
          );
          const { toolCalls: calls, toolCallSource } = completion;
          // Environment clients expose the provider's original OpenAI spelling;
          // SDK connection clients use the normalized equivalent.
          const finishReason = completion.finishReason === "tool_calls" ? "tool-calls" : completion.finishReason;
          const text = sanitizeAssistantMessageText(completion.assistantText, { preserveWhitespace });
          if (finishReason === "length") throw new Error("The model reached its output token limit before completing the answer. Increase maxOutputTokens in the conversation limits.");
          if (calls.length) {
            if (finishReason !== (toolCallSource === "text" ? "stop" : "tool-calls")) throw new Error("The model stream ended without confirming its application tool calls.");
          } else if (finishReason !== "stop") {
            throw new Error("The model stream ended without confirming a completed answer.");
          }
          if (calls.length && maximumToolProgress !== undefined && text.length > maximumToolProgress) {
            throw new Error("Application tool progress text exceeds the configured API limit.");
          }
          if (text.trim() && (calls.length || isAssistantProgressOnlyText(text))) {
            responseIsCommentary = true;
            await onMessage({ id, outputId: id, role: "commentary", text, complete: true });
          }
          return completion;
        },
        async executeToolCalls(calls, { toolFailures, toolSuccesses }) {
          // The original preflight runs before inference, but never before the
          // same authorized connection and durable admission as ordinary sends.
          if (!accepted) await prepareClient();
          const failures = [];
          for (const call of calls) {
            const result = await tools.execute(call);
            messages.push({ role: "tool", tool_call_id: call.id, content: toolResultContent(result) });
            if (result.ok) toolSuccesses.push({ name: call.name, result: result.result });
            else {
              const failure = { name: call.name, error: result.error };
              failures.push(failure);
              toolFailures.push(failure);
            }
          }
          return failures;
        },
        async finish(text, { metadata = {} } = {}) {
          const id = responseIsCommentary ? `reply-${++round}` : responseId;
          await onMessage({ id, outputId: id, role: "assistant", text, complete: true });
          return { metadata };
        }
      });
    }
  });
  return driver;
}
