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

  function update(scope, { turnId, messageId, role = "assistant", text, delta, at, origin, nativeIdentity, outputId, authorship } = {}) {
    if (!turnId || !messageId || !["assistant", "commentary"].includes(role)) return null;
    let stream = streams.get(scope);
    if (!stream || stream.turnId !== turnId) {
      stream = { turnId, messages: new Map(), completed: new Set(), authorship: new Map() };
      streams.set(scope, stream);
    }
    if (stream.completed.has(messageId)) return null;
    const previous = stream.messages.get(messageId);
    const captured = stream.authorship.get(messageId);
    if (authorship?.messageId && (!previous || captured?.messageId === authorship.messageId)) {
      stream.authorship.set(messageId, captured?.turnId ? captured : { ...authorship });
    }
    const next = {
      messageId,
      ...((previous?.outputId || outputId) ? { outputId: previous?.outputId || outputId } : {}),
      // Native grouping is private even when its authored origin is known.
      // Ordinary runtime output already carries the exact authored row identity.
      ...(["user", "application"].includes(origin || previous?.origin)
        ? { ...(!nativeIdentity ? { turnId } : {}), origin: origin || previous.origin } : {}),
      role: previous?.role || role,
      at: previous?.at || at || clock().toISOString(),
      text: typeof delta === "string" ? (previous?.text || "") + delta : (text ?? previous?.text ?? ""),
      status: "inProgress"
    };
    if (previous?.text === next.text && previous.role === next.role && previous.outputId === next.outputId) return null;
    stream.messages.set(messageId, next);
    revision += 1;
    return read(scope);
  }

  function complete(scope, messageId, { text, role, authorship } = {}) {
    const stream = streams.get(scope);
    if (!stream) return read(scope);
    const message = stream.messages.get(messageId);
    const captured = stream.authorship.get(messageId);
    const completedAuthorship = captured?.messageId === authorship?.messageId && captured?.origin === authorship?.origin && !captured?.turnId
      ? { ...captured, ...(authorship?.turnId ? { turnId: authorship.turnId } : {}) } : captured;
    stream.completed.add(messageId);
    stream.messages.delete(messageId);
    stream.authorship.delete(messageId);
    revision += 1;
    const snapshot = read(scope);
    // Only the exact native completed-text path supplies a completion carrier.
    // Cleanup, duplicate notifications and ordinary reads cannot replay it.
    if (message && typeof text === "string" && completedAuthorship?.turnId && ["user", "application"].includes(completedAuthorship.origin)) {
      snapshot.completedMessages = [{ ...message, turnId: completedAuthorship.turnId, origin: completedAuthorship.origin,
        ...(["assistant", "commentary", "thinking"].includes(role) ? { role } : {}), text, status: "complete" }];
    }
    return snapshot;
  }

  function clear(scope) {
    streams.delete(scope);
    revision += 1;
    return read(scope);
  }

  return { read, update, complete, clear };
}
