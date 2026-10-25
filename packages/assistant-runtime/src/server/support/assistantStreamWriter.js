// The stream writer contract shared by the chat route and the chat service.
const ASSISTANT_STREAM_WRITER_METHODS = Object.freeze([
  "sendMeta",
  "sendAssistantDelta",
  "sendAssistantMessage",
  "sendToolCall",
  "sendToolResult",
  "sendError",
  "sendDone"
]);

export { ASSISTANT_STREAM_WRITER_METHODS };
