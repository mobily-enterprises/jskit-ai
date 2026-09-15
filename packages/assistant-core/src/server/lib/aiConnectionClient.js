import { generateText, jsonSchema, streamText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createCerebras } from "@ai-sdk/cerebras";
import { createMistral } from "@ai-sdk/mistral";
import { createPerplexity } from "@ai-sdk/perplexity";
import { createTogetherAI } from "@ai-sdk/togetherai";
import { createXai } from "@ai-sdk/xai";

// These adapters are installed with the package. The catalogue selects a
// protocol; it cannot cause dynamic imports or dependency installation.
const providers = {
  "@ai-sdk/openai": createOpenAI,
  "@ai-sdk/openai-compatible": createOpenAICompatible,
  "@ai-sdk/anthropic": createAnthropic,
  "@ai-sdk/google": createGoogle,
  "@ai-sdk/groq": createGroq,
  "@openrouter/ai-sdk-provider": createOpenRouter,
  "@ai-sdk/cerebras": createCerebras,
  "@ai-sdk/mistral": createMistral,
  "@ai-sdk/perplexity": createPerplexity,
  "@ai-sdk/togetherai": createTogetherAI,
  "@ai-sdk/xai": createXai
};

function sdkMessages(messages) {
  const toolNames = new Map();
  return messages.map(message => {
    if (message.role === "assistant" && message.tool_calls?.length) {
      const content = message.content ? [{ type: "text", text: message.content }] : [];
      for (const call of message.tool_calls) {
        toolNames.set(call.id, call.function.name);
        content.push({ type: "tool-call", toolCallId: call.id, toolName: call.function.name, input: JSON.parse(call.function.arguments) });
      }
      return { role: "assistant", content };
    }
    if (message.role === "tool") {
      return { role: "tool", content: [{ type: "tool-result", toolCallId: message.tool_call_id,
        toolName: toolNames.get(message.tool_call_id), output: { type: "text", value: message.content } }] };
    }
    return { role: message.role, content: message.content };
  });
}

/** Accept only the server-side result of an authorized AI connection resolver. */
export function createAiConnectionClient(connection, { fetch, timeoutMs = 120_000, maxOutputTokens } = {}) {
  if (!connection?.apiKey || !connection.model || !Object.hasOwn(providers, connection.sdkPackage)) {
    throw new TypeError("An authorized AI connection with a supported SDK and model is required.");
  }
  const provider = providers[connection.sdkPackage]({
    name: connection.providerId, apiKey: connection.apiKey, baseURL: connection.baseURL, fetch
  });
  const model = provider(connection.model);
  function options({ messages = [], tools = [], signal, temperature } = {}) {
    return {
      model, messages: sdkMessages(messages), allowSystemInMessages: true,
      tools: Object.fromEntries(tools.map(({ function: tool }) => [tool.name, {
        description: tool.description, inputSchema: jsonSchema(tool.parameters)
      }])),
      abortSignal: signal, timeout: timeoutMs, maxRetries: 0, temperature, maxOutputTokens
    };
  }
  return Object.freeze({
    enabled: true, supportsAttachments: true, provider: connection.providerId, defaultModel: connection.model,
    async createChatCompletion(input) {
      const result = await generateText(options(input));
      return { choices: [{ message: { role: "assistant", content: result.text,
        tool_calls: result.toolCalls.map(call => ({ id: call.toolCallId, type: "function",
          function: { name: call.toolName, arguments: JSON.stringify(call.input) } })) } }] };
    },
    async *createChatCompletionStream(input) {
      const result = streamText({ ...options(input), onError() {} });
      let toolIndex = 0;
      for await (const part of result.fullStream) {
        if (part.type === "error") throw part.error;
        if (part.type === "abort") throw input?.signal?.reason || new Error("Assistant request was aborted.");
        if (part.type === "text-delta") yield { choices: [{ delta: { content: part.text } }] };
        if (part.type === "tool-call") {
          if (part.invalid) throw part.error;
          yield { choices: [{ delta: { tool_calls: [{ index: toolIndex++, id: part.toolCallId,
            function: { name: part.toolName, arguments: JSON.stringify(part.input) } }] } }] };
        }
      }
    }
  });
}
