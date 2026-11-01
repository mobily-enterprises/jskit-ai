import { createAiConnectionClient } from "@jskit-ai/assistant-core/server";

const encoder = new TextEncoder();

/** An AI SDK model on an OpenAI-compatible endpoint that answers from a script. A streamed
 * request (a reply step) gets `stream(body)`: OpenAI stream chunks (an async iterable), passed on
 * as they come. The engine's other calls (checks, accounts, summaries) get `once(body)` as one
 * message; by default an empty one, which a check reads as nothing to report.
 */
export function createScriptedModel(stream, { once = () => "", model = "test-model" } = {}) {
  const fetch = async (_url, request) => {
    const body = JSON.parse(request.body);
    if (!body.stream) {
      return Response.json({ id: "scripted", object: "chat.completion", created: 0, model,
        choices: [{ index: 0, message: { role: "assistant", content: await once(body) }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
    }
    const chunks = (await stream(body))[Symbol.asyncIterator]();
    const frame = chunk => ({ id: "scripted", object: "chat.completion.chunk", created: 0, model, ...chunk });
    return new Response(new ReadableStream({
      async pull(controller) {
        const { value, done } = await chunks.next();
        if (done) {
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } else controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame(value))}\n\n`));
      }
    }), { headers: { "content-type": "text/event-stream" } });
  };
  return createAiConnectionClient({ providerId: "test", model, sdkPackage: "@ai-sdk/openai-compatible",
    apiKey: "test", baseURL: "http://test.invalid/v1" }, { fetch }).model;
}
