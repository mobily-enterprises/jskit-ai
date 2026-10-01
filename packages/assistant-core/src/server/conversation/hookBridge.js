/** A generic native-hook hand-off; neither the source format nor the host is known here. */
export function createConversationHookBridge({ resolveConversation, readInstructions } = {}) {
  if (typeof resolveConversation !== "function") {
    throw new TypeError("Conversation hook delivery requires a binding resolver.");
  }
  return async function deliver(request) {
    if (request.scope !== "session") return { kind: "unclaimed" };
    const binding = await resolveConversation(request);
    if (!binding) return { kind: "unclaimed" };
    // Native system fields or another host-owned native hook can already be
    // the delivery path. Suppress only this positively identified conversation.
    if (binding.delivery === "native") return { kind: "delivery", text: "" };
    if (binding.delivery !== "hook") throw new TypeError("Unknown conversation instruction delivery mode.");
    if (typeof readInstructions !== "function") throw new TypeError("Hook delivery requires an instruction resolver.");
    const text = await readInstructions(binding, request);
    if (typeof text !== "string" || !text.trim()) throw new TypeError("Managed conversation instructions are unavailable.");
    return { kind: "delivery", text };
  };
}
