import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

function extractTextDelta(deltaContent) {
  if (typeof deltaContent === "string") {
    return deltaContent;
  }

  if (!Array.isArray(deltaContent)) {
    return "";
  }

  return deltaContent
    .map((entry) => {
      if (typeof entry === "string") {
        return entry;
      }
      if (!entry || typeof entry !== "object") {
        return "";
      }
      return String(entry.text || "");
    })
    .join("");
}

function sanitizeAssistantMessageText(value, { preserveWhitespace = false } = {}) {
  let source = String(value || "");
  if (!source) {
    return "";
  }

  const blockPatterns = [
    /<[^>\n]*function_calls[^>\n]*>[\s\S]*?(?:<\/[^>\n]*function_calls>|$)/gi,
    /<[^>\n]*tool_calls?[^>\n]*>[\s\S]*?(?:<\/[^>\n]*tool_calls?[^>\n]*>|$)/gi,
    /<[^>\n]*invoke\b[^>\n]*>[\s\S]*?(?:<\/[^>\n]*invoke>|$)/gi,
    /<(?:analysis|reasoning|think)>[\s\S]*?(?:<\/(?:analysis|reasoning|think)>|$)/gi
  ];
  for (const pattern of blockPatterns) {
    source = source.replace(pattern, " ");
  }

  const inlineTagPatterns = [
    /<[^>\n]*invoke\b[^>]*\/>/gi,
    /<\/?[^>\n]*invoke[^>\n]*>/gi,
    /<\/?[^>\n]*function_calls[^>\n]*>/gi,
    /<\/?[^>\n]*tool_calls?[^>\n]*>/gi,
    /<\/?[^>\n]*DSML[^>\n]*>/gi
  ];
  for (const pattern of inlineTagPatterns) {
    source = source.replace(pattern, " ");
  }

  if (preserveWhitespace) return source;

  return source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function parseDsmlToolCallsFromText(value = "") {
  const source = String(value || "");
  if (!source) {
    return [];
  }

  const functionCallsMatch = source.match(
    /<[^>\n]*function_calls[^>\n]*>([\s\S]*?)<\/[^>\n]*function_calls>/i
  );
  if (!functionCallsMatch) {
    return [];
  }

  const blockText = String(functionCallsMatch[1] || "");
  if (!blockText) {
    return [];
  }

  const calls = [];
  const invokePattern = /<[^>\n]*invoke\b([^>]*)>([\s\S]*?)<\/[^>\n]*invoke>/gi;
  let match = invokePattern.exec(blockText);
  while (match) {
    const attributes = String(match[1] || "");
    const body = normalizeText(String(match[2] || ""));
    const quotedNameMatch =
      attributes.match(/\bname\s*=\s*"([^"]+)"/i) || attributes.match(/\bname\s*=\s*'([^']+)'/i);
    const bareNameMatch = attributes.match(/\bname\s*=\s*([^\s"'/>]+)/i);
    const name = normalizeText(quotedNameMatch?.[1] || bareNameMatch?.[1]);
    if (name) {
      calls.push({
        id: `dsml_tool_call_${calls.length + 1}`,
        name,
        arguments: body && /^[\[{]/.test(body) ? body : "{}"
      });
    }

    match = invokePattern.exec(blockText);
  }

  return calls;
}

async function consumeCompletionStream(stream, onText = () => {}, {
  signal, limits, preserveWhitespace = false, requireCallIds = false, callIdPrefix = ""
} = {}) {
  let assistantText = "";
  let finishReason;
  const toolCallsByIndex = new Map();

  function checkToolLimits(call, count) {
    if (!limits) return;
    if (limits.maxToolCalls === 0) throw new Error("This conversation has no configured application tools.");
    if (count > limits.maxToolCalls || call.name.length > 256 || call.id.length > 256 ||
        Buffer.byteLength(call.arguments) > limits.maxToolArgumentBytes) {
      throw new Error("The model exceeded the configured application tool-call limits.");
    }
  }

  for await (const chunk of stream) {
    signal?.throwIfAborted();
    const choice = chunk?.choices?.[0] || {};
    const delta = choice?.delta || {};
    finishReason = choice.finish_reason || finishReason;

    const textDelta = extractTextDelta(delta.content);
    if (textDelta) {
      assistantText += textDelta;
      if (limits && assistantText.length > limits.maxOutputCharacters) {
        throw new Error("The assistant exceeded the configured response limit.");
      }
      // An opening provider tag can be split between chunks. Keep it private
      // until its boundary is known; complete internal blocks are stripped below.
      const tagStart = assistantText.lastIndexOf("<");
      const safeText = tagStart > assistantText.lastIndexOf(">") ? assistantText.slice(0, tagStart) : assistantText;
      await onText(sanitizeAssistantMessageText(safeText, { preserveWhitespace }));
    }

    const toolCalls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
    for (const partialToolCall of toolCalls) {
      const index = Number(partialToolCall?.index || 0);
      const existing =
        toolCallsByIndex.get(index) ||
        {
          id: normalizeText(partialToolCall?.id) || (requireCallIds ? "" : `tool_call_${index + 1}`),
          name: "",
          arguments: ""
        };

      if (partialToolCall?.id) {
        existing.id = normalizeText(partialToolCall.id) || existing.id;
      }
      if (partialToolCall?.function?.name) {
        existing.name += String(partialToolCall.function.name || "");
      }
      if (partialToolCall?.function?.arguments) {
        existing.arguments += String(partialToolCall.function.arguments || "");
      }

      toolCallsByIndex.set(index, existing);
      checkToolLimits(existing, toolCallsByIndex.size);
    }
  }

  let toolCalls = [...toolCallsByIndex.values()].map((toolCall, index) => ({
    id: normalizeText(toolCall.id) || (requireCallIds ? "" : `tool_call_${index + 1}`),
    name: normalizeText(toolCall.name),
    arguments: String(toolCall.arguments || "")
  }));

  let toolCallSource = toolCalls.length ? "structured" : "";
  if (toolCalls.length < 1) {
    const parsedDsmlCalls = parseDsmlToolCallsFromText(assistantText);
    if (parsedDsmlCalls.length > 0) {
      toolCallSource = "text";
      toolCalls = parsedDsmlCalls.map(call => ({ ...call, id: `${callIdPrefix}${call.id}` }));
      for (const call of toolCalls) checkToolLimits(call, toolCalls.length);
      const visible = sanitizeAssistantMessageText(assistantText, { preserveWhitespace });
      assistantText = preserveWhitespace ? visible : normalizeText(visible);
    }
  }

  return {
    assistantText,
    toolCalls,
    toolCallSource,
    finishReason
  };
}

export { consumeCompletionStream, sanitizeAssistantMessageText };
