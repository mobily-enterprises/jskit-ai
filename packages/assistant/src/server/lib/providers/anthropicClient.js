import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import {
  createDisabledClient,
  createProviderRequestError,
  normalizeArray,
  normalizeContentText,
  normalizeModel,
  normalizeObject,
  normalizeOptionalHttpUrl,
  normalizeTimeoutMs,
  parseJsonObjectOrDefault
} from "./common.js";

const DEFAULT_ANTHROPIC_MODEL = "claude-3-5-sonnet-latest";
const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com";
const DEFAULT_ANTHROPIC_MAX_TOKENS = 4096;
const DEFAULT_ANTHROPIC_VERSION = "2023-06-01";

function normalizeTemperature(value, fallback = 0.2) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  if (parsed < 0) {
    return 0;
  }

  if (parsed > 1) {
    return 1;
  }

  return parsed;
}

function normalizeToolDescriptor(tool) {
  const toolObject = normalizeObject(tool);
  const functionSpec = normalizeObject(toolObject.function);
  const name = normalizeText(functionSpec.name);

  if (!name) {
    return null;
  }

  const inputSchema = normalizeObject(functionSpec.parameters);
  return {
    name,
    description: normalizeText(functionSpec.description),
    input_schema: Object.keys(inputSchema).length > 0
      ? inputSchema
      : {
          type: "object",
          properties: {},
          additionalProperties: true
        }
  };
}

function toAnthropicTools(tools = []) {
  return normalizeArray(tools)
    .map((tool) => normalizeToolDescriptor(tool))
    .filter(Boolean);
}

function toAnthropicSystemAndMessages(messages = []) {
  const systemLines = [];
  const anthropicMessages = [];

  for (const entry of normalizeArray(messages)) {
    const message = normalizeObject(entry);
    const role = normalizeText(message.role).toLowerCase();

    if (role === "system") {
      const systemText = normalizeContentText(message.content);
      if (systemText) {
        systemLines.push(systemText);
      }
      continue;
    }

    if (role === "user") {
      const text = normalizeContentText(message.content);
      if (!text) {
        continue;
      }

      anthropicMessages.push({
        role: "user",
        content: text
      });
      continue;
    }

    if (role === "assistant") {
      const blocks = [];
      const text = normalizeContentText(message.content);
      if (text) {
        blocks.push({
          type: "text",
          text
        });
      }

      const toolCalls = normalizeArray(message.tool_calls);
      for (const [index, toolCall] of toolCalls.entries()) {
        const toolCallObject = normalizeObject(toolCall);
        const functionSpec = normalizeObject(toolCallObject.function);
        const name = normalizeText(functionSpec.name);
        if (!name) {
          continue;
        }

        blocks.push({
          type: "tool_use",
          id: normalizeText(toolCallObject.id) || `tool_call_${index + 1}`,
          name,
          input: parseJsonObjectOrDefault(functionSpec.arguments, {})
        });
      }

      if (blocks.length < 1) {
        continue;
      }

      anthropicMessages.push({
        role: "assistant",
        content: blocks.length === 1 && blocks[0].type === "text" ? blocks[0].text : blocks
      });
      continue;
    }

    if (role === "tool") {
      const toolUseId = normalizeText(message.tool_call_id);
      if (!toolUseId) {
        continue;
      }

      const text = normalizeContentText(message.content) || "{}";
      anthropicMessages.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: toolUseId,
            content: text
          }
        ]
      });
    }
  }

  return {
    system: systemLines.join("\n\n"),
    messages: anthropicMessages
  };
}

function mapAnthropicContentToOpenAiDelta(content = []) {
  const blocks = normalizeArray(content);
  const textParts = [];
  const toolCalls = [];

  for (const block of blocks) {
    const blockObject = normalizeObject(block);
    const type = normalizeText(blockObject.type).toLowerCase();

    if (type === "text") {
      const text = String(blockObject.text || "");
      if (text) {
        textParts.push(text);
      }
      continue;
    }

    if (type === "tool_use") {
      const name = normalizeText(blockObject.name);
      if (!name) {
        continue;
      }

      toolCalls.push({
        id: normalizeText(blockObject.id) || `tool_call_${toolCalls.length + 1}`,
        index: toolCalls.length,
        type: "function",
        function: {
          name,
          arguments: JSON.stringify(normalizeObject(blockObject.input))
        }
      });
    }
  }

  const delta = {};
  if (textParts.length > 0) {
    delta.content = textParts.join("");
  }
  if (toolCalls.length > 0) {
    delta.tool_calls = toolCalls;
  }

  return delta;
}

function createSingleChunkStream(chunk) {
  return (async function* singleChunkGenerator() {
    yield chunk;
  })();
}

async function fetchAnthropicMessage({
  apiKey,
  baseUrl,
  model,
  timeoutMs,
  system = "",
  messages,
  tools,
  temperature = 0.2,
  signal
} = {}) {
  const hasFetch = typeof fetch === "function";
  if (!hasFetch) {
    throw createProviderRequestError({
      status: 500,
      code: "assistant_provider_fetch_missing",
      message: "Global fetch is not available for anthropic provider."
    });
  }

  const timeout = normalizeTimeoutMs(timeoutMs);
  const upstreamSignal = signal;
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => {
    controller.abort();
  }, timeout);

  const handleAbort = () => {
    controller.abort();
  };

  if (upstreamSignal) {
    if (upstreamSignal.aborted) {
      controller.abort();
    } else {
      upstreamSignal.addEventListener("abort", handleAbort, {
        once: true
      });
    }
  }

  const requestPayload = {
    model,
    max_tokens: DEFAULT_ANTHROPIC_MAX_TOKENS,
    messages,
    temperature: normalizeTemperature(temperature)
  };
  if (normalizeText(system)) {
    requestPayload.system = system;
  }
  if (tools.length > 0) {
    requestPayload.tools = tools;
  }

  try {
    const response = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": DEFAULT_ANTHROPIC_VERSION
      },
      body: JSON.stringify(requestPayload),
      signal: controller.signal
    });

    let payload = {};
    try {
      payload = await response.json();
    } catch {
      throw createProviderRequestError({
        status: response.status,
        code: "assistant_provider_invalid_response",
        message: "Assistant provider returned an invalid response payload."
      });
    }

    if (response.ok !== true) {
      const providerError = normalizeObject(payload.error);
      throw createProviderRequestError({
        status: response.status,
        code: normalizeText(providerError.type) || "assistant_provider_failed",
        message: normalizeText(providerError.message) || normalizeText(payload.message)
      });
    }

    return payload;
  } finally {
    clearTimeout(timeoutHandle);
    if (upstreamSignal) {
      upstreamSignal.removeEventListener("abort", handleAbort);
    }
  }
}

function createAnthropicClient({
  enabled = true,
  apiKey = "",
  baseUrl = "",
  model = "",
  timeoutMs = 120_000
} = {}) {
  const normalizedApiKey = normalizeText(apiKey);
  const normalizedBaseUrl = normalizeOptionalHttpUrl(normalizeText(baseUrl) || DEFAULT_ANTHROPIC_BASE_URL, {
    context: "assistant anthropic baseUrl"
  });
  const normalizedModel = normalizeModel(model, DEFAULT_ANTHROPIC_MODEL);

  if (enabled !== true || !normalizedApiKey) {
    return createDisabledClient({
      provider: "anthropic",
      model: normalizedModel
    });
  }

  async function createCompletion({ messages = [], tools = [], temperature = 0, signal } = {}) {
    const normalizedMessages = toAnthropicSystemAndMessages(messages);
    const anthropicTools = toAnthropicTools(tools);

    const payload = await fetchAnthropicMessage({
      apiKey: normalizedApiKey,
      baseUrl: normalizedBaseUrl,
      model: normalizedModel,
      timeoutMs,
      system: normalizedMessages.system,
      messages: normalizedMessages.messages,
      tools: anthropicTools,
      temperature,
      signal
    });

    return {
      ...payload,
      __openAiLikeDelta: mapAnthropicContentToOpenAiDelta(payload.content)
    };
  }

  return Object.freeze({
    enabled: true,
    provider: "anthropic",
    defaultModel: normalizedModel,
    createChatCompletion: createCompletion,
    async createChatCompletionStream({ messages = [], tools = [], temperature = 0.2, signal } = {}) {
      const completion = await createCompletion({
        messages,
        tools,
        temperature,
        signal
      });

      return createSingleChunkStream({
        choices: [
          {
            delta: completion.__openAiLikeDelta || {}
          }
        ]
      });
    }
  });
}

export {
  createAnthropicClient,
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_ANTHROPIC_BASE_URL
};
