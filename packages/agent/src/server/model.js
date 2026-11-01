import { createAnthropic } from "@ai-sdk/anthropic";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { generateText } from "ai";

/**
 * A provider's chat model. With an Anthropic-style address (DeepSeek's own API) it's called in
 * that format, as Claude Code calls it, so signed reasoning goes back on every step; otherwise in
 * the OpenAI style (Together AI, DeepSeek), where reasoning goes back as reasoning_content.
 */
export function chatModel({ apiKey, model, baseURL, anthropicURL = "", fetch: fetchImpl }) {
  const client = anthropicURL
    ? createAnthropic({ apiKey, baseURL: anthropicURL, fetch: fetchImpl })
    : createDeepSeek({ apiKey, baseURL, fetch: fetchImpl });
  return client(model);
}

// Reasoning, written for both formats (each reads only its own options). On: adaptive thinking at
// high effort, so the model spends a lot on a hard step and almost nothing on "hi"; the OpenAI-style
// client thinks when no setting is sent. Off: for quick one-shot calls.
export const REASONING = {
  on: { anthropic: { thinking: { type: "adaptive", display: "summarized" }, effort: "high" } },
  off: { deepseek: { thinking: { type: "disabled" } }, anthropic: { thinking: { type: "disabled" } } }
};

// A loop step may write a long answer: the Anthropic format needs a cap, and its default is small.
export const LOOP_OUTPUT_TOKENS = 32000;

// Failed model calls are tried again with growing waits (2, 4, 8… seconds), about two minutes in
// all, before a reply gives up and says so.
export const MODEL_RETRIES = 6;

/** One call without tools, such as a summary or a short label; returns its text. */
export async function generateOnce({ model, system, messages, reasoning = REASONING.off, maxOutputTokens }) {
  const result = await generateText({
    model,
    ...(system ? { system } : {}),
    messages,
    providerOptions: reasoning,
    maxRetries: MODEL_RETRIES,
    ...(maxOutputTokens ? { maxOutputTokens } : {})
  });
  return result.text;
}
