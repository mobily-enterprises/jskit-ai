/** OpenCode's native system lane is rebuilt for each inference, without a chat message. */
export function createOpenCodeConversationAdapter({ resolveInstructions } = {}) {
  if (typeof resolveInstructions !== "function") throw new TypeError("OpenCode requires an instruction resolver.");
  const contexts = new Map();
  const contributions = new WeakMap();

  async function transformSystem(input = {}, output = {}) {
    const id = String(input.sessionID || input.sessionId || "").trim();
    if (!id) return;
    const source = await resolveInstructions(id);
    if (!source) return;
    if ((source.identity !== undefined && (typeof source.identity !== "string" || !source.identity)) || typeof source.read !== "function" ||
        ![undefined, "append", "replace"].includes(source.placement)) {
      throw new TypeError("Conversation instructions require read() and an optional non-empty identity.");
    }
    let current = contexts.get(id);
    if (source.identity === undefined || current?.identity !== source.identity) {
      current = {
        identity: source.identity,
        text: Promise.resolve().then(source.read).then((text) => {
          if (typeof text !== "string" || !text.trim()) throw new TypeError("Conversation instructions must contain text.");
          return text;
        })
      };
      contexts.set(id, current);
      current.text.catch(() => {
        if (contexts.get(id) === current) contexts.delete(id);
      });
    }
    const text = await current.text;
    if (contexts.get(id) !== current) throw new Error("Conversation context changed while reading instructions. Retry before sending.");
    const previous = contributions.get(output.system);
    if (previous !== undefined) {
      const index = output.system.indexOf(previous);
      if (index >= 0) output.system.splice(index, 1);
    }
    if (source.placement === "replace") output.system.splice(0, output.system.length, text);
    else if (!output.system.includes(text)) output.system.push(text);
    contributions.set(output.system, text);
  }

  function event({ event: value } = {}) {
    if (!["session.compacted", "session.deleted"].includes(value?.type)) return;
    const id = String(value.properties?.sessionID || value.properties?.info?.id || "").trim();
    if (id) contexts.delete(id);
  }

  return Object.freeze({ transformSystem, event, invalidate: (id) => contexts.delete(id), close: () => contexts.clear() });
}
