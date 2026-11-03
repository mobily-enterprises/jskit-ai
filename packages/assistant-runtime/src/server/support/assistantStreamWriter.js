// The stream writer contract: the chat route builds one writer with these methods, and the chat service sends each event
// through it.
const ASSISTANT_STREAM_WRITER_METHODS = Object.freeze([
  "sendMeta",
  "sendAssistantDelta",
  "sendAssistantMessage",
  "sendToolCall",
  "sendToolResult",
  "sendError",
  "sendDone"
]);

/**
 * The writer a chat stream sends its events through, one method per event kind.
 * @typedef {Record<(typeof ASSISTANT_STREAM_WRITER_METHODS)[number], (event: object) => void>} AssistantStreamWriter
 */

export { ASSISTANT_STREAM_WRITER_METHODS };
