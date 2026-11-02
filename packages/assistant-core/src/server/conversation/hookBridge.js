/**
 * A generic native-hook hand-off; neither the source format nor the host is known here.
 * @param {object} [options]
 * @param {(request: { scope: string }) => Promise<{ delivery: "native" | "hook" } | null>} options.resolveConversation
 *   The conversation a native hook request belongs to, or null when it is not one of the host's.
 * @param {(binding: object, request: object) => Promise<string>} [options.readInstructions] Required for hook delivery.
 */
// readable-check: allow dependency-default - input validation: a call without options reaches the resolver check and its TypeError
export function createConversationHookBridge({ resolveConversation, readInstructions } = {}) {
  // readable-check: allow method-probe - input validation: the host passes the resolver of its conversation bindings
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
    // readable-check: allow method-probe - input validation: hook delivery needs the instruction resolver the host passed
    if (typeof readInstructions !== "function") throw new TypeError("Hook delivery requires an instruction resolver.");
    const text = await readInstructions(binding, request);
    if (typeof text !== "string" || !text.trim()) throw new TypeError("Managed conversation instructions are unavailable.");
    return { kind: "delivery", text };
  };
}
