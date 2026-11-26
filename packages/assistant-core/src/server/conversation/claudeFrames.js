// What a frame of Claude's saved history is.

function claudeUserText(content) {
  return typeof content === "string" ? content : (Array.isArray(content) ? content : [])
    .filter((block) => block.type === "text" && typeof block.text === "string").map((block) => block.text).join("\n\n");
}

const INTERRUPT_PATTERN = /^\[Request interrupted by user/u;

// The marker Claude saves where a Stop interrupted its work.
function claudeInterruptMarker(frame) {
  return frame.type === "user" && INTERRUPT_PATTERN.test(claudeUserText(frame.message?.content));
}

// A message the person or the host sent, a native /goal command among them.
// Claude's own notes, compaction summary and interrupt marker are not.
function claudeAuthoredMessage(frame) {
  if (frame.type !== "user" || frame.isMeta || frame.isCompactSummary || frame.parent_tool_use_id) return false;
  const text = claudeUserText(frame.message?.content);
  return Boolean(text) && !INTERRUPT_PATTERN.test(text);
}

function claudeNoResponsePlaceholder(frame) {
  const content = frame.message?.content;
  return frame.type === "assistant" && frame.message?.model === "<synthetic>" && !frame.isApiErrorMessage &&
    Array.isArray(content) && content.length === 1 && content[0]?.type === "text" && content[0].text === "No response requested.";
}

export { claudeAuthoredMessage, claudeInterruptMarker, claudeNoResponsePlaceholder, claudeUserText };
