/** A companion's text enters the same draft and send action as keyboard input. */
export function createAssistantTextSubmission({ getState, setDraft, submit, afterDraftChange = async () => {} }) {
  let revision = 0;
  return async function submitText(text, { sendImmediately = true, signal, timeoutMs = 2000 } = {}) {
    const request = ++revision;
    const value = String(text || "").trim();
    const initial = getState();
    if (!value || !initial.active || signal?.aborted) throw new Error("The chat composer is not ready yet.");
    const hasDraft = Boolean(initial.draft?.trim());
    const writtenValue = hasDraft ? `${initial.draft}\n${value}` : value;
    setDraft(writtenValue);
    if (!sendImmediately || hasDraft) return "draft";
    await afterDraftChange();
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const state = getState();
      if (signal?.aborted || request !== revision || !state.active || state.id !== initial.id || state.draft !== writtenValue) {
        throw new Error("The chat changed before sending. Review the draft before sending.");
      }
      if (state.canSend) {
        const result = await submit();
        if (result === false) throw new Error("Your words are in the chat box, but this conversation cannot send yet.");
        return state.turnActive ? "steer" : "send";
      }
      if (Date.now() >= deadline) throw new Error("Your words are in the chat box, but this conversation cannot send yet.");
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
  };
}
