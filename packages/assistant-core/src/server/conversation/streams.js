/** Transient provider output. Applications own scope, admission and final persistence. */
export function createConversationStreams({ clock = () => new Date() } = {}) {
  const streams = new Map();
  let revision = 0;

  function read(scope) {
    const stream = streams.get(scope);
    return {
      revision,
      messages: stream ? [...stream.messages.values()].map((message) => ({ ...message })) : []
    };
  }

  function update(scope, { turnId, messageId, role = "assistant", text, delta, at } = {}) {
    if (!turnId || !messageId || !["assistant", "commentary"].includes(role)) return null;
    let stream = streams.get(scope);
    if (!stream || stream.turnId !== turnId) {
      stream = { turnId, messages: new Map(), completed: new Set() };
      streams.set(scope, stream);
    }
    if (stream.completed.has(messageId)) return null;
    const previous = stream.messages.get(messageId);
    const next = {
      messageId,
      role: previous?.role || role,
      at: previous?.at || at || clock().toISOString(),
      text: typeof delta === "string" ? (previous?.text || "") + delta : (text ?? previous?.text ?? ""),
      status: "inProgress"
    };
    if (previous?.text === next.text && previous.role === next.role) return null;
    stream.messages.set(messageId, next);
    revision += 1;
    return read(scope);
  }

  function complete(scope, messageId) {
    const stream = streams.get(scope);
    if (!stream) return read(scope);
    stream.completed.add(messageId);
    stream.messages.delete(messageId);
    revision += 1;
    return read(scope);
  }

  function clear(scope) {
    streams.delete(scope);
    revision += 1;
    return read(scope);
  }

  return { read, update, complete, clear };
}
