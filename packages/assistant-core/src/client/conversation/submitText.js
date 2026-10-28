// Client-made errors keep their English message; messageCode lets a caller show
// them in the active language through useJskitText().serverMessage(error).
const CANNOT_SEND_YET = "Your words are in the chat box, but this conversation cannot send yet.";
const submissionError = (message, { messageCode }) => Object.assign(new Error(message), { messageCode, messageParams: {} });

/** A companion's text enters the same draft and send action as keyboard input. */
export function createAssistantTextSubmission({ getState, setDraft, submit, afterDraftChange = async () => {} }) {
  let revision = 0;
  return async function submitText(text, { sendImmediately = true, signal, timeoutMs = 2000 } = {}) {
    const request = ++revision;
    const value = String(text || "").trim();
    const initial = getState();
    if (!value || !initial.active || signal?.aborted) {
      throw submissionError("The chat composer is not ready yet.", { messageCode: "assistant.composer.notReady" });
    }
    const hasDraft = Boolean(initial.draft?.trim());
    const writtenValue = hasDraft ? `${initial.draft}\n${value}` : value;
    setDraft(writtenValue);
    if (!sendImmediately || hasDraft) return "draft";
    await afterDraftChange();
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const state = getState();
      if (signal?.aborted || request !== revision || !state.active || state.id !== initial.id || state.draft !== writtenValue) {
        throw submissionError("The chat changed before sending. Review the draft before sending.", { messageCode: "assistant.composer.chatChanged" });
      }
      if (state.canSend) {
        const result = await submit();
        if (result === false) throw submissionError(CANNOT_SEND_YET, { messageCode: "assistant.composer.cannotSendYet" });
        return state.turnActive ? "steer" : "send";
      }
      if (Date.now() >= deadline) throw submissionError(CANNOT_SEND_YET, { messageCode: "assistant.composer.cannotSendYet" });
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
  };
}
