/**
 * One instruction binding per native conversation. The adapter owns delivery
 * (native hooks, process configuration or a request's system field), not the
 * application or its message history.
 */
export function createConversationSystemPrompt() {
  let installed;
  let generation = 0;
  let pending = Promise.resolve();

  function invalidate() {
    generation += 1;
    installed = undefined;
  }

  function isCurrent({ systemPrompt, contextIdentity } = {}) {
    return Boolean(installed && installed.systemPrompt === systemPrompt && installed.contextIdentity === contextIdentity);
  }

  function ensure({ systemPrompt, contextIdentity, install, retained = true } = {}) {
    if (typeof systemPrompt !== "string" || !systemPrompt.trim()) {
      return Promise.reject(new TypeError("Conversation systemPrompt must be a non-empty string."));
    }
    if (typeof contextIdentity !== "string" || !contextIdentity) {
      return Promise.reject(new TypeError("Conversation contextIdentity is required."));
    }
    if (typeof install !== "function") {
      return Promise.reject(new TypeError("Conversation system prompt requires an installation adapter."));
    }
    const operation = pending.catch(() => {}).then(async () => {
      const promptChanged = !installed || installed.systemPrompt !== systemPrompt;
      const contextChanged = !installed || installed.contextIdentity !== contextIdentity;
      if (retained && isCurrent({ systemPrompt, contextIdentity })) return installed.value;
      const startedGeneration = generation;
      let value;
      try {
        value = await install({ systemPrompt, promptChanged, contextChanged });
      } catch (error) {
        invalidate();
        throw error;
      }
      // Do not let a caller start inference against an obsolete installation.
      if (generation !== startedGeneration) {
        throw new Error("Conversation context changed while installing its system prompt. Retry before sending.");
      }
      installed = { systemPrompt, contextIdentity, value };
      return value;
    });
    pending = operation;
    return operation;
  }

  return Object.freeze({ ensure, isCurrent, invalidate, whenIdle: () => pending });
}
