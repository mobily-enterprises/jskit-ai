import {
  normalizeObject,
  normalizeText
} from "../shared/support/normalize.js";

function ignoreAction() {}

/**
 * A component's interaction and action events, sent through its emit.
 * @param {(eventName: string, payload: Record<string, unknown>) => void} emit
 */
function createComponentInteractionEmitter(emit) {
  function emitInteraction(type, payload = {}) {
    emit("interaction", {
      type: normalizeText(type),
      ...normalizeObject(payload)
    });
  }

  async function invokeAction(actionName, payload, callback = ignoreAction) {
    emit("action:started", {
      action: normalizeText(actionName),
      payload
    });

    try {
      await callback();

      emit("action:succeeded", {
        action: normalizeText(actionName),
        payload
      });
    } catch (errorValue) {
      emit("action:failed", {
        action: normalizeText(actionName),
        payload,
        message: String(errorValue?.message || "Action failed")
      });
      throw errorValue;
    }
  }

  return Object.freeze({
    emitInteraction,
    invokeAction
  });
}

export {
  createComponentInteractionEmitter
};
